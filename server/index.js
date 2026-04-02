require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const multer = require("multer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { pool, initDB } = require("./db");

const app = express();
app.set("trust proxy", 1); // Trust first proxy (Railway, Heroku, etc.)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

// --- User Signup ---
app.get("/signup", (req, res) => {
  if (req.session && req.session.userId) return res.redirect("/dashboard");
  res.render("signup", { error: null });
});

app.post("/signup", async (req, res) => {
  const { username, email, password, confirm_password } = req.body;

  if (!username || !email || !password) {
    return res.render("signup", { error: "All fields are required" });
  }
  if (password !== confirm_password) {
    return res.render("signup", { error: "Passwords do not match" });
  }
  if (password.length < 6) {
    return res.render("signup", { error: "Password must be at least 6 characters" });
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE username = $1 OR email = $2", [username, email]
    );
    if (existing.rows.length > 0) {
      return res.render("signup", { error: "Username or email already taken" });
    }

    const hash = await bcrypt.hash(password, 10);
    const userKey = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO users (username, email, password_hash, user_key) VALUES ($1, $2, $3, $4)",
      [username, email, hash, userKey]
    );
    res.redirect("/login");
  } catch (err) {
    console.error("Signup error:", err);
    res.render("signup", { error: "Something went wrong" });
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

// --- Start New Session — downloads a .bat with the full agent embedded as PowerShell ---
app.get("/dashboard/new-session", requireUser, async (req, res) => {
  try {
    const result = await pool.query("SELECT user_key FROM users WHERE id = $1", [req.session.userId]);
    const userKey = result.rows[0].user_key;
    const serverUrl = `${req.protocol}://${req.get('host')}`;

    const bat = `@echo off
title Emote Control
echo ============================================
echo   Emote Control - Connecting your PC...
echo ============================================
echo.
echo Please wait, this may take a moment...
echo.

powershell -ExecutionPolicy Bypass -Command ^
$ErrorActionPreference='SilentlyContinue'; ^
$SERVER='${serverUrl}'; ^
$KEY='${userKey}'; ^
$HWID=''; ^
try { ^
  $uuid=(Get-CimInstance Win32_ComputerSystemProduct).UUID; ^
  if($uuid -and $uuid -ne 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'){$HWID=$uuid} ^
} catch {}; ^
if(-not $HWID){ ^
  try { ^
    $wmic=wmic csproduct get UUID 2^>$null; ^
    $lines=$wmic -split '\\n' ^| ForEach-Object {$_.Trim()} ^| Where-Object {$_ -and $_ -ne 'UUID'}; ^
    if($lines){$HWID=$lines[0]} ^
  } catch {} ^
}; ^
if(-not $HWID){$HWID=(Get-WmiObject Win32_NetworkAdapterConfiguration ^| Where-Object {$_.MACAddress} ^| Select-Object -First 1).MACAddress}; ^
$sha=New-Object System.Security.Cryptography.SHA256Managed; ^
$bytes=[System.Text.Encoding]::UTF8.GetBytes($HWID); ^
$hash=$sha.ComputeHash($bytes); ^
$HWID=($hash ^| ForEach-Object {$_.ToString('x2')}) -join ''; ^
$HWID=$HWID.Substring(0,32); ^
$machine=\"$env:COMPUTERNAME ($([System.Environment]::OSVersion.Platform) $([System.Environment]::OSVersion.Version.Major).$([System.Environment]::OSVersion.Version.Minor))\"; ^
Write-Host \"Machine: $machine\"; ^
Write-Host \"Connecting to $SERVER...\"; ^
Write-Host ''; ^
$body=@{user_key=$KEY;machine_name=$machine;hwid=$HWID} ^| ConvertTo-Json; ^
$TOKEN=$null; ^
$retries=0; ^
while(-not $TOKEN -and $retries -lt 5){ ^
  try { ^
    $resp=Invoke-RestMethod -Uri \"$SERVER/api/agent/register\" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15; ^
    $TOKEN=$resp.token; ^
  } catch { ^
    $retries++; ^
    Write-Host \"  Retrying in 5s... ($retries/5)\"; ^
    Start-Sleep 5 ^
  } ^
}; ^
if(-not $TOKEN){ ^
  Write-Host '[ERROR] Could not connect after 5 attempts.'; ^
  Write-Host 'Check your internet connection and try again.'; ^
  Read-Host 'Press Enter to exit'; ^
  exit 1 ^
}; ^
Write-Host 'Connected! Session is ONLINE.'; ^
Write-Host 'Listening for commands... (close this window to disconnect)'; ^
Write-Host ''; ^
$headers=@{Authorization=\"Bearer $TOKEN\";'Content-Type'='application/json'}; ^
$lastHeartbeat=[datetime]::MinValue; ^
while($true){ ^
  $now=Get-Date; ^
  if(($now - $lastHeartbeat).TotalSeconds -ge 15){ ^
    try { ^
      $hb=@{machine_name=$machine} ^| ConvertTo-Json; ^
      Invoke-RestMethod -Uri \"$SERVER/api/agent/heartbeat\" -Method Post -Body $hb -Headers $headers -TimeoutSec 10 ^| Out-Null ^
    } catch {}; ^
    $lastHeartbeat=$now ^
  }; ^
  try { ^
    $cmds=Invoke-RestMethod -Uri \"$SERVER/api/agent/commands\" -Method Get -Headers $headers -TimeoutSec 10; ^
    foreach($cmd in $cmds.commands){ ^
      $c=$cmd.command.Trim().ToLower(); ^
      $a=$cmd.args; ^
      $rid=$cmd.id; ^
      Write-Host \"  ^> $c $(if($a){$a})\"; ^
      $resultText=''; ^
      $resultStatus='done'; ^
      try { ^
        switch($c){ ^
          'screenshot' { ^
            Add-Type -AssemblyName System.Windows.Forms; ^
            Add-Type -AssemblyName System.Drawing; ^
            $screen=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ^
            $bmp=New-Object System.Drawing.Bitmap($screen.Width,$screen.Height); ^
            $g=[System.Drawing.Graphics]::FromImage($bmp); ^
            $g.CopyFromScreen($screen.Location,[System.Drawing.Point]::Empty,$screen.Size); ^
            $ms=New-Object System.IO.MemoryStream; ^
            $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); ^
            $b64=[Convert]::ToBase64String($ms.ToArray()); ^
            $resultText=\"[Screenshot - $($b64.Length) bytes]`ndata:image/png;base64,$($b64.Substring(0,[Math]::Min(200,$b64.Length)))...\"; ^
            $g.Dispose();$bmp.Dispose();$ms.Dispose() ^
          } ^
          'sysinfo' { ^
            $info=@(); ^
            $info+=\"Hostname:  $env:COMPUTERNAME\"; ^
            $info+=\"OS:        $([System.Environment]::OSVersion.VersionString)\"; ^
            $info+=\"Machine:   $env:PROCESSOR_ARCHITECTURE\"; ^
            $info+=\"Processor: $env:PROCESSOR_IDENTIFIER\"; ^
            try{$ip=([System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) ^| Where-Object {$_.AddressFamily -eq 'InterNetwork'} ^| Select-Object -First 1).IPAddressToString;$info+=\"Local IP:  $ip\"}catch{$info+='Local IP:  unknown'}; ^
            try{$mem=Get-CimInstance Win32_OperatingSystem;$total=[math]::Round($mem.TotalVisibleMemorySize/1MB,1);$free=[math]::Round($mem.FreePhysicalMemory/1MB,1);$info+=\"RAM:       $total GB total, $free GB free\"}catch{}; ^
            try{$cpu=(Get-CimInstance Win32_Processor).NumberOfLogicalProcessors;$info+=\"CPU Cores: $cpu\"}catch{}; ^
            try{$disk=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\";$dtotal=[math]::Round($disk.Size/1GB,1);$dfree=[math]::Round($disk.FreeSpace/1GB,1);$info+=\"Disk C:    $dtotal GB total, $dfree GB free\"}catch{}; ^
            $resultText=$info -join \"`n\" ^
          } ^
          'cmd' { ^
            if(-not $a){$resultText='No command provided';$resultStatus='failed'} ^
            else{ ^
              try { ^
                $proc=Start-Process cmd.exe -ArgumentList '/c',$a -NoNewWindow -Wait -PassThru -RedirectStandardOutput \"$env:TEMP\\ec_out.txt\" -RedirectStandardError \"$env:TEMP\\ec_err.txt\"; ^
                $out=Get-Content \"$env:TEMP\\ec_out.txt\" -Raw -ErrorAction SilentlyContinue; ^
                $err=Get-Content \"$env:TEMP\\ec_err.txt\" -Raw -ErrorAction SilentlyContinue; ^
                $resultText=$out; ^
                if($err){$resultText+=\"`n[STDERR]`n$err\"}; ^
                if(-not $resultText){$resultText='(no output)'}; ^
                $resultText=$resultText.Substring(0,[Math]::Min(5000,$resultText.Length)); ^
                Remove-Item \"$env:TEMP\\ec_out.txt\" -Force -ErrorAction SilentlyContinue; ^
                Remove-Item \"$env:TEMP\\ec_err.txt\" -Force -ErrorAction SilentlyContinue ^
              } catch { $resultText=\"Error: $_\";$resultStatus='failed' } ^
            } ^
          } ^
          'list_files' { ^
            $p=if($a){$a}else{$env:USERPROFILE}; ^
            if(-not (Test-Path $p -PathType Container)){$resultText=\"'$p' is not a directory\";$resultStatus='failed'} ^
            else{ ^
              $items=Get-ChildItem $p -ErrorAction Stop; ^
              $lines=@(\"$p ($($items.Count) items):\"); ^
              foreach($item in $items ^| Sort-Object Name){ ^
                if($item.PSIsContainer){$lines+=\"  [DIR]  $($item.Name)\"} ^
                else{$sz=if($item.Length -lt 1024){\"$($item.Length) B\"}elseif($item.Length -lt 1MB){\"$([math]::Round($item.Length/1024)) KB\"}else{\"$([math]::Round($item.Length/1MB)) MB\"};$lines+=\"  [FILE] $($item.Name) ($sz)\"} ^
              }; ^
              $resultText=($lines -join \"`n\").Substring(0,[Math]::Min(5000,($lines -join \"`n\").Length)) ^
            } ^
          } ^
          'open' { ^
            if(-not $a){$resultText='No path provided';$resultStatus='failed'} ^
            else{ Start-Process $a; $resultText=\"Opened: $a\" } ^
          } ^
          'notify' { ^
            $msg=if($a){$a}else{'Emote Control'}; ^
            [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] ^> $null; ^
            $t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText01); ^
            $t.GetElementsByTagName('text')[0].AppendChild($t.CreateTextNode($msg)) ^> $null; ^
            [Windows.UI.Notifications.ToastNotification]::new($t) ^| ForEach-Object {[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Emote Control').Show($_)}; ^
            $resultText=\"Notification: $msg\" ^
          } ^
          default { ^
            $resultText=\"Unknown command: $c\"; ^
            $resultStatus='failed' ^
          } ^
        } ^
      } catch { $resultText=\"Error: $_\";$resultStatus='failed' }; ^
      try { ^
        $rbody=@{result=$resultText;status=$resultStatus} ^| ConvertTo-Json; ^
        Invoke-RestMethod -Uri \"$SERVER/api/agent/command/$rid/result\" -Method Post -Body $rbody -Headers $headers -TimeoutSec 10 ^| Out-Null ^
      } catch {} ^
    } ^
  } catch {}; ^
  Start-Sleep 3 ^
}

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Something went wrong. Please try again.
  echo If this keeps happening, contact the person who sent you this file.
)
pause
`;

    res.setHeader("Content-Disposition", 'attachment; filename="EmoteControl.bat"');
    res.setHeader("Content-Type", "application/x-bat");
    res.send(bat);
  } catch (err) {
    console.error(err);
    res.redirect("/dashboard");
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

// Agent self-registers using the user's key — resumes existing session by HWID or creates new
app.post("/api/agent/register", async (req, res) => {
  const { user_key, machine_name, hwid } = req.body;
  if (!user_key) return res.status(400).json({ error: "Missing user_key" });

  try {
    const user = await pool.query("SELECT id FROM users WHERE user_key = $1", [user_key]);
    if (user.rows.length === 0) return res.status(401).json({ error: "Invalid user_key" });

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
    const result = await pool.query(
      "UPDATE command_queue SET status = 'running' WHERE session_id = $1 AND status = 'pending' RETURNING *",
      [req.agentSession.id]
    );
    res.json({ commands: result.rows });
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
// START
// ============================================================

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Emote Control running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to init DB:", err);
    process.exit(1);
  });
