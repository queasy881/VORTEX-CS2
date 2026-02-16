// ===== STATE =====
let token = localStorage.getItem('admin_token') || null;
let uploadType = 'internal';
let selectedFile = null;
let selectedDll = null;
let keyDuration = 1;
let keyFilter = 'all';
let allKeys = [];

// ===== BACKGROUND CANVAS =====
(function initBg() {
  const c = document.getElementById('bgCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  let W, H, pts = [], mouse = { x: -1000, y: -1000 };
  function resize() { W = c.width = window.innerWidth; H = c.height = window.innerHeight; }
  resize(); window.addEventListener('resize', resize);
  document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  for (let i = 0; i < 60; i++) {
    pts.push({
      x: Math.random() * 2000, y: Math.random() * 2000,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5
    });
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Gradient bg
    const g = ctx.createRadialGradient(W * 0.3, H * 0.3, 0, W * 0.5, H * 0.5, W * 0.8);
    g.addColorStop(0, 'rgba(30,5,10,.4)');
    g.addColorStop(0.5, 'rgba(8,8,14,1)');
    g.addColorStop(1, 'rgba(4,4,8,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Update & draw points
    for (let p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      // Mouse repel
      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 150) {
        p.x += dx * 0.01;
        p.y += dy * 0.01;
      }
    }
    // Lines
    ctx.strokeStyle = 'rgba(232,35,58,.04)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 180) {
          ctx.globalAlpha = (1 - d / 180) * 0.5;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    // Dots
    ctx.globalAlpha = 1;
    for (let p of pts) {
      ctx.fillStyle = `rgba(232,35,58,${0.15 + p.r * 0.1})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ===== TOAST =====
function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(t._to);
  t._to = setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== AUTH =====
async function login() {
  const u = document.getElementById('loginUser').value;
  const p = document.getElementById('loginPass').value;
  try {
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    const d = await r.json();
    if (r.ok) { token = d.token; localStorage.setItem('admin_token', token); showMain(); toast('Authenticated', 'ok'); }
    else document.getElementById('loginErr').textContent = d.error || 'Failed';
  } catch (e) { document.getElementById('loginErr').textContent = 'Connection failed'; }
}
function logout() {
  token = null; localStorage.removeItem('admin_token');
  document.getElementById('loginView').style.display = '';
  document.getElementById('mainView').style.display = 'none';
}
function showMain() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('mainView').style.display = '';
  loadDashboard();
}
function api(url, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['x-admin-token'] = token;
  return fetch(url, opts).then(r => { if (r.status === 401) { logout(); throw new Error('Session expired'); } return r; });
}

// ===== TABS =====
function showTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sb-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'builds') loadBuilds();
  if (name === 'keys') loadKeys();
  if (name === 'logs') loadLogs();
}

// ===== ANIMATED COUNTER =====
function animateValue(el, target) {
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const diff = target - start;
  const duration = 600;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + diff * ease);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ===== DASHBOARD =====
async function loadDashboard() {
  try {
    const r = await api('/api/admin/stats'); const d = await r.json();
    animateValue(document.getElementById('statTotal'), d.totalDownloads);
    animateValue(document.getElementById('statToday'), d.todayDownloads);
    animateValue(document.getElementById('statKeys'), d.totalKeys || 0);
    animateValue(document.getElementById('statActive'), d.activeKeys || 0);
  } catch (e) { }
  try { const r = await fetch('/api/version/internal'); const d = await r.json(); document.getElementById('curInternalVer').textContent = d.version ? 'v' + d.version : 'No build'; } catch (e) { document.getElementById('curInternalVer').textContent = 'No build'; }
  try { const r = await fetch('/api/version/external'); const d = await r.json(); document.getElementById('curExternalVer').textContent = d.version ? 'v' + d.version : 'No build'; } catch (e) { document.getElementById('curExternalVer').textContent = 'No build'; }
}

// ===== UPLOAD =====
function setType(t, el) {
  uploadType = t;
  document.querySelectorAll('.tt-btn').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('dllField').style.display = (t === 'external') ? '' : 'none';
}
function fileSelected(input) {
  if (input.files.length) {
    selectedFile = input.files[0];
    document.getElementById('dropText').textContent = selectedFile.name + ' (' + (selectedFile.size / 1024).toFixed(0) + ' KB)';
    document.getElementById('dropZone').classList.add('has-file');
  }
}
function dllFileSelected(input) {
  if (input.files.length) {
    selectedDll = input.files[0];
    document.getElementById('dllDropText').textContent = selectedDll.name + ' (' + (selectedDll.size / 1024).toFixed(0) + ' KB)';
    document.getElementById('dllDropZone').classList.add('has-file');
  }
}

// Drag & Drop
['dropZone', 'dllDropZone'].forEach(id => {
  const dz = document.getElementById(id);
  if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--red)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.style.borderColor = '';
    if (e.dataTransfer.files.length) {
      const f = e.dataTransfer.files[0];
      if (id === 'dropZone') { selectedFile = f; document.getElementById('dropText').textContent = f.name + ' (' + (f.size / 1024).toFixed(0) + ' KB)'; dz.classList.add('has-file'); }
      else { selectedDll = f; document.getElementById('dllDropText').textContent = f.name + ' (' + (f.size / 1024).toFixed(0) + ' KB)'; dz.classList.add('has-file'); }
    }
  });
});

async function uploadBuild() {
  const version = document.getElementById('uploadVersion').value.trim();
  const changelog = document.getElementById('uploadChangelog').value.trim();
  const setLatest = document.getElementById('uploadLatest').checked;
  const status = document.getElementById('uploadStatus');
  if (!version) { status.textContent = 'Version required'; status.className = 'upload-status err'; return; }
  if (!selectedFile) { status.textContent = 'No file selected'; status.className = 'upload-status err'; return; }
  const fd = new FormData(); fd.append('file', selectedFile); fd.append('type', uploadType); fd.append('version', version); fd.append('changelog', changelog); fd.append('setLatest', setLatest ? 'true' : 'false');
  if (selectedDll && uploadType === 'external') fd.append('dll', selectedDll);
  status.textContent = 'Uploading...'; status.className = 'upload-status';
  try {
    const r = await fetch('/api/admin/upload', { method: 'POST', headers: { 'x-admin-token': token }, body: fd }); const d = await r.json();
    if (r.ok) {
      status.textContent = 'Deployed! ID:' + d.id + (selectedDll ? ' (+DLL)' : ''); status.className = 'upload-status ok';
      selectedFile = null; selectedDll = null;
      document.getElementById('dropText').textContent = 'Drop file or click to browse'; document.getElementById('dropZone').classList.remove('has-file');
      document.getElementById('dllDropText').textContent = 'Drop .dll here (optional)';
      const ddz = document.getElementById('dllDropZone'); if (ddz) ddz.classList.remove('has-file');
      document.getElementById('uploadVersion').value = ''; document.getElementById('uploadChangelog').value = '';
      toast('Build deployed!', 'ok');
    } else { status.textContent = d.error; status.className = 'upload-status err'; toast(d.error, 'err'); }
  } catch (e) { status.textContent = 'Failed: ' + e.message; status.className = 'upload-status err'; }
}

// ===== BUILDS =====
async function loadBuilds() {
  const list = document.getElementById('buildsList');
  list.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    const r = await api('/api/admin/builds'); const builds = await r.json();
    if (!builds.length) { list.innerHTML = '<div class="empty-state">No builds yet</div>'; return; }
    list.innerHTML = builds.map(b => `<div class="build-row ${b.is_latest ? 'latest' : ''}">
      <span class="b-type ${b.type}">${b.type.toUpperCase()}</span>
      <div class="b-info">
        <div class="b-top"><span class="b-ver">v${b.version}</span>${b.is_latest ? '<span class="b-latest">LATEST</span>' : ''}</div>
        <div class="b-file">${b.filename} (${(b.filesize / 1024).toFixed(0)} KB)${b.dll_filename ? ' + ' + b.dll_filename + ' (' + (b.dll_filesize / 1024).toFixed(0) + ' KB)' : ''}</div>
        ${b.changelog ? '<div class="b-cl">' + b.changelog + '</div>' : ''}
        <div class="b-date">${new Date(b.uploaded_at).toLocaleString()}</div>
      </div>
      <div class="b-actions">
        ${!b.is_latest ? `<button class="b-set" onclick="setLatest(${b.id})">Set Latest</button>` : ''}
        <button class="b-del" onclick="deleteBuild(${b.id})">Delete</button>
      </div>
    </div>`).join('');
  } catch (e) { list.innerHTML = '<div class="empty-state">Failed to load</div>'; }
}
async function setLatest(id) { await api('/api/admin/set-latest/' + id, { method: 'POST' }); loadBuilds(); loadDashboard(); toast('Build set as latest', 'ok'); }
async function deleteBuild(id) { if (!confirm('Delete this build?')) return; await api('/api/admin/builds/' + id, { method: 'DELETE' }); loadBuilds(); toast('Build deleted', 'inf'); }

// ===== KEYS =====
function setDur(d, el) { keyDuration = d; document.querySelectorAll('.dur-pill').forEach(p => p.classList.remove('active')); el.classList.add('active'); }

async function genKeys() {
  const count = parseInt(document.getElementById('keyCount').value) || 1;
  const label = document.getElementById('keyLabel').value.trim();
  const res = document.getElementById('genResult');
  try {
    const r = await api('/api/admin/keys/create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ count, duration_days: keyDuration, label }) });
    const d = await r.json();
    if (r.ok) {
      res.style.display = 'block';
      res.innerHTML = d.keys.map(k => '<div class="key-line" onclick="navigator.clipboard.writeText(\'' + k + '\');toast(\'Copied!\',\'ok\')">' + k + '</div>').join('') + '<button class="copy-all-btn" onclick="copyAllKeys()">Copy All</button>';
      res.dataset.keys = d.keys.join('\n');
      toast(d.keys.length + ' key(s) generated', 'ok');
      loadKeys();
    } else { res.style.display = 'block'; res.innerHTML = '<div style="color:var(--red)">' + d.error + '</div>'; }
  } catch (e) { res.style.display = 'block'; res.innerHTML = '<div style="color:var(--red)">Failed</div>'; }
}
function copyAllKeys() { const el = document.getElementById('genResult'); navigator.clipboard.writeText(el.dataset.keys || ''); toast('All keys copied!', 'ok'); }

function filterKeys(f, el) { keyFilter = f; document.querySelectorAll('.kf-pill').forEach(p => p.classList.remove('active')); el.classList.add('active'); renderKeys(); }

async function resetByCode() {
  const code = document.getElementById('resetKeyCode').value.trim();
  const s = document.getElementById('resetStatus');
  if (!code) { s.textContent = 'Enter a key'; s.className = 'upload-status err'; return; }
  try {
    const r = await api('/api/admin/keys/reset-by-code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ key_code: code }) });
    const d = await r.json();
    if (r.ok) { s.textContent = 'HWID reset!'; s.className = 'upload-status ok'; document.getElementById('resetKeyCode').value = ''; loadKeys(); toast('HWID reset', 'ok'); }
    else { s.textContent = d.error; s.className = 'upload-status err'; }
  } catch (e) { s.textContent = 'Failed'; s.className = 'upload-status err'; }
}

function getKeyStatus(k) {
  if (k.is_banned) return { cls: 'ban', text: 'BANNED' };
  if (!k.activated_at) return { cls: 'unused', text: 'UNUSED' };
  if (new Date(k.expires_at) < new Date()) return { cls: 'exp', text: 'EXPIRED' };
  return { cls: 'active', text: 'ACTIVE' };
}

function renderKeys() {
  const list = document.getElementById('keysList');
  const search = (document.getElementById('keySearch')?.value || '').toLowerCase();
  let keys = allKeys;
  if (keyFilter === 'unused') keys = keys.filter(k => !k.activated_at && !k.is_banned);
  if (keyFilter === 'active') keys = keys.filter(k => k.activated_at && new Date(k.expires_at) >= new Date() && !k.is_banned);
  if (keyFilter === 'expired') keys = keys.filter(k => k.expires_at && new Date(k.expires_at) < new Date() && !k.is_banned);
  if (keyFilter === 'banned') keys = keys.filter(k => k.is_banned);
  if (keyFilter === 'locked') keys = keys.filter(k => k.hwid && !k.is_banned);
  if (search) keys = keys.filter(k => k.key_code.toLowerCase().includes(search) || (k.label && k.label.toLowerCase().includes(search)));

  if (!keys.length) { list.innerHTML = '<div class="empty-state">No keys found</div>'; return; }

  list.innerHTML = keys.map(k => {
    const s = getKeyStatus(k);
    const days = k.duration_days >= 9999 ? '∞' : k.duration_days + 'd';
    const exp = k.expires_at ? new Date(k.expires_at).toLocaleDateString() : '—';
    const daysLeft = k.expires_at ? Math.max(0, Math.ceil((new Date(k.expires_at) - new Date()) / 86400000)) : k.duration_days;
    const locked = !!k.hwid;
    return `<div class="key-row ${s.cls === 'ban' ? 'banned' : ''} ${s.cls === 'exp' ? 'expired' : ''}">
      <span class="k-code" onclick="navigator.clipboard.writeText('${k.key_code}');toast('Copied!','ok')" title="Click to copy">${k.key_code}</span>
      <span class="k-status ${s.cls}">${s.text}</span>
      <span class="k-lock ${locked ? 'locked' : 'unlocked'}">${locked ? 'LOCKED' : 'FREE'}</span>
      <div class="k-info">
        <span>${days}</span>
        ${k.label ? '<span>' + k.label + '</span>' : ''}
        ${k.activated_at ? '<span>Exp: ' + exp + ' (' + daysLeft + 'd)</span>' : ''}
        ${k.hwid ? '<span class="k-hwid">' + k.hwid.substring(0, 16) + '...</span>' : ''}
      </div>
      <div class="k-actions">
        ${k.hwid ? `<button class="kr" onclick="resetKey(${k.id})">Reset</button>` : ''}
        <button class="kb" onclick="banKey(${k.id})">${k.is_banned ? 'Unban' : 'Ban'}</button>
        <button class="kd" onclick="deleteKey(${k.id})">Del</button>
      </div>
    </div>`;
  }).join('');
}

async function loadKeys() {
  const list = document.getElementById('keysList'); list.innerHTML = '<div class="empty-state">Loading...</div>';
  try { const r = await api('/api/admin/keys'); allKeys = await r.json(); renderKeys(); }
  catch (e) { list.innerHTML = '<div class="empty-state">Failed</div>'; }
}
async function banKey(id) { await api('/api/admin/keys/' + id + '/ban', { method: 'POST' }); loadKeys(); toast('Key updated', 'inf'); }
async function resetKey(id) { if (!confirm('Reset HWID?')) return; await api('/api/admin/keys/' + id + '/reset', { method: 'POST' }); loadKeys(); toast('HWID reset', 'ok'); }
async function deleteKey(id) { if (!confirm('Delete key permanently?')) return; await api('/api/admin/keys/' + id, { method: 'DELETE' }); loadKeys(); toast('Key deleted', 'inf'); }

// ===== LOGS =====
async function loadLogs() {
  const list = document.getElementById('logsList');
  list.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    const r = await api('/api/admin/logs');
    if (!r.ok) { list.innerHTML = '<div class="empty-state">No log endpoint — add GET /api/admin/logs</div>'; return; }
    const logs = await r.json();
    if (!logs.length) { list.innerHTML = '<div class="empty-state">No downloads yet</div>'; return; }
    list.innerHTML = logs.map(l => `<div class="log-row">
      <span class="log-time">${new Date(l.downloaded_at).toLocaleString()}</span>
      <span class="log-type b-type ${l.type || 'external'}">${(l.type || 'EXT').toUpperCase()}</span>
      <span style="flex:1;font-size:11px;color:var(--tx2)">v${l.version || '?'}</span>
      <span class="log-ip">${l.ip || ''}</span>
    </div>`).join('');
  } catch (e) { list.innerHTML = '<div class="empty-state">Logs unavailable</div>'; }
}

// ===== SETTINGS =====
async function changePass() {
  const p = document.getElementById('newPass').value;
  const s = document.getElementById('passStatus');
  if (p.length < 6) { s.textContent = 'Min 6 chars'; s.className = 'upload-status err'; return; }
  const r = await api('/api/admin/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ newPassword: p }) });
  if (r.ok) { s.textContent = 'Updated'; s.className = 'upload-status ok'; document.getElementById('newPass').value = ''; toast('Password updated', 'ok'); }
  else { s.textContent = 'Failed'; s.className = 'upload-status err'; }
}
async function purgeLogs() {
  try { await api('/api/admin/purge-logs', { method: 'POST' }); toast('Logs purged', 'ok'); loadLogs(); } catch (e) { toast('Failed', 'err'); }
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '1') showTab('dashboard', document.querySelector('[data-tab="dashboard"]'));
  if (e.key === '2') showTab('upload', document.querySelector('[data-tab="upload"]'));
  if (e.key === '3') showTab('builds', document.querySelector('[data-tab="builds"]'));
  if (e.key === '4') showTab('keys', document.querySelector('[data-tab="keys"]'));
  if (e.key === '5') showTab('logs', document.querySelector('[data-tab="logs"]'));
  if (e.key === '6') showTab('settings', document.querySelector('[data-tab="settings"]'));
});

// ===== INIT =====
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('loginUser').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPass').focus(); });
if (token) { api('/api/admin/stats').then(r => { if (r.ok) showMain(); else logout(); }).catch(() => logout()); }
