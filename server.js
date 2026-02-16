require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

// ========== STARTUP VALIDATION ==========
function validateEnv() {
  const errors = [];
  if (!process.env.DATABASE_URL) errors.push('DATABASE_URL is not set');
  if (!process.env.DEV_USER) console.warn('[!] DEV_USER not set — defaulting to "admin"');
  if (!process.env.DEV_PASS) console.warn('[!] DEV_PASS not set — defaulting to "admin" (INSECURE!)');
  if (process.env.DEV_PASS && process.env.DEV_PASS.length < 6) console.warn('[!] DEV_PASS too short');
  if (errors.length > 0) { errors.forEach(e => console.error(`[X] ${e}`)); process.exit(1); }
  console.log('[+] Env validated');
}
validateEnv();

// ========== DATABASE ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000, max: 10
});
pool.on('error', (err) => console.error('[!] DB pool error:', err.message));

async function initDB() {
  try {
    const client = await pool.connect();
    console.log('[+] Database connected');
    client.release();
  } catch (err) {
    console.error('[X] DB connection failed:', err.message);
    process.exit(1);
  }

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS builds (
      id SERIAL PRIMARY KEY, type VARCHAR(20) NOT NULL, version VARCHAR(50) NOT NULL,
      filename VARCHAR(255) NOT NULL, filedata BYTEA NOT NULL, filesize INTEGER NOT NULL,
      dll_filename VARCHAR(255) DEFAULT NULL, dll_filedata BYTEA DEFAULT NULL, dll_filesize INTEGER DEFAULT 0,
      is_latest BOOLEAN DEFAULT false, changelog TEXT, uploaded_at TIMESTAMP DEFAULT NOW()
    )`);
    // Migration: add DLL columns if missing
    try {
      await pool.query(`ALTER TABLE builds ADD COLUMN IF NOT EXISTS dll_filename VARCHAR(255) DEFAULT NULL`);
      await pool.query(`ALTER TABLE builds ADD COLUMN IF NOT EXISTS dll_filedata BYTEA DEFAULT NULL`);
      await pool.query(`ALTER TABLE builds ADD COLUMN IF NOT EXISTS dll_filesize INTEGER DEFAULT 0`);
    } catch(e) { /* columns already exist */ }
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS download_log (
      id SERIAL PRIMARY KEY, build_id INTEGER REFERENCES builds(id) ON DELETE SET NULL,
      ip VARCHAR(50), user_agent TEXT, downloaded_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS license_keys (
      id SERIAL PRIMARY KEY,
      key_code VARCHAR(50) UNIQUE NOT NULL,
      label VARCHAR(100) DEFAULT '',
      duration_days INTEGER NOT NULL,
      hwid VARCHAR(255) DEFAULT NULL,
      activated_at TIMESTAMP DEFAULT NULL,
      expires_at TIMESTAMP DEFAULT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      is_active BOOLEAN DEFAULT true,
      is_banned BOOLEAN DEFAULT false
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_configs (
      id SERIAL PRIMARY KEY,
      key_code VARCHAR(50) UNIQUE NOT NULL REFERENCES license_keys(key_code) ON DELETE CASCADE,
      config_json TEXT DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('[+] Tables ready');
  } catch (err) {
    console.error('[X] Table creation failed:', err.message);
    process.exit(1);
  }

  try {
    const defaultUser = process.env.DEV_USER || 'admin';
    const defaultPass = process.env.DEV_PASS || 'admin';
    const hash = await bcrypt.hash(defaultPass, 10);
    await pool.query('DELETE FROM admin_users');
    await pool.query('INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)', [defaultUser, hash]);
    console.log(`[+] Admin: ${defaultUser}`);
  } catch (err) {
    console.error('[X] Admin creation failed:', err.message);
    process.exit(1);
  }
  console.log('[+] DB initialized');
}

// ========== AUTH ==========
const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, d] of sessions.entries()) if (now - d.created > 86400000) sessions.delete(t);
}, 1800000);

function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'No auth token' });
  if (!sessions.has(token)) return res.status(401).json({ error: 'Session expired' });
  req.admin = sessions.get(token);
  next();
}

const loginAttempts = new Map();
app.post('/api/admin/login', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const att = loginAttempts.get(ip) || { count: 0, first: now };
    if (now - att.first > 300000) { att.count = 0; att.first = now; }
    if (att.count >= 5) return res.status(429).json({ error: 'Too many attempts. Wait 5 min.' });

    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (result.rows.length === 0) { att.count++; loginAttempts.set(ip, att); return res.status(401).json({ error: 'Invalid username or password' }); }

    const valid = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!valid) { att.count++; loginAttempts.set(ip, att); return res.status(401).json({ error: 'Invalid username or password' }); }

    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { id: result.rows[0].id, username, created: Date.now() });
    res.json({ token, username });
  } catch (err) { res.status(500).json({ error: 'Login error' }); }
});

app.post('/api/admin/change-password', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hash, req.admin.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ========== LICENSE KEYS ==========

// Generate key code like QUIST-XXXX-XXXX-XXXX
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `QUIST-${seg()}-${seg()}-${seg()}`;
}

// Admin: Create keys
app.post('/api/admin/keys/create', authMiddleware, async (req, res) => {
  try {
    let { count, duration_days, label } = req.body;
    count = parseInt(count) || 1;
    duration_days = parseInt(duration_days);
    if (!duration_days || duration_days < 1 || duration_days > 3650) {
      return res.status(400).json({ error: 'Duration must be 1-3650 days' });
    }
    if (count < 1 || count > 100) return res.status(400).json({ error: 'Count must be 1-100' });

    const keys = [];
    for (let i = 0; i < count; i++) {
      let key = generateKey();
      // Ensure unique
      let tries = 0;
      while (tries < 10) {
        const exists = await pool.query('SELECT id FROM license_keys WHERE key_code = $1', [key]);
        if (exists.rows.length === 0) break;
        key = generateKey();
        tries++;
      }
      await pool.query(
        'INSERT INTO license_keys (key_code, duration_days, label) VALUES ($1, $2, $3)',
        [key, duration_days, label || '']
      );
      keys.push(key);
    }
    console.log(`[+] ${count} keys created (${duration_days}d) by ${req.admin.username}`);
    res.json({ ok: true, keys });
  } catch (err) {
    console.error('[!] Key creation error:', err.message);
    res.status(500).json({ error: 'Failed to create keys' });
  }
});

// Admin: List all keys
app.get('/api/admin/keys', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, key_code, label, duration_days, hwid, activated_at, expires_at, created_at, is_active, is_banned FROM license_keys ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to load keys' }); }
});

// Admin: Delete key
app.delete('/api/admin/keys/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    await pool.query('DELETE FROM license_keys WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete key' }); }
});

// Admin: Ban/unban key
app.post('/api/admin/keys/:id/ban', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const key = await pool.query('SELECT is_banned FROM license_keys WHERE id = $1', [id]);
    if (key.rows.length === 0) return res.status(404).json({ error: 'Key not found' });
    const newBan = !key.rows[0].is_banned;
    await pool.query('UPDATE license_keys SET is_banned = $1 WHERE id = $2', [newBan, id]);
    res.json({ ok: true, banned: newBan });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Admin: Reset key by ID
app.post('/api/admin/keys/:id/reset', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query('UPDATE license_keys SET hwid = NULL, activated_at = NULL, expires_at = NULL WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Admin: Reset key by key code
app.post('/api/admin/keys/reset-by-code', authMiddleware, async (req, res) => {
  try {
    const { key_code } = req.body;
    if (!key_code) return res.status(400).json({ error: 'Key code required' });
    const result = await pool.query('SELECT id, hwid FROM license_keys WHERE key_code = $1', [key_code.toUpperCase().trim()]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Key not found' });
    if (!result.rows[0].hwid) return res.status(400).json({ error: 'Key is not HWID locked' });
    await pool.query('UPDATE license_keys SET hwid = NULL, activated_at = NULL, expires_at = NULL WHERE id = $1', [result.rows[0].id]);
    console.log(`[+] HWID reset by code: ${key_code} by ${req.admin.username}`);
    res.json({ ok: true, message: 'HWID reset successfully' });
  } catch (err) { res.status(500).json({ error: 'Failed to reset' }); }
});

// ========== PUBLIC: Key Validation (launcher calls this) ==========
app.post('/api/auth/validate', async (req, res) => {
  try {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ error: 'Key and HWID required' });
    if (typeof key !== 'string' || typeof hwid !== 'string') return res.status(400).json({ error: 'Invalid input' });
    if (key.length > 50 || hwid.length > 255) return res.status(400).json({ error: 'Input too long' });

    const result = await pool.query('SELECT * FROM license_keys WHERE key_code = $1', [key.toUpperCase().trim()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid key', code: 'INVALID_KEY' });
    }

    const lic = result.rows[0];

    if (!lic.is_active) return res.status(401).json({ error: 'Key is disabled', code: 'DISABLED' });
    if (lic.is_banned) return res.status(401).json({ error: 'Key is banned', code: 'BANNED' });

    // Check HWID lock
    if (lic.hwid && lic.hwid !== hwid) {
      return res.status(401).json({ error: 'Key is locked to another PC', code: 'HWID_MISMATCH' });
    }

    // First activation
    if (!lic.activated_at) {
      const now = new Date();
      const expires = new Date(now.getTime() + lic.duration_days * 24 * 60 * 60 * 1000);
      await pool.query(
        'UPDATE license_keys SET hwid = $1, activated_at = NOW(), expires_at = $2 WHERE id = $3',
        [hwid, expires.toISOString(), lic.id]
      );
      console.log(`[+] Key activated: ${key} HWID: ${hwid.substring(0,16)}... (${lic.duration_days}d)`);
      return res.json({
        valid: true,
        message: 'Key activated!',
        expires: expires.toISOString(),
        days_left: lic.duration_days
      });
    }

    // Already activated — check expiry
    const now = new Date();
    const expires = new Date(lic.expires_at);
    if (now > expires) {
      return res.status(401).json({ error: 'Key expired', code: 'EXPIRED', expired_at: lic.expires_at });
    }

    const daysLeft = Math.ceil((expires - now) / (24 * 60 * 60 * 1000));
    return res.json({
      valid: true,
      message: 'Access granted',
      expires: lic.expires_at,
      days_left: daysLeft
    });
  } catch (err) {
    console.error('[!] Key validation error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== BUILD UPLOAD ==========
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.dll', '.exe'].includes(ext)) return cb(new Error('Only .dll and .exe allowed'));
    cb(null, true);
  }
});

app.post('/api/admin/upload', authMiddleware, (req, res, next) => {
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'dll', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 50MB)' });
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const mainFile = req.files && req.files['file'] ? req.files['file'][0] : null;
    const dllFile = req.files && req.files['dll'] ? req.files['dll'][0] : null;
    if (!mainFile) return res.status(400).json({ error: 'No file uploaded' });
    if (mainFile.size < 1024) return res.status(400).json({ error: 'File too small' });

    const { type, version, changelog, setLatest } = req.body;
    if (!type || !['internal', 'external'].includes(type)) return res.status(400).json({ error: 'Type must be internal or external' });
    if (!version) return res.status(400).json({ error: 'Version required' });

    const ext = path.extname(mainFile.originalname).toLowerCase();
    if (type === 'internal' && ext !== '.dll') return res.status(400).json({ error: 'Internal = .dll' });
    if (type === 'external' && ext !== '.exe') return res.status(400).json({ error: 'External = .exe' });

    if (dllFile) {
      const dllExt = path.extname(dllFile.originalname).toLowerCase();
      if (dllExt !== '.dll') return res.status(400).json({ error: 'Companion file must be .dll' });
    }

    const existing = await pool.query('SELECT id FROM builds WHERE type = $1 AND version = $2', [type, version]);
    if (existing.rows.length > 0) return res.status(400).json({ error: `v${version} already exists for ${type}` });

    if (setLatest === 'true') await pool.query('UPDATE builds SET is_latest = false WHERE type = $1', [type]);

    const result = await pool.query(
      `INSERT INTO builds (type, version, filename, filedata, filesize, dll_filename, dll_filedata, dll_filesize, is_latest, changelog)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        type, version,
        mainFile.originalname, mainFile.buffer, mainFile.size,
        dllFile ? dllFile.originalname : null,
        dllFile ? dllFile.buffer : null,
        dllFile ? dllFile.size : 0,
        setLatest === 'true', changelog || ''
      ]
    );
    console.log(`[+] Upload: ${type} v${version}${dllFile ? ' +DLL' : ''} by ${req.admin.username}`);
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[!] Upload error:', err.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ========== BUILD MANAGEMENT ==========
app.get('/api/admin/builds', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, type, version, filename, filesize, dll_filename, dll_filesize, is_latest, changelog, uploaded_at FROM builds ORDER BY uploaded_at DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to load builds' }); }
});

app.post('/api/admin/set-latest/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const build = await pool.query('SELECT type, version FROM builds WHERE id = $1', [id]);
    if (build.rows.length === 0) return res.status(404).json({ error: 'Build not found' });
    await pool.query('UPDATE builds SET is_latest = false WHERE type = $1', [build.rows[0].type]);
    await pool.query('UPDATE builds SET is_latest = true WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/admin/builds/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const build = await pool.query('SELECT is_latest FROM builds WHERE id = $1', [id]);
    if (build.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (build.rows[0].is_latest) return res.status(400).json({ error: 'Cannot delete latest build' });
    await pool.query('DELETE FROM download_log WHERE build_id = $1', [id]);
    await pool.query('DELETE FROM builds WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ========== STATS ==========
app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM download_log');
    const today = await pool.query("SELECT COUNT(*) FROM download_log WHERE downloaded_at > NOW() - INTERVAL '24 hours'");
    const byType = await pool.query('SELECT b.type, COUNT(*) as count FROM download_log dl JOIN builds b ON b.id = dl.build_id GROUP BY b.type');
    const totalKeys = await pool.query('SELECT COUNT(*) FROM license_keys');
    const activeKeys = await pool.query('SELECT COUNT(*) FROM license_keys WHERE hwid IS NOT NULL AND expires_at > NOW()');
    res.json({
      totalDownloads: parseInt(total.rows[0].count),
      todayDownloads: parseInt(today.rows[0].count),
      byType: byType.rows,
      totalKeys: parseInt(totalKeys.rows[0].count),
      activeKeys: parseInt(activeKeys.rows[0].count)
    });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ========== LOGS ==========
app.get('/api/admin/logs', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dl.downloaded_at, dl.ip, dl.user_agent, b.type, b.version, b.filename
       FROM download_log dl JOIN builds b ON b.id = dl.build_id
       ORDER BY dl.downloaded_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/purge-logs', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM download_log');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ========== PUBLIC: Version + Download (require valid key via header) ==========
app.get('/api/version/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (!['internal', 'external'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    const result = await pool.query('SELECT id, version, filesize, dll_filename, dll_filesize, changelog, uploaded_at FROM builds WHERE type = $1 AND is_latest = true', [type]);
    if (result.rows.length === 0) return res.status(404).json({ error: `No ${type} build` });
    const row = result.rows[0];
    res.json({ ...row, has_dll: !!row.dll_filename });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/download/:type', async (req, res) => {
  try {
    const { type } = req.params;
    if (!['internal', 'external'].includes(type)) return res.status(400).send('Invalid type');
    const result = await pool.query('SELECT id, filename, filedata, filesize FROM builds WHERE type = $1 AND is_latest = true', [type]);
    if (result.rows.length === 0) return res.status(404).send('No build');
    const build = result.rows[0];
    try { await pool.query('INSERT INTO download_log (build_id, ip, user_agent) VALUES ($1, $2, $3)', [build.id, req.ip, req.headers['user-agent'] || '']); } catch(e) {}
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${build.filename}"`);
    res.setHeader('Content-Length', build.filesize);
    res.send(build.filedata);
  } catch (err) { res.status(500).send('Error'); }
});

// Download companion DLL for external builds
app.get('/api/download/:type/dll', async (req, res) => {
  try {
    const { type } = req.params;
    if (!['internal', 'external'].includes(type)) return res.status(400).send('Invalid type');
    const result = await pool.query('SELECT id, dll_filename, dll_filedata, dll_filesize FROM builds WHERE type = $1 AND is_latest = true', [type]);
    if (result.rows.length === 0) return res.status(404).send('No build');
    const build = result.rows[0];
    if (!build.dll_filename || !build.dll_filedata) return res.status(404).send('No companion DLL');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${build.dll_filename}"`);
    res.setHeader('Content-Length', build.dll_filesize);
    res.send(build.dll_filedata);
  } catch (err) { res.status(500).send('Error'); }
});

// ========== HEALTH ==========
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
  catch (err) { res.status(500).json({ status: 'error' }); }
});

// ========== MENU CONFIG API (for web panel) ==========
app.get('/api/menu/config', async (req, res) => {
  const rawKey = req.headers['x-license-key'] || req.query.key;
  if (!rawKey) return res.status(401).json({ error: 'No key' });
  const key = rawKey.toUpperCase().trim();
  try {
    const lic = await pool.query('SELECT * FROM license_keys WHERE key_code = $1', [key]);
    if (lic.rows.length === 0) return res.status(401).json({ error: 'Invalid key' });
    const l = lic.rows[0];
    if (!l.is_active) return res.status(401).json({ error: 'Key disabled' });
    if (l.is_banned) return res.status(403).json({ error: 'Banned' });
    if (l.expires_at && new Date() > new Date(l.expires_at)) return res.status(401).json({ error: 'Expired' });
    const cfg = await pool.query('SELECT config_json FROM user_configs WHERE key_code = $1', [key]);
    res.json({ config: cfg.rows.length > 0 ? JSON.parse(cfg.rows[0].config_json) : {} });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/menu/config', async (req, res) => {
  const rawKey = req.headers['x-license-key'] || req.query.key;
  if (!rawKey) return res.status(401).json({ error: 'No key' });
  const key = rawKey.toUpperCase().trim();
  try {
    const lic = await pool.query('SELECT * FROM license_keys WHERE key_code = $1', [key]);
    if (lic.rows.length === 0) return res.status(401).json({ error: 'Invalid key' });
    const l = lic.rows[0];
    if (!l.is_active) return res.status(401).json({ error: 'Key disabled' });
    if (l.is_banned) return res.status(403).json({ error: 'Banned' });
    if (l.expires_at && new Date() > new Date(l.expires_at)) return res.status(401).json({ error: 'Expired' });
    const json = JSON.stringify(req.body.config || {});
    await pool.query(
      `INSERT INTO user_configs (key_code, config_json, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key_code) DO UPDATE SET config_json = $2, updated_at = NOW()`,
      [key, json]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ========== MENU HTML ==========
app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu', 'index.html'));
});

// ========== STATIC ==========
app.use('/dev', express.static(path.join(__dirname, 'public', 'dev')));
app.use('/menu/assets', express.static(path.join(__dirname, 'public', 'menu')));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error('[!]', err.message); res.status(500).json({ error: 'Internal error' }); });

// ========== WEBSOCKET RELAY ==========
// Tracks: cheatClients[keyCode] = ws, menuClients[keyCode] = [ws, ...]
const cheatClients = new Map(); // key -> ws (C++ cheat)
const menuClients = new Map();  // key -> Set<ws> (browser panels)

async function validateKeyForWs(key) {
  try {
    const normalized = key.toUpperCase().trim();
    const r = await pool.query('SELECT * FROM license_keys WHERE key_code = $1', [normalized]);
    if (r.rows.length === 0) return null;
    const l = r.rows[0];
    if (l.is_banned) return null;
    if (!l.is_active) return null;
    if (l.expires_at && new Date() > new Date(l.expires_at)) return null;
    return l;
  } catch { return null; }
}

function setupWss(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = url.searchParams.get('key');
    const role = url.searchParams.get('role'); // 'cheat' or 'menu'

    if (!key || !role || !['cheat', 'menu'].includes(role)) {
      ws.close(4001, 'Missing key or role');
      return;
    }

    const lic = await validateKeyForWs(key);
    if (!lic) {
      ws.close(4002, 'Invalid or expired key');
      return;
    }

    ws._key = key;
    ws._role = role;

    if (role === 'cheat') {
      // C++ client connecting
      if (cheatClients.has(key)) {
        try { cheatClients.get(key).close(4003, 'Replaced by new connection'); } catch {}
      }
      cheatClients.set(key, ws);
      console.log(`[WS] Cheat connected: ${key.substring(0,16)}...`);

      // Notify any menu clients that cheat is online
      const menus = menuClients.get(key);
      if (menus) {
        for (const m of menus) {
          try { m.send(JSON.stringify({ type: 'status', online: true })); } catch {}
        }
      }
    } else {
      // Browser menu connecting
      if (!menuClients.has(key)) menuClients.set(key, new Set());
      menuClients.get(key).add(ws);
      console.log(`[WS] Menu connected: ${key.substring(0,16)}...`);

      // Tell menu if cheat is online
      const online = cheatClients.has(key) && cheatClients.get(key).readyState === WebSocket.OPEN;
      ws.send(JSON.stringify({ type: 'status', online }));
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (role === 'menu') {
          // Menu -> forward to cheat
          const cheat = cheatClients.get(key);
          if (cheat && cheat.readyState === WebSocket.OPEN) {
            cheat.send(JSON.stringify(msg));
          }
        } else if (role === 'cheat') {
          // Cheat -> forward to all menu clients
          const menus = menuClients.get(key);
          if (menus) {
            const str = JSON.stringify(msg);
            for (const m of menus) {
              try { if (m.readyState === WebSocket.OPEN) m.send(str); } catch {}
            }
          }
        }
      } catch (e) {
        // ignore malformed
      }
    });

    ws.on('close', () => {
      if (role === 'cheat') {
        if (cheatClients.get(key) === ws) {
          cheatClients.delete(key);
          console.log(`[WS] Cheat disconnected: ${key.substring(0,16)}...`);
          // Notify menus
          const menus = menuClients.get(key);
          if (menus) {
            for (const m of menus) {
              try { m.send(JSON.stringify({ type: 'status', online: false })); } catch {}
            }
          }
        }
      } else {
        const menus = menuClients.get(key);
        if (menus) {
          menus.delete(ws);
          if (menus.size === 0) menuClients.delete(key);
        }
      }
    });

    ws.on('error', () => {});
  });

  // Heartbeat
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch {}
      }
    });
  }, 30000);

  console.log('[+] WebSocket relay active on /ws');
}

// ========== KEYBIND POLL STATE (per-key) ==========
const keybindState = new Map(); // key -> { waiting, target, captured, cancelled, vk, name }

app.post('/api/menu/keybind/start', (req, res) => {
  const key = req.headers['x-license-key'];
  if (!key) return res.status(401).json({ error: 'No key' });
  const { target } = req.body;
  keybindState.set(key, { waiting: true, target, captured: false, cancelled: false, vk: 0, name: '' });
  // Forward to cheat via WS
  const cheat = cheatClients.get(key);
  if (cheat && cheat.readyState === WebSocket.OPEN) {
    cheat.send(JSON.stringify({ type: 'keybind_start', target }));
  }
  res.json({ ok: true });
});

app.get('/api/menu/keybind/poll', (req, res) => {
  const key = req.headers['x-license-key'] || req.query.key;
  if (!key) return res.status(401).json({ error: 'No key' });
  const st = keybindState.get(key);
  if (!st) return res.json({ status: 'idle' });
  if (st.waiting) return res.json({ status: 'waiting' });
  if (st.cancelled) { keybindState.delete(key); return res.json({ status: 'cancelled' }); }
  if (st.captured) { const r = { status: 'captured', vk: st.vk, name: st.name, target: st.target }; keybindState.delete(key); return res.json(r); }
  res.json({ status: 'idle' });
});

// ========== START ==========
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  const server = http.createServer(app);
  setupWss(server);
  server.listen(PORT, () => console.log(`[+] Server on port ${PORT}`));
}).catch(err => { console.error('[X]', err.message); process.exit(1); });

process.on('uncaughtException', (err) => console.error('[X] Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('[X] Rejection:', err.message || err));
