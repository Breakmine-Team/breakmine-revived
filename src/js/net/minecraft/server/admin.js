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

const MDUI_HEAD = `<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700">
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
<link rel="stylesheet" href="https://unpkg.com/mdui@2/mdui.css">
<script src="https://unpkg.com/mdui@2/mdui.global.js"></script>
<style>
body { margin: 0; background-color: var(--mdui-color-surface, #101014); color: var(--mdui-color-on-surface, #e4e4e6); min-height: 100vh; display: flex; justify-content: center; align-items: center; font-family: Roboto, sans-serif; }
.wrap { width: min(420px, 92vw); padding: 2em 0; }
mdui-card { width: 100%; margin-bottom: 1em; }
mdui-card div[part=heading] { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.4em; }
.card-body { padding: 1.25em; display: flex; flex-direction: column; gap: 0.9em; }
mdui-select, mdui-text-field { width: 100%; }
mdui-button { width: 100%; }
.file-chip { border: none; background: none; color: var(--mdui-color-primary, #d3bc8e); padding: 0; font: inherit; cursor: pointer; display: flex; align-items: center; gap: 0.4em; width: 100%; transition: opacity .2s; }
.file-chip:hover { opacity: .8; }
.dot { display: inline-block; width: 1.5em; height: 1.5em; border-radius: 50%; border: 2px solid currentColor; color: var(--mdui-color-primary, #d3bc8e); flex-shrink: 0; position: relative; }
.dot.checked::after { content: ""; position: absolute; inset: 0.25em; background: currentColor; border-radius: 50%; }
.error { color: #f46566; font-size: 0.9em; }
</style>`;

function loginPage(error) {
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server Admin - Login</title>
${MDUI_HEAD}
</head>
<body><div class="wrap">
<mdui-card variant="filled">
<mdui-card-content>
<form method="POST" action="/admin/login" class="card-body">
<div part="heading"><h2>Server Admin Panel</h2></div>
${error ? '<div class="error">Wrong passcode.</div>' : ''}
<mdui-text-field type="password" name="passcode" label="Passcode" variant="outlined" toggle-password autofocus required></mdui-text-field>
<mdui-button type="submit" variant="filled" end-icon="arrow_forward">Login</mdui-button>
</form>
</mdui-card-content>
</mdui-card>
</div></body></html>`;
}

const MAIN_PAGE = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server Admin</title>
${MDUI_HEAD}
</head>
<body><div class="wrap">
<h2 style="text-align:center">Server Admin Panel</h2>
<mdui-card variant="outlined">
<div class="card-body">
<div part="heading">Download World</div>
<mdui-select id="dlWorld" variant="filled" label="World"></mdui-select>
<mdui-button id="dlBtn" variant="filled" icon="download">Download</mdui-button>
</div>
</mdui-card>
<mdui-card variant="outlined">
<div class="card-body">
<div part="heading">Upload World</div>
<mdui-select id="upWorld" variant="filled" label="World"></mdui-select>
<button class="file-chip" id="fileBtn" type="button"><span class="dot"></span><span id="fileLabel">Choose world_data.bin...</span></button>
<mdui-button id="upBtn" variant="filled" icon="upload" disabled>Upload</mdui-button>
</div>
</mdui-card>
<mdui-button href="/admin/logout" variant="text" icon="logout" full-width>Log out</mdui-button>
</div>
<input type="file" id="file" accept=".bin" hidden>
<script>
const dlWorld = document.getElementById('dlWorld');
const upWorld = document.getElementById('upWorld');
const fileInput = document.getElementById('file');
const fileLabel = document.getElementById('fileLabel');
const upBtn = document.getElementById('upBtn');
const upDot = document.querySelector('.file-chip .dot');

async function loadWorlds() {
    const r = await fetch('/admin/worlds');
    if (!r.ok) return;
    const worlds = await r.json();
    if (!worlds.length) return;
    for (const sel of [dlWorld, upWorld]) {
        sel.innerHTML = worlds.map(w => '<mdui-menu-item value="' + w + '">' + w + '</mdui-menu-item>').join('');
        sel.value = worlds[0];
    }
}
loadWorlds();

document.getElementById('dlBtn').addEventListener('click', () => {
    window.location = '/admin/download?world=' + encodeURIComponent(dlWorld.value);
});

document.getElementById('fileBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileLabel.textContent = f ? f.name : 'Choose world_data.bin...';
    upDot.classList.toggle('checked', !!f);
    upBtn.disabled = !f;
});

upBtn.addEventListener('click', async (e) => {
    const f = fileInput.files[0];
    if (!f) return;
    upBtn.loading = true;
    try {
        const res = await fetch('/admin/upload?world=' + encodeURIComponent(upWorld.value) + '&backup=1', {
            method: 'POST',
            body: f,
            headers: { 'Content-Type': 'application/octet-stream' }
        });
        const text = await res.text();
        if (res.ok) {
            upBtn.loading = false;
            upBtn.innerHTML = '<mdui-icon name="check"></mdui-icon> Uploaded';
            setTimeout(() => { location.reload(); }, 1200);
        } else {
            upBtn.loading = false;
            upBtn.textContent = 'Upload failed';
            console.error(text);
        }
    } catch (err) {
        upBtn.loading = false;
        upBtn.textContent = 'Upload failed';
    }
});
</script>
</body></html>`;

function handleFileDownload(req, res, worldName) {
    // Make sure the in-memory world is flushed first so the download is fresh
    // (and so a never-saved world still produces a valid file to download).
    try {
        saveWorld();
    } catch (e) {
        log.warn('Admin', 'Failed to flush world before download: ' + e.message);
    }
    const worldFile = getWorldFile(worldName);
    if (!nodeFs.existsSync(worldFile)) {
        send(res, 404, 'World not found: ' + sanitizeWorldName(worldName), 'text/plain');
        return;
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
            send(res, 404, `<html><head>${MDUI_HEAD}</head><body><div class="wrap" style="width:min(560px,90vw);text-align:center"><mdui-card variant="outlined"><div class="card-body"><div part="heading">Admin panel disabled</div><p>Set the <code>ADMIN_PASSCODE</code> environment variable when starting the server to enable it:</p><p><code>ADMIN_PASSCODE=your-secret node server.js</code></p></div></mdui-card></div></body></html>`);
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
                return send(res, 401, loginPage(true));
            }
            issueSession(res);
            res.writeHead(303, { Location: '/admin' });
            return res.end();
        }

        if (!isAuthed(req)) {
            return send(res, 401, loginPage(false));
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
            return send(res, 200, MAIN_PAGE);
        }
        send(res, 404, 'Not found', 'text/plain');
}

module.exports = { attachAdminPanel };
