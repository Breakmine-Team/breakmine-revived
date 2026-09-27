import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import Database from 'better-sqlite3';

const DB_FILE = 'wiki.db';
const PORT = process.env.PORT || 8001;
const SSL_PORT = process.env.SSL_PORT || 8443;

// --- DATABASE SETUP ---
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

function initDb(forceResetPassword = false) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      last_edited_by TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      content TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      summary TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (slug) REFERENCES pages (slug)
    );
  `);

  const kaiExists = db.prepare('SELECT username FROM users WHERE username = ?').get('kai');

  if (!kaiExists || forceResetPassword) {
    promptPassword((password) => {
      const { salt, hash } = hashPassword(password);
      db.prepare(`
        INSERT INTO users (username, salt, password_hash) VALUES (?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
          salt=excluded.salt,
          password_hash=excluded.password_hash
      `).run('kai', salt, hash);

      console.log("Password saved successfully for 'kai'.\n");
      seedDefaultPage();
      startServer();
    });
  } else {
    seedDefaultPage();
    startServer();
  }
}

function seedDefaultPage() {
  const count = db.prepare('SELECT COUNT(*) as count FROM pages').get().count;
  if (count === 0) {
    const initialContent = "Welcome to the Wiki!\n\nCheck out the [[Main Page]] or read about [[Rules]].";
    db.prepare('INSERT INTO pages (slug, title, content, last_edited_by) VALUES (?, ?, ?, ?)').run('Main_Page', 'Main Page', initialContent, 'kai');
    db.prepare('INSERT INTO revisions (slug, content, edited_by, summary) VALUES (?, ?, ?, ?)').run('Main_Page', initialContent, 'kai', 'Initial page creation');
  }
}

function promptPassword(callback) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  process.stdout.write("\n--- 'kai' Account Setup ---\nSet password for 'kai': ");
  
  const stdin = process.stdin;
  const onData = (char) => {
    char = char + '';
    switch (char) {
      case '\n':
      case '\r':
      case '\u0004':
        stdin.pause();
        break;
      default:
        process.stdout.write('\x1B[2K\x1B[0G' + "Set password for 'kai': " + '*'.repeat(rl.line.length));
        break;
    }
  };
  stdin.on('data', onData);

  rl.question('', (password) => {
    stdin.removeListener('data', onData);
    rl.close();
    console.log();
    if (!password.trim()) {
      console.log("Password cannot be empty!");
      return promptPassword(callback);
    }
    callback(password.trim());
  });
}

// --- SECURITY HELPERS ---
function hashPassword(password, saltHex = null) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function verifyPassword(storedSalt, storedHash, providedPassword) {
  const { hash } = hashPassword(providedPassword, storedSalt);
  return hash === storedHash;
}

// --- COOKIE & BODY PARSING HELPERS ---
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
    });
  }
  return list;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const result = {};
      for (const [key, value] of params.entries()) {
        result[key] = value;
      }
      resolve(result);
    });
  });
}

function renderWikilinks(text) {
  return text.replace(/\[\[(.*?)\]\]/g, (match, title) => {
    const trimmed = title.trim();
    const slug = trimmed.replace(/ /g, '_');
    return `<a href="/wiki/${slug}">${trimmed}</a>`;
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- HTML LAYOUT ---
function renderLayout({ title, headerTitle, currentSlug, bodyContent, user, page, searchQuery = '' }) {
  const isKai = user === 'kai';
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title)}</title>
    <style>
        body { margin: 8px; }
        * { box-sizing: border-box; }
        .wiki-container { display: flex; gap: 10px; align-items: flex-start; width: 100%; }
        .wiki-sidebar { width: 220px; flex-shrink: 0; }
        .wiki-main { flex-grow: 1; }
        body.dark-theme hr { border-color: #444; }
        body.dark-theme { background-color: #1a1a1a; color: #e0e0e0; }
        body.dark-theme a { color: #64b5f6; }
        body.dark-theme a:hover { color: #90caf9; }
        body.dark-theme a:visited { color: #42a5f5; }
        body.dark-theme fieldset { border-color: #444; border-width: 2px; }
        body.dark-theme legend { color: #e0e0e0; }
        body.dark-theme input, body.dark-theme textarea { background-color: #3d3d3d; color: #e0e0e0; border-color: #555; border: 1px solid #555; border-radius: 3px; }
        body.dark-theme button { background-color: #4d4d4d; color: #e0e0e0; border: 1px solid #555; border-radius: 3px; }
        body.dark-theme button:hover { background-color: #5d5d5d; }
    </style>
</head>
<body>
    <div style="margin-bottom: 5px; font-size: larger;"><i>Breakmine: Revived</i> Wiki</div>

    <div class="wiki-container">
        <fieldset class="wiki-sidebar">
            <legend>Controls</legend>

            ${isKai ? `
                <form action="/logout" method="post">
                    <button type="submit">Log Out</button>
                </form>
            ` : `
                <form action="/login" method="post">
                    <label for="password"><small>Password:</small></label>
                    <input type="password" id="password" name="password" size="14" required>
                    <button type="submit">></button>
                </form>
            `}

            <hr>

            <form action="/search" method="get">
                <label for="q"><small>Find Article:</small></label><br>
                <input type="text" id="q" name="q" value="${escapeHtml(searchQuery)}" size="14" required>
                <button type="submit">></button>
            </form>

            <hr>

            <label for="theme-toggle"><small>Dark Theme:</small></label><br>
            <button type="button" onclick="toggleTheme()" id="theme-toggle">Toggle</button>

            <hr>

            <p><strong>Navigation</strong></p>
            <ul>
                <li><a href="/wiki/Main_Page">Main Page</a></li>
                <li><a href="/all">All Pages</a></li>
            </ul>

            ${isKai ? `
                <hr>
                <p><strong>Actions</strong></p>
                <ul>
                    <li><a href="/new">New Page</a></li>
                </ul>
            ` : ''}
        </fieldset>

        <fieldset class="wiki-main">
            <legend>${escapeHtml(headerTitle)} ${page ? `- <small>Last modified: ${page.updated_at}</small>` : ''}</legend>

            ${currentSlug ? `
            <div>
                <a href="/wiki/${currentSlug}">[Article]</a> |
                <a href="/history/${currentSlug}">[View History]</a>
                ${isKai ? `| <a href="/edit/${currentSlug}">[Edit]</a>` : ''}
            </div>
            <hr>
            ` : ''}

            <div>
                ${bodyContent}
            </div>
        </fieldset>
    </div>

    <script>
        function toggleTheme() {
            document.body.classList.toggle('dark-theme');
            localStorage.setItem('darkTheme', document.body.classList.contains('dark-theme'));
        }
        if (localStorage.getItem('darkTheme') === 'true') {
            document.body.classList.add('dark-theme');
        }
    </script>
</body>
</html>`;
}

// --- HTTP REQUEST ROUTER ---
async function handleRequest(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const cookies = parseCookies(req);
  const user = cookies.user || null;

  const sendHtml = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };

  const sendText = (text, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  };

  const redirect = (location) => {
    res.writeHead(302, { 'Location': location });
    res.end();
  };

  // --- ROUTES ---
  if (pathname === '/') {
    return redirect('/wiki/Main_Page');
  }

  if (pathname.startsWith('/wiki/')) {
    const slug = pathname.replace('/wiki/', '');
    const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);

    if (!page) {
      return sendHtml(renderLayout({
        title: "Page Not Found",
        headerTitle: "404 - Not Found",
        currentSlug: null,
        bodyContent: "<p>This article does not exist yet.</p>",
        user,
        page: null
      }), 404);
    }

    const formattedContent = renderWikilinks(page.content);
    return sendHtml(renderLayout({
      title: page.title,
      headerTitle: page.title,
      currentSlug: slug,
      bodyContent: `<div style="font-size: large;">${formattedContent}</div>`,
      user,
      page
    }));
  }

  if (pathname.startsWith('/history/')) {
    const slug = pathname.replace('/history/', '');
    const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
    const revisions = db.prepare('SELECT * FROM revisions WHERE slug = ? ORDER BY id DESC').all(slug);

    if (!page) return sendText("Page not found", 404);

    const revList = revisions.map(r =>
      `<li><strong>${r.created_at}</strong> - ${r.summary ? escapeHtml(r.summary) : '<em>(no summary)</em>'}</li>`
    ).join('');

    const body = `<p>Revision history for <strong>${escapeHtml(page.title)}</strong>:</p><ul>${revList}</ul>`;

    return sendHtml(renderLayout({
      title: `History: ${page.title}`,
      headerTitle: `History: ${page.title}`,
      currentSlug: slug,
      bodyContent: body,
      user,
      page
    }));
  }

  if (pathname.startsWith('/edit/')) {
    if (user !== 'kai') return sendText("Unauthorized: Only 'kai' can edit.", 403);

    const slug = pathname.replace('/edit/', '');
    const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
    if (!page) return sendText("Page not found", 404);

    const body = `
      <form action="/save" method="post">
          <p>
              <label for="title">Article Title:</label><br>
              <input type="text" id="title_display" value="${escapeHtml(page.title)}" disabled>
              <input type="hidden" id="title" name="title" value="${escapeHtml(page.title)}">
          </p>
          <p>
              <label for="content">Article Text (Use [[Page Title]] for wiki links):</label><br>
              <textarea id="content" name="content" rows="18" cols="70" required>${escapeHtml(page.content)}</textarea>
          </p>
          <p>
              <label for="summary">Edit Summary:</label><br>
              <input type="text" id="summary" name="summary" size="50" placeholder="Describe changes">
          </p>
          <button type="submit">Save Changes</button>
          <a href="/wiki/${page.slug}">Cancel</a>
      </form>`;

    return sendHtml(renderLayout({
      title: `Editing ${page.title}`,
      headerTitle: `Editing: ${page.title}`,
      currentSlug: slug,
      bodyContent: body,
      user,
      page
    }));
  }

  if (pathname === '/new') {
    if (user !== 'kai') return sendText("Unauthorized: Only 'kai' can create pages.", 403);

    const body = `
      <form action="/save" method="post">
          <p>
              <label for="title">Article Title:</label><br>
              <input type="text" id="title" name="title" required>
          </p>
          <p>
              <label for="content">Article Text (Use [[Page Title]] for wiki links):</label><br>
              <textarea id="content" name="content" rows="18" cols="70" required></textarea>
          </p>
          <p>
              <label for="summary">Edit Summary:</label><br>
              <input type="text" id="summary" name="summary" size="50" placeholder="Describe changes">
          </p>
          <button type="submit">Save Changes</button>
          <a href="/">Cancel</a>
      </form>`;

    return sendHtml(renderLayout({
      title: "Create Article",
      headerTitle: "Create Article",
      currentSlug: null,
      bodyContent: body,
      user,
      page: null
    }));
  }

  if (pathname === '/save' && req.method === 'POST') {
    if (user !== 'kai') return sendText("Forbidden: Strictly 'kai' (case-sensitive) can edit.", 403);

    const body = await parseBody(req);
    const title = (body.title || '').trim();
    const content = body.content || '';
    const summary = (body.summary || '').trim();

    if (!title) return sendText("Title is required", 400);

    const slug = title.replace(/ /g, '_');
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    db.prepare(`
      INSERT INTO pages (slug, title, content, last_edited_by, updated_at)
      VALUES (?, ?, ?, 'kai', ?)
      ON CONFLICT(slug) DO UPDATE SET
          content=excluded.content,
          last_edited_by='kai',
          updated_at=excluded.updated_at
    `).run(slug, title, content, now);

    db.prepare(`
      INSERT INTO revisions (slug, content, edited_by, summary)
      VALUES (?, ?, 'kai', ?)
    `).run(slug, content, summary);

    return redirect(`/wiki/${slug}`);
  }

  if (pathname === '/search') {
    const query = (url.searchParams.get('q') || '').trim();
    const searchPattern = `%${query}%`;

    const results = db.prepare(
      'SELECT slug, title FROM pages WHERE title LIKE ? OR content LIKE ?'
    ).all(searchPattern, searchPattern);

    const listItems = results.length
      ? `<ul>${results.map(i => `<li><a href="/wiki/${i.slug}">${escapeHtml(i.title)}</a></li>`).join('')}</ul>`
      : '<p>No matching articles found.</p>';

    const body = `<h3>Results for "${escapeHtml(query)}"</h3>${listItems}`;

    return sendHtml(renderLayout({
      title: `Search: ${query}`,
      headerTitle: "Search Results",
      currentSlug: null,
      searchQuery: query,
      bodyContent: body,
      user
    }));
  }

  if (pathname === '/all') {
    const pages = db.prepare('SELECT slug, title FROM pages ORDER BY title ASC').all();
    const listItems = pages.map(p => `<li><a href="/wiki/${p.slug}">${escapeHtml(p.title)}</a></li>`).join('');
    const body = `<h3>All Articles (${pages.length})</h3><ul>${listItems}</ul>`;

    return sendHtml(renderLayout({
      title: "All Pages",
      headerTitle: "Special: All Pages",
      currentSlug: null,
      bodyContent: body,
      user
    }));
  }

  if (pathname === '/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const password = body.password || '';

    const kaiUser = db.prepare('SELECT * FROM users WHERE username = ?').get('kai');

    if (kaiUser && verifyPassword(kaiUser.salt, kaiUser.password_hash, password)) {
      res.writeHead(302, {
        'Set-Cookie': 'user=kai; Path=/; Secure; HttpOnly; SameSite=Lax',
        'Location': req.headers.referer || '/'
      });
      return res.end();
    }

    return sendHtml(renderLayout({
      title: "Login Failed",
      headerTitle: "Authentication Error",
      currentSlug: null,
      bodyContent: "<p>Invalid password. <a href='/'>Go back</a></p>",
      user: null
    }), 401);
  }

  if (pathname === '/logout' && req.method === 'POST') {
    res.writeHead(302, {
      'Set-Cookie': 'user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Location': req.headers.referer || '/'
    });
    return res.end();
  }

  sendText('Not Found', 404);
}

// --- SERVER INITIALIZATION ---
function startServer() {
  if (!fs.existsSync('key.pem') || !fs.existsSync('cert.pem')) {
    console.error('FATAL: Missing key.pem or cert.pem in project root.');
    process.exit(1);
  }

  let sslOptions;
  try {
    sslOptions = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
      minVersion: 'TLSv1.2'
    };
  } catch (err) {
    console.error('FATAL: Failed to load TLS certificates:', err.message);
    process.exit(1);
  }

  // Primary HTTPS Server
  const httpsServer = https.createServer(sslOptions, handleRequest);
  
  httpsServer.on('tlsClientError', (err) => {
    console.error('TLS Handshake Error:', err.message);
  });

  httpsServer.listen(SSL_PORT, '0.0.0.0', () => {
    console.log(`HTTPS Server running at https://0.0.0.0:${SSL_PORT}`);
  });

  // HTTP to HTTPS Redirect
  const httpServer = http.createServer((req, res) => {
    const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
    const redirectPort = SSL_PORT == 443 ? '' : `:${SSL_PORT}`;
    res.writeHead(301, { 'Location': `https://${host}${redirectPort}${req.url}` });
    res.end();
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP Redirect Server running at http://0.0.0.0:${PORT} -> HTTPS:${SSL_PORT}`);
  });
}

// Run DB setup & CLI password prompt
const forceResetPassword = process.argv.includes('--reset-kai-password');
initDb(forceResetPassword);
