require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const multer = require("multer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");
const { pool, initDB } = require("./db");

const app = express();
const server = http.createServer(app);

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

// --- Live Screen Streaming (in-memory) ---
const screenFrames = new Map();   // sessionId -> Buffer (latest JPEG frame)
const screenRequested = new Map(); // sessionId -> timestamp (when dashboard last requested)
const dashboardSockets = new Map(); // sessionId -> Set<WebSocket> (dashboard viewers)
const agentSockets = new Map();     // sessionId -> WebSocket (agent screen stream)
app.set("trust proxy", 1); // Trust first proxy (Railway, Heroku, etc.)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000; // v2
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const SECRET_KEY = process.env.SECRET_KEY || "dev-secret-change-me";

// Middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "static")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
    secret: SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true },
  })
);

// --- Helpers ---

function resolveStatus(sess) {
  if (sess.status === "pending") return "pending";
  const diff = (Date.now() - new Date(sess.last_seen).getTime()) / 1000;
  return diff > 60 ? "offline" : "online";
}

// --- Auth Middleware ---

function requireUser(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect("/login");
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.redirect("/dev");
}

// ============================================================
// PUBLIC ROUTES
// ============================================================

app.get("/", (req, res) => {
  if (req.session && req.session.userId) return res.redirect("/dashboard");
  res.redirect("/login");
});

// --- User Login ---
app.get("/login", (req, res) => {
  if (req.session && req.session.userId) return res.redirect("/dashboard");
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (result.rows.length === 0) {
      return res.render("login", { error: "Invalid username or password" });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.render("login", { error: "Invalid username or password" });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Login error:", err);
    res.render("login", { error: "Something went wrong" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ============================================================
// USER ROUTES (requires login)
// ============================================================

// --- Dashboard ---
app.get("/dashboard", requireUser, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.session.userId]
    );
    const sessions = result.rows.map(s => ({ ...s, live_status: resolveStatus(s) }));
    res.render("dashboard", { username: req.session.username, sessions });
  } catch (err) {
    console.error(err);
    res.render("dashboard", { username: req.session.username, sessions: [] });
  }
});

// --- Session View ---
app.get("/session/:id", requireUser, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM sessions WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    if (result.rows.length === 0) return res.redirect("/dashboard");

    const sess = { ...result.rows[0], live_status: resolveStatus(result.rows[0]) };

    const cmds = await pool.query(
      "SELECT * FROM command_queue WHERE session_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );

    res.render("session", { session: sess, commands: cmds.rows, username: req.session.username });
  } catch (err) {
    console.error(err);
    res.redirect("/dashboard");
  }
});

// --- Send Command ---
app.post("/session/:id/command", requireUser, async (req, res) => {
  const { command, args } = req.body;
  try {
    // Verify ownership
    const sess = await pool.query(
      "SELECT id FROM sessions WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    if (sess.rows.length === 0) return res.status(403).json({ error: "Forbidden" });

    const result = await pool.query(
      "INSERT INTO command_queue (session_id, command, args) VALUES ($1, $2, $3) RETURNING *",
      [req.params.id, command, args || null]
    );
    res.json({ success: true, command: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send command" });
  }
});

// --- Poll Session Status ---
app.get("/session/:id/status", requireUser, async (req, res) => {
  try {
    const sess = await pool.query(
      "SELECT * FROM sessions WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    if (sess.rows.length === 0) return res.status(403).json({ error: "Forbidden" });

    const session = { ...sess.rows[0], live_status: resolveStatus(sess.rows[0]) };

    const cmds = await pool.query(
      "SELECT * FROM command_queue WHERE session_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );

    res.json({ session, commands: cmds.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Live Screen: Start (dashboard tells server someone is watching) ---
app.post("/session/:id/screen/start", requireUser, async (req, res) => {
  try {
    const sess = await pool.query(
      "SELECT id FROM sessions WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    if (sess.rows.length === 0) return res.status(403).json({ error: "Forbidden" });
    screenRequested.set(parseInt(req.params.id), Date.now());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// --- Live Screen: Stop ---
app.post("/session/:id/screen/stop", requireUser, async (req, res) => {
  screenRequested.delete(parseInt(req.params.id));
  screenFrames.delete(parseInt(req.params.id));
  res.json({ ok: true });
});

// --- Live Screen: MJPEG Stream ---
app.get("/session/:id/screen/stream", requireUser, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  try {
    const sess = await pool.query(
      "SELECT id FROM sessions WHERE id = $1 AND user_id = $2",
      [sessionId, req.session.userId]
    );
    if (sess.rows.length === 0) return res.status(403).send("Forbidden");
  } catch (err) {
    return res.status(500).send("Server error");
  }

  screenRequested.set(sessionId, Date.now());

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
  });

  let lastFrame = null;
  const interval = setInterval(() => {
    const frame = screenFrames.get(sessionId);
    if (frame && frame !== lastFrame) {
      try {
        res.write("--frame\r\n");
        res.write("Content-Type: image/jpeg\r\n");
        res.write(`Content-Length: ${frame.length}\r\n\r\n`);
        res.write(frame);
        res.write("\r\n");
        lastFrame = frame;
      } catch (e) {
        clearInterval(interval);
      }
    }
    screenRequested.set(sessionId, Date.now());
  }, 16); // Push as fast as frames arrive (~60hz check rate)

  req.on("close", () => {
    clearInterval(interval);
  });
});

// --- Delete Session ---
app.post("/session/:id/delete", requireUser, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM sessions WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
  } catch (err) {
    console.error(err);
  }
  res.redirect("/dashboard");
});

// ============================================================
// DOWNLOAD ROUTES
// ============================================================

app.get("/download/agent/binary", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT filename, file_data FROM agents ORDER BY uploaded_at DESC LIMIT 1"
    );
    if (result.rows.length === 0) return res.status(404).send("No agent available");

    const agent = result.rows[0];
    res.setHeader("Content-Disposition", `attachment; filename="${agent.filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(agent.file_data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// ============================================================
// AGENT API
// ============================================================

// Agent self-registers — auto-assigns to the single admin account, resumes by HWID
app.post("/api/agent/register", async (req, res) => {
  const { machine_name, hwid } = req.body;

  try {
    // Always assign to the first (only) user account
    const user = await pool.query("SELECT id FROM users ORDER BY id ASC LIMIT 1");
    if (user.rows.length === 0) return res.status(500).json({ error: "No admin account configured" });

    const userId = user.rows[0].id;
    const token = crypto.randomBytes(32).toString("hex");
    const name = machine_name || "Unknown";

    // If hwid provided, try to resume an existing session for this machine
    if (hwid) {
      const existing = await pool.query(
        "SELECT id FROM sessions WHERE user_id = $1 AND hwid = $2",
        [userId, hwid]
      );

      if (existing.rows.length > 0) {
        const updated = await pool.query(
          `UPDATE sessions
           SET token = $1, status = 'online', machine_name = $2, last_seen = NOW()
           WHERE id = $3
           RETURNING id, token`,
          [token, name, existing.rows[0].id]
        );
        return res.json({ token: updated.rows[0].token, session_id: updated.rows[0].id });
      }
    }

    // No existing session (or no hwid) — create new
    const session = await pool.query(
      "INSERT INTO sessions (user_id, token, machine_name, hwid, status) VALUES ($1, $2, $3, $4, 'online') RETURNING id, token",
      [userId, token, name, hwid || null]
    );

    res.json({ token: session.rows[0].token, session_id: session.rows[0].id });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

async function requireAgentToken(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const result = await pool.query("SELECT * FROM sessions WHERE token = $1", [token]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Invalid token" });
    req.agentSession = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

// --- Agent Screen Frame Upload ---
app.post("/api/agent/screen", express.raw({ type: "image/jpeg", limit: "2mb" }), requireAgentToken, (req, res) => {
  const sid = req.agentSession.id;
  screenFrames.set(sid, req.body);
  const needed = screenRequested.has(sid) && (Date.now() - screenRequested.get(sid)) < 30000;
  res.json({ continue: needed });
});

app.post("/api/agent/heartbeat", requireAgentToken, async (req, res) => {
  const { machine_name } = req.body;
  try {
    await pool.query(
      "UPDATE sessions SET status = 'online', last_seen = NOW(), machine_name = COALESCE($1, machine_name) WHERE id = $2",
      [machine_name || null, req.agentSession.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

app.get("/api/agent/commands", requireAgentToken, async (req, res) => {
  try {
    const sid = req.agentSession.id;
    const result = await pool.query(
      "UPDATE command_queue SET status = 'running' WHERE session_id = $1 AND status = 'pending' RETURNING *",
      [sid]
    );
    const screenNeeded = screenRequested.has(sid) && (Date.now() - screenRequested.get(sid)) < 30000;
    res.json({ commands: result.rows, screen_stream: screenNeeded });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

app.post("/api/agent/command/:id/result", requireAgentToken, async (req, res) => {
  const { result, status } = req.body;
  try {
    await pool.query(
      "UPDATE command_queue SET result = $1, status = $2, completed_at = NOW() WHERE id = $3 AND session_id = $4",
      [result, status || "done", req.params.id, req.agentSession.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// ============================================================
// ADMIN /dev ROUTES
// ============================================================

app.get("/dev", (req, res) => {
  if (req.session && req.session.admin) {
    return showDevPanel(req, res);
  }
  res.render("dev-login", { error: null });
});

app.post("/dev/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    req.session.adminUser = username;
    return res.redirect("/dev");
  }
  res.render("dev-login", { error: "Invalid credentials" });
});

async function showDevPanel(req, res) {
  try {
    const agent = await pool.query(
      "SELECT id, filename, file_size, uploaded_at FROM agents ORDER BY uploaded_at DESC LIMIT 1"
    );
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM sessions) AS total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE last_seen > NOW() - INTERVAL '60 seconds' AND status = 'online') AS online_sessions
    `);
    res.render("dev", {
      user: req.session.adminUser,
      agent: agent.rows[0] || null,
      stats: stats.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.render("dev", { user: req.session.adminUser, agent: null, stats: { total_users: 0, total_sessions: 0, online_sessions: 0 } });
  }
}

app.post("/dev/upload", requireAdmin, upload.single("agent_file"), async (req, res) => {
  if (!req.file) return res.redirect("/dev");
  try {
    await pool.query("DELETE FROM agents");
    await pool.query(
      "INSERT INTO agents (filename, file_data, file_size) VALUES ($1, $2, $3)",
      [req.file.originalname, req.file.buffer, req.file.size]
    );
  } catch (err) {
    console.error("Upload error:", err);
  }
  res.redirect("/dev");
});

app.get("/dev/delete-agent", requireAdmin, async (req, res) => {
  try { await pool.query("DELETE FROM agents"); } catch (err) { console.error(err); }
  res.redirect("/dev");
});

app.get("/dev/logout", (req, res) => {
  req.session.admin = false;
  req.session.adminUser = null;
  res.redirect("/dev");
});

// ============================================================
// WEBSOCKET HANDLER
// ============================================================

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get("role"); // "agent" or "dashboard"
  const sessionId = parseInt(url.searchParams.get("session"));
  const token = url.searchParams.get("token");

  if (!sessionId || !role) {
    ws.close(4000, "Missing params");
    return;
  }

  if (role === "agent") {
    // Agent connecting to stream screen frames
    // Verify token
    pool.query("SELECT id FROM sessions WHERE token = $1 AND id = $2", [token, sessionId])
      .then(result => {
        if (result.rows.length === 0) {
          ws.close(4001, "Invalid token");
          return;
        }

        console.log(`[WS] Agent screen stream connected for session ${sessionId}`);
        agentSockets.set(sessionId, ws);

        ws.on("message", (data) => {
          // Binary JPEG frame from agent — relay to all dashboard viewers
          screenFrames.set(sessionId, data);
          const viewers = dashboardSockets.get(sessionId);
          if (viewers) {
            for (const viewer of viewers) {
              if (viewer.readyState === 1) { // OPEN
                viewer.send(data);
              }
            }
          }
        });

        ws.on("close", () => {
          console.log(`[WS] Agent screen stream disconnected for session ${sessionId}`);
          if (agentSockets.get(sessionId) === ws) {
            agentSockets.delete(sessionId);
          }
        });

        // Tell agent to start streaming
        ws.send(JSON.stringify({ type: "stream_start" }));
      })
      .catch(() => ws.close(4002, "Server error"));

  } else if (role === "dashboard") {
    // Dashboard viewer connecting to watch screen
    // Verify user session via token (we reuse the session token for simplicity)
    pool.query("SELECT id, user_id FROM sessions WHERE id = $1", [sessionId])
      .then(result => {
        if (result.rows.length === 0) {
          ws.close(4001, "Invalid session");
          return;
        }

        console.log(`[WS] Dashboard viewer connected for session ${sessionId}`);
        if (!dashboardSockets.has(sessionId)) {
          dashboardSockets.set(sessionId, new Set());
        }
        dashboardSockets.get(sessionId).add(ws);
        screenRequested.set(sessionId, Date.now());

        ws.on("message", (data) => {
          const msg = data.toString();
          if (msg === "keepalive") {
            screenRequested.set(sessionId, Date.now());
          }
        });

        ws.on("close", () => {
          console.log(`[WS] Dashboard viewer disconnected for session ${sessionId}`);
          const viewers = dashboardSockets.get(sessionId);
          if (viewers) {
            viewers.delete(ws);
            if (viewers.size === 0) {
              dashboardSockets.delete(sessionId);
              screenRequested.delete(sessionId);
              // Tell agent to stop streaming
              const agentWs = agentSockets.get(sessionId);
              if (agentWs && agentWs.readyState === 1) {
                agentWs.send(JSON.stringify({ type: "stream_stop" }));
              }
            }
          }
        });
      })
      .catch(() => ws.close(4002, "Server error"));
  }
});

// ============================================================
// START
// ============================================================

initDB()
  .then(() => {
    server.listen(PORT, () => console.log(`Emote Control running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to init DB:", err);
    process.exit(1);
  });
