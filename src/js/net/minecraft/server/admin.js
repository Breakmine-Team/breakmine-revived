// Admin panel: passcode-protected HTTP endpoints (download/upload world_data.bin)
// mounted on the same HTTP server the WebSocket multiplayer runs on.
const nodeFs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { saveWorld, getWorldDir, listWorlds, getCurrentWorldName } = require('./world.js');
const Logger = require('./logger.js').default;

const log = Logger;

// Passcode comes from the environment. When it is not set the admin panel
// stays disabled so a server is never accidentally left open.
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE;

// In-memory sessions: token -> expiry timestamp.
const sessions = new Map();
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 hours

function sanitizeWorldName(name) {
    return String(name || 'main').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'main';
}

function getWorldFile(worldName) {
    return path.join(getWorldDir(sanitizeWorldName(worldName)), 'world_data.bin');
}

function parseCookies(header) {
    const cookies = {};
    if (!header) return cookies;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return cookies;
}

function isAuthed(req) {
    const token = parseCookies(req.headers.cookie).admin_session;
    if (!token) return false;
    const expiry = sessions.get(token);
    if (!expiry || expiry < Date.now()) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function issueSession(res) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`);
}

function send(res, status, body, type = 'text/html; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html>
<head><title>Server Admin</title>
<style>
body { font-family: sans-serif; background: #1a1a1a; color: #eee; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
.box { background: #2a2a2a; padding: 2em; border-radius: 8px; width: 320px; }
input, button, select { width: 100%; padding: 8px; margin: 4px 0; box-sizing: border-box; }
button { background: #4a90d9; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
button:hover { background: #3a7bc0; }
.error { color: #f66; }
.row { display: flex; gap: 8px; }
a { color: #7ab8ff; }
</style>
<head>
<body><div class="box">
<h2>Server Admin Panel</h2>
<form method="POST" action="/admin/download" id="dlForm">
<h3>Download World</h3>
<select id="dlWorld"></select>
<button type="submit">Download</button>
</form>
<form method="POST" action="/admin/upload" id="upForm" enctype="multipart/form-data">
<h3>Upload World</h3>
<select id="upWorld" name="world"></select>
<input type="file" id="file" name="file" accept=".bin" required>
<label><input type="checkbox" name="backup" checked value="1" style="width:auto"> Keep .bak of existing world</label>
<button type="submit">Upload</button>
</form>
<p><a href="/admin/logout">Log out</a></p>
<script>
async function loadWorlds() {
    const r = await fetch('/admin/worlds');
    if (!r.ok) return;
    const worlds = await r.json();
    for (const sel of [document.getElementById('dlWorld'), document.getElementById('upWorld')]) {
        sel.innerHTML = worlds.map(w => '<option>' + w + '</option>').join('');
    }
}
loadWorlds();
// Convert the multipart upload into a raw stream the server expects.
document.getElementById('upForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = document.getElementById('upForm');
    const world = document.getElementById('upWorld').value;
    const file = document.getElementById('file').files[0];
    const backup = f.backup.checked ? '&backup=1' : '';
    const res = await fetch('/admin/upload?world=' + encodeURIComponent(world) + backup, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' }
    });
    alert(await res.text());
    if (res.ok) location.reload();
});
document.getElementById('dlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const world = document.getElementById('dlWorld').value;
    window.location = '/admin/download?world=' + encodeURIComponent(world);
});
</script>
</div></body>
</html>`;

function handleFileDownload(req, res, worldName) {
    const worldFile = getWorldFile(worldName);
    if (!nodeFs.existsSync(worldFile)) {
        send(res, 404, 'World not found: ' + sanitizeWorldName(worldName), 'text/plain');
        return;
    }
    // Make sure the in-memory world is flushed first so the download is fresh.
    try {
        saveWorld();
    } catch (e) {
        log.warn('Admin', 'Failed to flush world before download: ' + e.message);
    }
    const name = path.basename(worldFile);
    res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${name}"`
    });
    nodeFs.createReadStream(worldFile).pipe(res);
}

async function handleFileUpload(req, res, worldName, backup) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = Buffer.concat(chunks);
    if (!data.length) {
        send(res, 400, 'Empty upload.', 'text/plain');
        return;
    }

    const name = sanitizeWorldName(worldName);
    const worldDir = getWorldDir(name);
    nodeFs.mkdirSync(worldDir, { recursive: true });
    const worldFile = path.join(worldDir, 'world_data.bin');

    // Stage to a temp file, optionally keep a .bak, then swap into place
    // (same atomic-rename approach the server's own saveWorld uses).
    const tempFile = worldFile + '.upload';
    if (backup && nodeFs.existsSync(worldFile)) {
        nodeFs.copyFileSync(worldFile, worldFile + '.bak');
    }
    nodeFs.writeFileSync(tempFile, data);
    nodeFs.renameSync(tempFile, worldFile);
    log.info('Admin', `World data uploaded for "${name}" (${data.length} bytes, backup=${!!backup})`);
    send(res, 200, 'World uploaded for "' + name + '". It will load on the next server start/world load.', 'text/plain');
}

// Attach to the given http/https server; WebSocket connections are unaffected
// because we simply ignore non-/admin requests.
function attachAdminPanel(server) {
    server.on('request', (req, res) => {
        handleAdminRequest(req, res).catch((e) => {
            log.error('Admin', `Error handling ${req.method} ${req.url}: ${e.message}`);
            try { send(res, 500, 'Internal error', 'text/plain'); } catch (_) {}
        });
    });
}

async function handleAdminRequest(req, res) {
        if (!ADMIN_PASSCODE) {
            send(res, 404, `<h2>Admin panel disabled</h2><p>Set the <code>ADMIN_PASSCODE</code> environment variable when starting the server to enable it:</p><p><code>ADMIN_PASSCODE=your-secret node server.js</code></p>`);
            return;
        }
        const parsed = url.parse(req.url, true);
        const pathname = parsed.pathname;

        if (pathname === '/admin/logout') {
            sessions.delete(parseCookies(req.headers.cookie).admin_session);
            res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
            return send(res, 303, '', 'text/plain');
        }

        if (pathname === '/admin/login' && req.method === 'POST') {
            let body = '';
            for await (const chunk of req) body += chunk;
            const pass = new url.URLSearchParams(body).get('passcode');
            if (!pass || pass !== ADMIN_PASSCODE) {
                return send(res, 401, `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#1a1a1a;color:#eee;display:flex;justify-content:center;padding-top:20vh"><form method="POST" action="/admin/login" style="background:#2a2a2a;padding:2em;border-radius:8px"><h2>Server Admin Panel</h2><input type="password" name="passcode" placeholder="Passcode" autofocus><button>Login</button><p style="color:#f66">Wrong passcode.</p></form></body></html>`);
            }
            issueSession(res);
            res.writeHead(303, { Location: '/admin' });
            return res.end();
        }

        if (!isAuthed(req)) {
            return send(res, 401, `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#1a1a1a;color:#eee;display:flex;justify-content:center;padding-top:20vh"><form method="POST" action="/admin/login" style="background:#2a2a2a;padding:2em;border-radius:8px"><h2>Server Admin Panel</h2><input type="password" name="passcode" placeholder="Passcode" autofocus><button>Login</button></form></body></html>`);
        }

        if (pathname === '/admin/worlds') {
            return send(res, 200, JSON.stringify(listWorlds()), 'application/json');
        }
        if (pathname === '/admin/download') {
            return handleFileDownload(req, res, parsed.query.world || getCurrentWorldName());
        }
        if (pathname === '/admin/upload') {
            return handleFileUpload(req, res, parsed.query.world, parsed.query.backup);
        }
        if (pathname === '/admin' || pathname === '/') {
            return send(res, 200, LOGIN_PAGE);
        }
        send(res, 404, 'Not found', 'text/plain');
}

module.exports = { attachAdminPanel };
