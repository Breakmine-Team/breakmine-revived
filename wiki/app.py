import sqlite3
import re
import hashlib
import os
import sys
import getpass
import json
import traceback
import uuid
import threading
import time
from datetime import datetime
import urllib.error
import urllib.parse
import urllib.request
from flask import Flask, Blueprint, Response, request, redirect, url_for, session, render_template, send_file, current_app, jsonify
from markupsafe import escape
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.serving import run_simple

SECRET_KEY = os.environ.get('WIKI_SECRET_KEY') or 'wikipedia_style_minimal_css_secret_key'
# Everything that must survive a restart lives in DATA_DIR. In Docker this is a volume.
DATA_DIR = os.environ.get('WIKI_DATA_DIR') or '.'
DB_PATH = os.path.join(DATA_DIR, 'wiki.db')
UPLOAD_FOLDER = os.path.join(DATA_DIR, 'mod_files')
TEMP_UPLOAD_FOLDER = os.path.join(DATA_DIR, 'temp_mods')
# Password for the 'kai' admin account. Unset means "prompt if interactive, otherwise skip".
ADMIN_PASSWORD = os.environ.get('WIKI_ADMIN_PASSWORD') or None
DEBUG = os.environ.get('WIKI_DEBUG', '').strip().lower() in ('1', 'true', 'yes', 'on')
# Discord OAuth. The secret must come from the environment - never commit it.
DISCORD_CLIENT_ID = os.environ.get('DISCORD_CLIENT_ID') or None
DISCORD_CLIENT_SECRET = os.environ.get('DISCORD_CLIENT_SECRET') or None
DISCORD_SCOPE = 'identify email'
# Only for running the flow on http://localhost without a proxy in front.
DISCORD_REDIRECT_BASE = os.environ.get('DISCORD_REDIRECT_BASE') or None
ALLOWED_EXTENSIONS = {'zip'}
MAX_FILE_SIZE = 50 * 1024 * 1024

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(TEMP_UPLOAD_FOLDER, exist_ok=True)

temp_timers = {}

def delete_temp_file(filepath):
    if os.path.exists(filepath):
        try: os.remove(filepath)
        except Exception: pass

# --- SECURITY HELPERS ---
def hash_password(password, salt=None):
    if not salt: salt = os.urandom(16)
    else: salt = bytes.fromhex(salt)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return salt.hex(), key.hex()

def verify_password(stored_salt, stored_key, provided_password):
    salt = bytes.fromhex(stored_salt)
    _, new_key = hash_password(provided_password, salt.hex())
    return new_key == stored_key

def save_admin_password(cursor, conn, password):
    salt, pwd_hash = hash_password(password)
    cursor.execute('INSERT INTO users (username, salt, password_hash) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt, password_hash=excluded.password_hash', ('kai', salt, pwd_hash))
    conn.commit()

def prompt_admin_password(exists):
    """Ask for the admin password on a terminal. Returns None if there is no TTY to ask on."""
    if not sys.stdin.isatty(): return None
    print("\n--- 'kai' Account Setup ---")
    prompt = "Set NEW password for 'kai': " if exists else "Set password for 'kai': "
    pwd = getpass.getpass(prompt)
    while not pwd:
        print("Password cannot be empty!")
        pwd = getpass.getpass(prompt)
    return pwd

def discord_configured():
    return bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET)

def discord_redirect_uri():
    # Discord only accepts https redirect URIs. Do not trust a proxy that still
    # reports http (e.g. TLS not switched on yet) - that produces a URI Discord
    # rejects outright. Override with DISCORD_REDIRECT_BASE for local testing.
    if DISCORD_REDIRECT_BASE: return DISCORD_REDIRECT_BASE.rstrip('/') + '/callback'
    return url_for('auth.discord_callback', _external=True, _scheme='https')

def discord_api(url, data=None, token=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body)
    # Discord's edge returns 403 for the default Python-urllib agent.
    req.add_header('User-Agent', 'Breakmine-Wiki (+https://wiki.breakmine.com)')
    if token: req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        # Surface Discord's own error body, otherwise it is just "403 Forbidden".
        detail = e.read().decode('utf-8', 'replace')[:300]
        raise RuntimeError(f"Discord API {e.code} {e.reason}: {detail}") from None

def user_for_discord(discord_id, discord_username):
    """Local account for a Discord identity, created on first login.

    Always matched on discord_id, never on the display name, so a Discord login
    cannot take over an existing password account such as 'kai'.
    """
    db = get_db()
    try:
        row = db.execute('SELECT username FROM users WHERE discord_id = ?', (discord_id,)).fetchone()
        if row: return row['username']
        base = re.sub(r'[^a-zA-Z0-9_]', '', discord_username)[:32].strip('_') or 'discord'
        if len(base) < 2: base = (base + 'user')[:32]
        username, n = base, 1
        while db.execute('SELECT 1 FROM users WHERE username = ?', (username,)).fetchone():
            suffix = str(n); n += 1
            username = f"{base[:32 - len(suffix)]}{suffix}"
        # Unreachable random password: this row is for Discord logins only.
        salt, pwd_hash = hash_password(uuid.uuid4().hex + uuid.uuid4().hex)
        db.execute('INSERT INTO users (username, salt, password_hash, discord_id) VALUES (?, ?, ?, ?)', (username, salt, pwd_hash, discord_id))
        db.commit()
        return username
    finally:
        db.close()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def format_file_size(size_bytes):
    if size_bytes < 1024: return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024: return f"{size_bytes / 1024:.1f} KB"
    else: return f"{size_bytes / (1024 * 1024):.1f} MB"

MAX_MIN_PATCHWORK_LEN = 20

def clean_min_patchwork(value):
    """Minimum Patchwork version string, e.g. 1.3.2-beta. Blank means no minimum; None means too long."""
    value = (value or '').strip()
    return value if len(value) <= MAX_MIN_PATCHWORK_LEN else None

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA foreign_keys = ON')
    return conn

# --- DATABASE SETUP ---
def init_db(force_reset_password=False):
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute('PRAGMA journal_mode = WAL')
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, last_edited_by TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, content TEXT NOT NULL, edited_by TEXT NOT NULL, summary TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (slug) REFERENCES pages (slug))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS mods (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, version TEXT DEFAULT '1.0.0', description TEXT DEFAULT '', uploaded_by TEXT NOT NULL, download_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (uploaded_by) REFERENCES users (username))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS mod_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, mod_id INTEGER NOT NULL, version TEXT NOT NULL, filename TEXT NOT NULL, original_filename TEXT NOT NULL, file_size INTEGER DEFAULT 0, uploaded_by TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (mod_id) REFERENCES mods (id) ON DELETE CASCADE, FOREIGN KEY (uploaded_by) REFERENCES users (username))''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS mod_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, mod_id INTEGER NOT NULL, author TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (mod_id) REFERENCES mods (id) ON DELETE CASCADE, FOREIGN KEY (author) REFERENCES users (username))''')

    try:
        cursor.execute("SELECT filename FROM mods LIMIT 0")
        old_mods = cursor.execute('SELECT id, version, filename, original_filename, file_size, uploaded_by, created_at FROM mods').fetchall()
        for mod in old_mods:
            mod_id, version, filename, orig_filename, file_size, uploaded_by, created_at = mod
            if not cursor.execute('SELECT 1 FROM mod_versions WHERE mod_id = ? AND filename = ?', (mod_id, filename)).fetchone():
                cursor.execute('INSERT INTO mod_versions (mod_id, version, filename, original_filename, file_size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', (mod_id, version, filename, orig_filename, file_size, uploaded_by, created_at))
        for col in ['filename', 'original_filename', 'file_size']:
            try: cursor.execute(f"ALTER TABLE mods DROP COLUMN {col}")
            except sqlite3.OperationalError: pass
        conn.commit()
    except sqlite3.OperationalError: pass

    try: cursor.execute("SELECT category FROM mods LIMIT 0")
    except sqlite3.OperationalError:
        cursor.execute("ALTER TABLE mods ADD COLUMN category TEXT DEFAULT 'mod'")
        conn.commit()

    try: cursor.execute("SELECT min_patchwork FROM mods LIMIT 0")
    except sqlite3.OperationalError:
        cursor.execute("ALTER TABLE mods ADD COLUMN min_patchwork TEXT DEFAULT ''")
        conn.commit()

    try: cursor.execute("SELECT discord_id FROM users LIMIT 0")
    except sqlite3.OperationalError:
        cursor.execute("ALTER TABLE users ADD COLUMN discord_id TEXT")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id ON users (discord_id)")
        conn.commit()

    cursor.execute('SELECT username FROM users WHERE username = ?', ('kai',))
    kai_exists = cursor.fetchone() is not None
    if ADMIN_PASSWORD:
        # Env var wins so containers can be provisioned unattended and stay reproducible.
        save_admin_password(cursor, conn, ADMIN_PASSWORD)
        if not kai_exists: print("Password for 'kai' set from WIKI_ADMIN_PASSWORD.\n")
    elif not kai_exists or force_reset_password:
        pwd = prompt_admin_password(exists=kai_exists)
        if pwd:
            save_admin_password(cursor, conn, pwd)
            print("Password saved successfully for 'kai'.\n")
        else:
            print("WARNING: no password set for 'kai' - wiki editing and mod uploads are locked.\n"
                  "         Set WIKI_ADMIN_PASSWORD in the environment and restart, or run:\n"
                  "         python3 app.py --reset-kai-password --init-only\n")

    if cursor.execute('SELECT COUNT(*) FROM pages').fetchone()[0] == 0:
        cursor.execute('INSERT INTO pages (slug, title, content, last_edited_by) VALUES (?, ?, ?, ?)', ('Main_Page', 'Main Page', "Welcome to the Wiki!\n\nCheck out the [[Main Page]] or read about [[Rules]].", 'kai'))
        cursor.execute('INSERT INTO revisions (slug, content, edited_by, summary) VALUES (?, ?, ?, ?)', ('Main_Page', "Welcome to the Wiki!\n\nCheck out the [[Main Page]] or read about [[Rules]].", 'kai', 'Initial page creation'))
        conn.commit()
    conn.close()

def render_wikilinks(text):
    def replace_link(match):
        title = match.group(1).strip()
        return f'<a href="/wiki/{title.replace(" ", "_")}">{title}</a>'
    return re.sub(r'\[\[(.*?)\]\]', replace_link, text)

# --- BLUEPRINTS ---
auth_bp = Blueprint('auth', __name__)
wiki_bp = Blueprint('wiki', __name__)
mods_bp = Blueprint('mods', __name__)
tempmod_bp = Blueprint('tempmod', __name__)

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    base_layout = 'layouts/mods_base.html' if current_app.config.get('IS_MODS_APP') else 'layouts/wiki_base.html'
    if request.method == 'GET':
        # Reached by redirect from the login-gated routes, so it has to answer GET.
        return render_template(
            'auth/login.html',
            page_title="Login",
            header_title="Login",
            current_slug=None,
            page=None,
            meta_description="Log in to Breakmine.",
            error=None
        )
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    if not username or not password:
        return render_template(
            base_layout,
            page_title="Error",
            header_title="Error",
            current_slug=None,
            page=None,
            meta_description="Login error on Breakmine.",
            body_content="<p class=\"error-msg\">Username and password required.</p>"
        ), 401
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    db.close()
    if user and verify_password(user['salt'], user['password_hash'], password):
        session['user'] = username
        return redirect(request.referrer or '/')
    return render_template(
        base_layout,
        page_title="Error",
        header_title="Error",
        current_slug=None,
        page=None,
        meta_description="Invalid login attempt on Breakmine.",
        body_content="<p class=\"error-msg\">Invalid username or password.</p>"
    ), 401

@auth_bp.route('/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return redirect(request.referrer or '/')

@auth_bp.route('/login/discord')
def discord_login():
    if not discord_configured(): return "Discord login is not configured on this server.", 503
    session['discord_state'] = uuid.uuid4().hex
    # Remember where to land afterwards. The callback's own Referer is discord.com.
    target = request.referrer or '/'
    session['discord_next'] = target if target.startswith('/') else '/'
    return redirect('https://discord.com/oauth2/authorize?' + urllib.parse.urlencode({
        'client_id': DISCORD_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': discord_redirect_uri(),
        'scope': DISCORD_SCOPE,
        'state': session['discord_state'],
    }))

@auth_bp.route('/callback')
def discord_callback():
    base_layout = 'layouts/mods_base.html' if current_app.config.get('IS_MODS_APP') else 'layouts/wiki_base.html'
    def fail(message, status):
        return render_template(
            base_layout,
            page_title="Login",
            header_title="Login",
            current_slug=None,
            page=None,
            meta_description="Discord login on Breakmine.",
            body_content=f'<p class="error-msg">{message}</p>'
        ), status
    if request.args.get('error'): return fail("Discord login was cancelled or denied.", 401)
    expected = session.pop('discord_state', None)
    if not request.args.get('code'): return fail("No authorization code from Discord.", 400)
    if not expected or request.args.get('state') != expected:
        return fail("Login session expired or was tampered with. Try again.", 400)
    if not discord_configured(): return fail("Discord login is not configured on this server.", 503)
    try:
        token = discord_api('https://discord.com/api/oauth2/token', data={
            'client_id': DISCORD_CLIENT_ID,
            'client_secret': DISCORD_CLIENT_SECRET,
            'grant_type': 'authorization_code',
            'code': request.args['code'],
            'redirect_uri': discord_redirect_uri(),
        })
        profile = discord_api('https://discord.com/api/v10/users/@me', token=token['access_token'])
        username = user_for_discord(str(profile['id']), profile.get('username') or 'discord')
    except Exception as e:
        traceback.print_exc()
        return fail(f"Discord login failed: {e}", 502)
    session['user'] = username
    target = session.pop('discord_next', '/')
    if not (target.startswith('/') and not target.startswith('//')): target = '/'
    return redirect(target)

@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'GET':
        return render_template(
            'auth/register.html',
            page_title="Register",
            header_title="Create Account",
            current_slug=None,
            page=None,
            meta_description="Create an account for Breakmine: Revived.",
            error=None
        )
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    confirm = request.form.get('confirm', '')
    error = None
    if not re.match(r'^[a-zA-Z0-9_]{2,32}$', username): error = "Invalid username."
    elif len(password) < 4: error = "Password too short."
    elif password != confirm: error = "Passwords do not match."
    else:
        db = get_db()
        if db.execute('SELECT username FROM users WHERE username = ?', (username,)).fetchone(): error = "Username taken."
        else:
            salt, pwd_hash = hash_password(password)
            db.execute('INSERT INTO users (username, salt, password_hash) VALUES (?, ?, ?)', (username, salt, pwd_hash))
            db.commit(); db.close()
            session['user'] = username
            if current_app.config.get('IS_MODS_APP'):
                return redirect(url_for('mods.index'))
            return redirect(url_for('wiki.index'))
        db.close()
    return render_template(
        'auth/register.html',
        page_title="Register",
        header_title="Create Account",
        current_slug=None,
        page=None,
        meta_description="Create an account for Breakmine: Revived.",
        error=error
    )

@wiki_bp.route('/')
def index(): return redirect(url_for('wiki.view_page', slug='Main_Page'))

@wiki_bp.route('/wiki/<slug>')
def view_page(slug):
    db = get_db()
    page = db.execute('SELECT * FROM pages WHERE slug = ?', (slug,)).fetchone()
    db.close()
    if not page:
        return render_template(
            'layouts/wiki_base.html',
            page_title="404",
            header_title="404 - Not Found",
            current_slug=None,
            page=None,
            meta_description="The requested wiki page could not be found.",
            body_content="<p>Does not exist.</p>"
        ), 404
    formatted_content = render_wikilinks(page['content'])
    meta_desc = re.sub(r'\[\[(.*?)\]\]', r'\1', page['content'])[:150].replace('\n', ' ').strip()
    return render_template(
        'wiki/view.html',
        page_title=page['title'],
        header_title=page['title'],
        current_slug=slug,
        page=page,
        meta_description=meta_desc,
        formatted_content=formatted_content
    )

@wiki_bp.route('/history/<slug>')
def page_history(slug):
    db = get_db()
    page = db.execute('SELECT * FROM pages WHERE slug = ?', (slug,)).fetchone()
    revisions = db.execute('SELECT * FROM revisions WHERE slug = ? ORDER BY id DESC', (slug,)).fetchall()
    db.close()
    if not page: return "Not found", 404
    return render_template(
        'wiki/history.html',
        page_title=f"History: {page['title']}",
        header_title=f"{page['title']}",
        current_slug=slug,
        page=page,
        revisions=revisions,
        meta_description=f"Revision history for the {page['title']} article."
    )

@wiki_bp.route('/edit/<slug>')
def edit_page(slug):
    if session.get('user') != 'kai': return "Unauthorized", 403
    db = get_db()
    page = db.execute('SELECT * FROM pages WHERE slug = ?', (slug,)).fetchone()
    db.close()
    if not page: return "Not found", 404
    return render_template(
        'wiki/edit.html',
        page_title=f"Editing {page['title']}",
        header_title=f"{page['title']}",
        current_slug=slug,
        page=page,
        is_new=False,
        meta_description=f"Editing the {page['title']} article."
    )

@wiki_bp.route('/new')
def new_page():
    if session.get('user') != 'kai': return "Unauthorized", 403
    return render_template(
        'wiki/edit.html',
        page_title="Create Article",
        header_title="Create Article",
        current_slug=None,
        page=None,
        is_new=True,
        meta_description="Create a new wiki article."
    )

@wiki_bp.route('/save', methods=['POST'])
def save_page():
    if session.get('user') != 'kai': return "Forbidden", 403
    title = request.form.get('title', '').strip()
    content = request.form.get('content', '')
    summary = request.form.get('summary', '').strip()
    if not title: return "Title required", 400
    slug = title.replace(' ', '_')
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db = get_db()
    db.execute('INSERT INTO pages (slug, title, content, last_edited_by, updated_at) VALUES (?, ?, ?, \'kai\', ?) ON CONFLICT(slug) DO UPDATE SET content=excluded.content, last_edited_by=\'kai\', updated_at=excluded.updated_at', (slug, title, content, now))
    db.execute("INSERT INTO revisions (slug, content, edited_by, summary) VALUES (?, ?, 'kai', ?)", (slug, content, summary))
    db.commit(); db.close()
    return redirect(url_for('wiki.view_page', slug=slug))

@wiki_bp.route('/search')
def search():
    query = request.args.get('q', '').strip()
    db = get_db()
    results = db.execute('SELECT slug, title FROM pages WHERE title LIKE ? OR content LIKE ?', (f'%{query}%', f'%{query}%')).fetchall()
    db.close()
    return render_template(
        'wiki/search.html',
        page_title=f"Search: {query}",
        header_title="Search Results",
        current_slug=None,
        query=query,
        results=results,
        search_query=query,
        meta_description=f"Search results for '{query}' on the Breakmine Wiki."
    )

@wiki_bp.route('/all')
def all_pages():
    db = get_db()
    pages = db.execute('SELECT slug, title FROM pages ORDER BY title ASC').fetchall()
    db.close()
    list_items = "".join([f'<a href="/wiki/{escape(p["slug"])}" class="collection-item">{escape(p["title"])}</a>' for p in pages])
    body = f"<h5>All Articles ({len(pages)})</h5><div class=\"collection\">{list_items}</div>"
    return render_template(
        'layouts/wiki_base.html',
        page_title="All Pages",
        header_title="All Pages",
        current_slug=None,
        page=None,
        meta_description="A complete index of all articles on the Breakmine Wiki.",
        body_content=body
    )

@wiki_bp.route('/proxy-texture')
def proxy_texture():
    url = request.args.get('url')
    if not url: return Response('Missing url', status=400)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})) as resp:
            return Response(resp.read(), mimetype=resp.headers.get('Content-Type', 'image/png'))
    except Exception as e: return Response(str(e), status=500)

def _can_manage(current_user, mod_uploaded_by): return current_user == 'kai' or current_user == mod_uploaded_by

@mods_bp.route('/')
def index():
    q = request.args.get('q', '').strip()
    cat = request.args.get('cat', '').strip()
    sql = '''SELECT m.*, v.id as latest_ver_id, v.file_size FROM mods m JOIN mod_versions v ON m.id = v.mod_id 
             WHERE v.id = (SELECT id FROM mod_versions WHERE mod_id = m.id ORDER BY created_at DESC LIMIT 1)'''
    params = []
    if cat and cat in ('mod', 'texture pack'): sql += " AND m.category = ?"; params.append(cat)
    if q: sql += " AND (m.name LIKE ? OR m.description LIKE ?)"; params.extend([f'%{q}%', f'%{q}%'])
    sql += " ORDER BY m.created_at DESC"
    db = get_db()
    rows = db.execute(sql, params).fetchall(); db.close()
    user = session.get('user')
    mods = [{'id':r['id'], 'name':r['name'], 'category':r['category'], 'version':r['version'], 'min_patchwork':r['min_patchwork'], 'uploaded_by':r['uploaded_by'], 'file_size_formatted':format_file_size(r['file_size']), 'download_count':r['download_count'], 'latest_ver_id':r['latest_ver_id'], 'can_delete':_can_manage(user, r['uploaded_by'])} for r in rows]
    meta_desc = "Browse and download community mods and texture packs for Breakmine: Revived."
    if q: meta_desc = f"Search results for '{q}' in Breakmine mods."
    return render_template(
        'mods/index.html',
        page_title="Mods",
        header_title="Mods",
        mods=mods,
        search_query=q,
        search_cat=cat,
        meta_description=meta_desc
    )

@mods_bp.route('/upload', methods=['GET', 'POST'])
def upload():
    if not session.get('user'): return redirect(url_for('auth.login'))
    if request.method == 'GET':
        return render_template(
            'mods/upload.html',
            page_title="Upload",
            header_title="Upload",
            error=None,
            meta_description="Upload a new mod or texture pack to Breakmine."
        )
    name = request.form.get('name', '').strip()
    category = 'mod' if request.form.get('category') != 'texture pack' else 'texture pack'
    version = request.form.get('version', '1.0.0').strip() or '1.0.0'
    min_patchwork = clean_min_patchwork(request.form.get('min_patchwork'))
    desc = request.form.get('description', '').strip()
    file = request.files.get('file')
    error = None
    if not name: error = "Name required."
    elif min_patchwork is None: error = "Minimum Patchwork version must be 20 characters or fewer."
    elif not file or file.filename == '': error = "No file."
    elif not allowed_file(file.filename): error = "Only .zip allowed."
    else:
        data = file.read()
        if len(data) > MAX_FILE_SIZE: error = "File too large."
        elif len(data) == 0: error = "Empty file."
        else:
            fname = f"{uuid.uuid4().hex}.zip"
            with open(os.path.join(UPLOAD_FOLDER, fname), 'wb') as f: f.write(data)
            db = get_db()
            mid = db.execute('INSERT INTO mods (name, category, version, min_patchwork, description, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)', (name, category, version, min_patchwork, desc, session['user'])).lastrowid
            db.execute('INSERT INTO mod_versions (mod_id, version, filename, original_filename, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)', (mid, version, fname, file.filename, len(data), session['user']))
            db.commit(); db.close()
            return redirect(url_for('mods.index'))
    return render_template(
        'mods/upload.html',
        page_title="Upload",
        header_title="Upload",
        error=error,
        meta_description="Upload a new mod or texture pack to Breakmine."
    )

@mods_bp.route('/view/<int:mod_id>')
def view(mod_id):
    db = get_db()
    mod = db.execute('SELECT * FROM mods WHERE id = ?', (mod_id,)).fetchone()
    if not mod:
        db.close()
        return render_template(
            'layouts/mods_base.html',
            page_title="404",
            header_title="404",
            meta_description="The requested mod could not be found.",
            body_content="<p>Not found.</p>"
        ), 404
    versions = [dict(v, file_size_formatted=format_file_size(v['file_size'])) for v in db.execute('SELECT * FROM mod_versions WHERE mod_id = ? ORDER BY created_at DESC', (mod_id,)).fetchall()]
    comments = db.execute('SELECT * FROM mod_comments WHERE mod_id = ? ORDER BY created_at ASC', (mod_id,)).fetchall()
    db.close()
    user = session.get('user')
    ce = cd = _can_manage(user, mod['uploaded_by'])
    meta_desc = mod['description'][:150].replace('\n', ' ').strip() if mod['description'] else f"Download {mod['name']} v{mod['version']} created by {mod['uploaded_by']}."
    return render_template(
        'mods/view.html',
        page_title=mod['name'],
        header_title=mod['name'],
        mod=mod,
        versions=versions,
        comments=comments,
        can_edit=ce,
        can_delete=cd,
        meta_description=meta_desc
    )

@mods_bp.route('/edit/<int:mod_id>', methods=['GET', 'POST'])
def edit(mod_id):
    if not session.get('user'): return redirect(url_for('auth.login'))
    db = get_db()
    mod = db.execute('SELECT * FROM mods WHERE id = ?', (mod_id,)).fetchone()
    if not mod: db.close(); return "Not found", 404
    if not _can_manage(session['user'], mod['uploaded_by']): db.close(); return "Unauthorized", 403
    if request.method == 'GET':
        db.close()
        return render_template(
            'mods/edit.html',
            page_title="Edit",
            header_title="Edit",
            mod=mod,
            mod_id=mod_id,
            error=None,
            meta_description=f"Editing {mod['name']}."
        )
    name = request.form.get('name', '').strip()
    category = 'mod' if request.form.get('category') != 'texture pack' else 'texture pack'
    min_patchwork = clean_min_patchwork(request.form.get('min_patchwork'))
    desc = request.form.get('description', '').strip()
    error = None if name else "Name required."
    if not error and min_patchwork is None: error = "Minimum Patchwork version must be 20 characters or fewer."
    if not error:
        db.execute('UPDATE mods SET name=?, category=?, min_patchwork=?, description=? WHERE id=?', (name, category, min_patchwork, desc, mod_id))
        db.commit(); db.close()
        return redirect(url_for('mods.view', mod_id=mod_id))
    db.close()
    return render_template(
        'mods/edit.html',
        page_title="Edit",
        header_title="Edit",
        mod=mod,
        mod_id=mod_id,
        error=error,
        meta_description=f"Editing {mod['name']}."
    )

@mods_bp.route('/upload-version/<int:mod_id>', methods=['GET', 'POST'])
def upload_version(mod_id):
    if not session.get('user'): return redirect(url_for('auth.login'))
    db = get_db()
    mod = db.execute('SELECT * FROM mods WHERE id = ?', (mod_id,)).fetchone()
    if not mod or not _can_manage(session['user'], mod['uploaded_by']): db.close(); return "Unauthorized", 403
    if request.method == 'GET':
        db.close()
        parts = re.split(r'[.\-]', mod['version'])
        nv = mod['version']
        if len(parts) > 0 and parts[-1].isdigit(): parts[-1] = str(int(parts[-1]) + 1); nv = ".".join(parts)
        return render_template(
            'mods/upload_version.html',
            page_title="New Version",
            header_title="New Version",
            mod_id=mod_id,
            next_ver=nv,
            error=None,
            meta_description=f"Uploading a new version for {mod['name']}."
        )
    version = request.form.get('version', '').strip()
    file = request.files.get('file')
    error = None
    if not version: error = "Version required."
    elif not file or file.filename == '': error = "No file."
    elif not allowed_file(file.filename): error = "Only .zip allowed."
    else:
        data = file.read()
        if len(data) > MAX_FILE_SIZE: error = "Too large."
        elif len(data) == 0: error = "Empty."
        else:
            fname = f"{uuid.uuid4().hex}.zip"
            with open(os.path.join(UPLOAD_FOLDER, fname), 'wb') as f: f.write(data)
            db.execute('INSERT INTO mod_versions (mod_id, version, filename, original_filename, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)', (mod_id, version, fname, file.filename, len(data), session['user']))
            db.execute('UPDATE mods SET version=? WHERE id=?', (version, mod_id))
            db.commit(); db.close(); return redirect(url_for('mods.view', mod_id=mod_id))
    db.close()
    return render_template(
        'mods/upload_version.html',
        page_title="New Version",
        header_title="New Version",
        mod_id=mod_id,
        next_ver=version,
        error=error,
        meta_description=f"Uploading a new version for {mod['name']}."
    )

@mods_bp.route('/download/<int:mod_id>/v/<int:ver_id>')
def download_version(mod_id, ver_id):
    db = get_db()
    ver = db.execute('SELECT * FROM mod_versions WHERE id=? AND mod_id=?', (ver_id, mod_id)).fetchone()
    if ver: db.execute('UPDATE mods SET download_count = download_count + 1 WHERE id=?', (mod_id,)); db.commit()
    db.close()
    if not ver: return "Not found", 404
    fp = os.path.join(UPLOAD_FOLDER, ver['filename'])
    if not os.path.exists(fp): return "Missing file", 404
    return send_file(fp, as_attachment=True, download_name=ver['original_filename'])

@mods_bp.route('/delete/<int:mod_id>', methods=['GET', 'POST'])
def delete(mod_id):
    if not session.get('user'): return redirect(url_for('auth.login'))
    db = get_db()
    mod = db.execute('SELECT * FROM mods WHERE id=?', (mod_id,)).fetchone()
    if not mod or not _can_manage(session['user'], mod['uploaded_by']): db.close(); return "Unauthorized", 403
    if request.method == 'POST':
        for v in db.execute('SELECT filename FROM mod_versions WHERE mod_id=?', (mod_id,)).fetchall():
            fp = os.path.join(UPLOAD_FOLDER, v['filename'])
            if os.path.exists(fp): os.remove(fp)
        db.execute('DELETE FROM mods WHERE id=?', (mod_id,)); db.commit(); db.close()
        return redirect(url_for('mods.index'))
    db.close()
    return render_template(
        'mods/delete.html',
        page_title="Delete",
        header_title="Delete",
        mod_name=mod['name'],
        mod_id=mod_id,
        meta_description=f"Deleting {mod['name']}."
    )

@mods_bp.route('/delete-version/<int:mod_id>/v/<int:ver_id>', methods=['POST'])
def delete_version(mod_id, ver_id):
    if not session.get('user'): return redirect(url_for('auth.login'))
    db = get_db()
    mod = db.execute('SELECT * FROM mods WHERE id=?', (mod_id,)).fetchone()
    if not mod or not _can_manage(session['user'], mod['uploaded_by']): db.close(); return "Unauthorized", 403
    ver = db.execute('SELECT * FROM mod_versions WHERE id=? AND mod_id=?', (ver_id, mod_id)).fetchone()
    if not ver: db.close(); return "Not found", 404
    if db.execute('SELECT COUNT(*) FROM mod_versions WHERE mod_id=?', (mod_id,)).fetchone()[0] <= 1: db.close(); return "Cannot delete only version.", 400
    fp = os.path.join(UPLOAD_FOLDER, ver['filename'])
    if os.path.exists(fp): os.remove(fp)
    db.execute('DELETE FROM mod_versions WHERE id=?', (ver_id,))
    nw = db.execute('SELECT version FROM mod_versions WHERE mod_id=? ORDER BY created_at DESC LIMIT 1', (mod_id,)).fetchone()
    if nw: db.execute('UPDATE mods SET version=? WHERE id=?', (nw['version'], mod_id))
    db.commit(); db.close()
    return redirect(url_for('mods.view', mod_id=mod_id))

@mods_bp.route('/comment/<int:mod_id>', methods=['POST'])
def add_comment(mod_id):
    if not session.get('user'): return redirect(url_for('auth.login'))
    content = request.form.get('content', '').strip()
    if not content: return redirect(url_for('mods.view', mod_id=mod_id))
    db = get_db()
    if not db.execute('SELECT 1 FROM mods WHERE id=?', (mod_id,)).fetchone(): db.close(); return "Not found", 404
    db.execute('INSERT INTO mod_comments (mod_id, author, content) VALUES (?, ?, ?)', (mod_id, session['user'], content))
    db.commit(); db.close()
    return redirect(url_for('mods.view', mod_id=mod_id))

@mods_bp.route('/comment/<int:mod_id>/del/<int:comment_id>', methods=['POST'])
def delete_comment(mod_id, comment_id):
    if not session.get('user'): return redirect(url_for('auth.login'))
    db = get_db()
    c = db.execute('SELECT * FROM mod_comments WHERE id=? AND mod_id=?', (comment_id, mod_id)).fetchone()
    if not c: db.close(); return "Not found", 404
    if session['user'] != 'kai' and session['user'] != c['author']: db.close(); return "Unauthorized", 403
    db.execute('DELETE FROM mod_comments WHERE id=?', (comment_id,)); db.commit(); db.close()
    return redirect(url_for('mods.view', mod_id=mod_id))

# --- PUBLIC JSON API ---
# Read-only and unauthenticated, so the game client (and anyone else) can read
# the catalogue without a session. Registered on the mods app only, so these
# live on the same host as the download URLs they hand out. Errors come back as
# JSON too, so a client never has to parse Flask's default HTML error page.
api_bp = Blueprint('api', __name__)

# Newest version of each mod. Same join the HTML index uses, so the API and the
# page never disagree about which version is current. Mods always have at least
# one version (the last one cannot be deleted), so this drops nothing.
_LATEST_JOIN = '''FROM mods m JOIN mod_versions v ON m.id = v.mod_id
                 WHERE v.id = (SELECT id FROM mod_versions WHERE mod_id = m.id ORDER BY created_at DESC LIMIT 1)'''

CATEGORIES = ('mod', 'texture pack')

def _api_error(message, status):
    return jsonify({'error': message}), status

def _mod_summary(r):
    """One row of the _LATEST_JOIN query, as used by list and search."""
    return {
        'id': r['id'],
        'name': r['name'],
        'category': r['category'],
        'version': r['version'],
        'min_patchwork': r['min_patchwork'] or None,
        'description': r['description'] or '',
        'author': r['uploaded_by'],
        'downloads': r['download_count'],
        'file_size': r['file_size'],
        'file_size_formatted': format_file_size(r['file_size']),
        'created_at': r['created_at'],
        'url': url_for('mods.view', mod_id=r['id'], _external=True),
        'download_url': url_for('mods.download_version', mod_id=r['id'], ver_id=r['latest_ver_id'], _external=True),
    }

def _mods_json(q, cat):
    sql = 'SELECT m.*, v.id as latest_ver_id, v.file_size ' + _LATEST_JOIN
    params = []
    if cat:
        if cat not in CATEGORIES:
            return _api_error(f"Unknown category '{cat}'. Expected 'mod' or 'texture pack'.", 400)
        sql += " AND m.category = ?"; params.append(cat)
    if q:
        sql += " AND (m.name LIKE ? OR m.description LIKE ?)"; params.extend([f'%{q}%', f'%{q}%'])
    sql += " ORDER BY m.created_at DESC"
    db = get_db()
    rows = db.execute(sql, params).fetchall(); db.close()
    mods = [_mod_summary(r) for r in rows]
    return jsonify({'count': len(mods), 'mods': mods})

@api_bp.route('/api/mods')
def mods_list():
    # Same optional filters as the HTML index, so a client can page through
    # everything or through one category with the same URL shape.
    return _mods_json(request.args.get('q', '').strip(), request.args.get('cat', '').strip())

@api_bp.route('/api/mods/search')
def mods_search():
    q = request.args.get('q', '').strip()
    if not q: return _api_error('Missing required query parameter: q', 400)
    return _mods_json(q, request.args.get('cat', '').strip())

@api_bp.route('/api/mods/<int:mod_id>/files')
def mod_files(mod_id):
    db = get_db()
    mod = db.execute('SELECT id, name, version FROM mods WHERE id=?', (mod_id,)).fetchone()
    if not mod:
        db.close()
        return _api_error('Mod not found', 404)
    rows = db.execute('SELECT * FROM mod_versions WHERE mod_id=? ORDER BY created_at DESC', (mod_id,)).fetchall()
    db.close()
    latest_id = rows[0]['id'] if rows else None
    files = [{
        'version': v['version'],
        'url': url_for('mods.download_version', mod_id=mod_id, ver_id=v['id'], _external=True),
        'filename': v['original_filename'],
        'file_size': v['file_size'],
        'file_size_formatted': format_file_size(v['file_size']),
        'created_at': v['created_at'],
        'latest': v['id'] == latest_id,
    } for v in rows]
    return jsonify({
        'mod': {'id': mod['id'], 'name': mod['name'], 'version': mod['version']},
        'count': len(files),
        'files': files,
    })

@api_bp.route('/api/mods/<int:mod_id>/comments')
def mod_comments(mod_id):
    db = get_db()
    mod = db.execute('SELECT id, name FROM mods WHERE id=?', (mod_id,)).fetchone()
    if not mod:
        db.close()
        return _api_error('Mod not found', 404)
    rows = db.execute('SELECT id, author, content, created_at FROM mod_comments WHERE mod_id=? ORDER BY created_at ASC', (mod_id,)).fetchall()
    db.close()
    comments = [{
        'id': r['id'],
        'author': r['author'],
        'content': r['content'],
        'created_at': r['created_at'],
    } for r in rows]
    return jsonify({
        'mod': {'id': mod['id'], 'name': mod['name']},
        'count': len(comments),
        'comments': comments,
    })

# --- TEMP MOD ROUTES ---

@tempmod_bp.route('/tempmod/upload/<id>', methods=['POST', 'OPTIONS'])
def temp_upload(id):
    if request.method == 'OPTIONS': return Response(status=204)
    
    # Sanitize ID to prevent path traversal
    safe_id = re.sub(r'[^a-zA-Z0-9_\-]', '', id)
    if not safe_id: return "Invalid ID", 400
    
    file = request.files.get('file')
    if not file or file.filename == '': return "No file provided", 400
    if not allowed_file(file.filename): return "Only .zip files are allowed", 400
    
    data = file.read()
    if len(data) > MAX_FILE_SIZE: return "File too large", 400
    if len(data) == 0: return "Empty file", 400
    
    fname = f"temp_{safe_id}.zip"
    filepath = os.path.join(TEMP_UPLOAD_FOLDER, fname)
    
    with open(filepath, 'wb') as f:
        f.write(data)
        
    # Cancel old timer if exists
    if safe_id in temp_timers:
        temp_timers[safe_id].cancel()
        
    # Set new timer for 5 minutes (300 seconds)
    timer = threading.Timer(300.0, delete_temp_file, args=[filepath])
    timer.start()
    temp_timers[safe_id] = timer
    
    return "Uploaded successfully. Expires in 5 minutes.", 200

@tempmod_bp.route('/tempmod/download/<id>', methods=['GET', 'OPTIONS'])
def temp_download(id):
    if request.method == 'OPTIONS': return Response(status=204)
    
    safe_id = re.sub(r'[^a-zA-Z0-9_\-]', '', id)
    if not safe_id: return "Invalid ID", 400
    
    fname = f"temp_{safe_id}.zip"
    filepath = os.path.join(TEMP_UPLOAD_FOLDER, fname)
    
    if not os.path.exists(filepath):
        return "Not found or expired", 404
        
    return send_file(filepath, as_attachment=True, download_name=f"{safe_id}.zip")

# --- APP INSTANTIATION & DUAL RUNNING ---
# Trust Traefik's forwarding headers so url_for(_external=True) and request.is_secure
# see https. Safe because the container only exposes ports to the proxy network.
def behind_proxy(app):
    return ProxyFix(app, x_for=1, x_proto=1, x_host=1)

# Flask caches static files for SEND_FILE_MAX_AGE_DEFAULT (12h by default), so
# a theme tweak would not reach visitors until the cache expired. The theme
# assets are versioned instead: bump this when you edit theme.css or theme.js.
THEME_ASSET_VERSION = 1

wiki_app = Flask(__name__, static_folder='static', static_url_path='/static', template_folder='templates')
wiki_app.secret_key = SECRET_KEY
wiki_app.config['IS_MODS_APP'] = False
wiki_app.wsgi_app = behind_proxy(wiki_app.wsgi_app)
wiki_app.jinja_env.globals['discord_enabled'] = discord_configured()
wiki_app.jinja_env.globals['theme_asset_version'] = THEME_ASSET_VERSION
wiki_app.jinja_env.filters['regex_replace'] = lambda s, find, replace: re.sub(find, replace, str(s))
wiki_app.register_blueprint(auth_bp)
wiki_app.register_blueprint(wiki_bp)

mods_app = Flask(__name__, static_folder='static', static_url_path='/static', template_folder='templates')
mods_app.secret_key = SECRET_KEY
mods_app.config['IS_MODS_APP'] = True
mods_app.wsgi_app = behind_proxy(mods_app.wsgi_app)
mods_app.jinja_env.globals['discord_enabled'] = discord_configured()
mods_app.jinja_env.globals['theme_asset_version'] = THEME_ASSET_VERSION
mods_app.jinja_env.filters['regex_replace'] = lambda s, find, replace: re.sub(find, replace, str(s))
# Mod names and comments are user-typed, so send them as real UTF-8 rather
# than \uXXXX escapes.
mods_app.json.ensure_ascii = False
mods_app.register_blueprint(auth_bp)
mods_app.register_blueprint(mods_bp)
mods_app.register_blueprint(tempmod_bp)
mods_app.register_blueprint(api_bp)

# --- CORS HANDLERS ---
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

@wiki_app.after_request
def wiki_cors(response):
    return add_cors_headers(response)

@mods_app.after_request
def mods_cors(response):
    return add_cors_headers(response)

# WIKI_PORT/MODS_PORT win; PORT is what PaaS proxies (Dokploy, Coolify, Render...)
# inject, so honour it as the fallback or the reverse proxy hits a closed port.
WIKI_PORT = int(os.environ.get('WIKI_PORT') or os.environ.get('PORT') or 8001)
MODS_PORT = int(os.environ.get('MODS_PORT') or 8004)

def serve(app, port, name):
    """Serve one app. Uses waitress when installed, otherwise falls back to werkzeug."""
    try:
        from waitress import serve as waitress_serve
        print(f"Starting {name} on http://0.0.0.0:{port} (waitress)")
        waitress_serve(app, host='0.0.0.0', port=port, threads=8, ident=f'breakmine-{name}')
    except ImportError:
        print(f"Starting {name} on http://0.0.0.0:{port} (werkzeug)")
        run_simple('0.0.0.0', port, app, threaded=True, use_debugger=DEBUG, use_reloader=False)

if __name__ == '__main__':
    reset_pw = '--reset-kai-password' in sys.argv
    init_db(force_reset_password=reset_pw)
    print("Discord login: enabled" if discord_configured() else "Discord login: disabled (set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET)")
    if '--init-only' in sys.argv:
        print("Database initialized. Exiting (--init-only).")
        sys.exit(0)

    # Simple auto-reload implementation using subprocess
    import os
    import subprocess
    from datetime import datetime

    def get_mtime():
        """Get the most recent modification time of relevant files."""
        paths = ['app.py', 'templates/', 'static/']
        max_mtime = 0
        for path in paths:
            if os.path.isfile(path):
                max_mtime = max(max_mtime, os.path.getmtime(path))
            elif os.path.isdir(path):
                for root, dirs, files in os.walk(path):
                    for file in files:
                        file_path = os.path.join(root, file)
                        max_mtime = max(max_mtime, os.path.getmtime(file_path))
        return max_mtime

    # If this is a child process (auto-reload), just run the servers
    if '--no-reload' in sys.argv:
        failures = []
        def run(app, port, name):
            try: serve(app, port, name)
            except Exception as e:
                failures.append(name)
                print(f"ERROR: {name} server stopped: {e}", file=sys.stderr)

        t1 = threading.Thread(target=run, args=(wiki_app, WIKI_PORT, 'Wiki'), daemon=True)
        t2 = threading.Thread(target=run, args=(mods_app, MODS_PORT, 'Mods'), daemon=True)
        t1.start(); t2.start()

        try:
            while not failures and (t1.is_alive() or t2.is_alive()): time.sleep(0.5)
        except KeyboardInterrupt: print("\nShutting down...")
        if failures: sys.exit(1)
    else:
        # Parent process with auto-reload
        def run_child():
            """Run the child process with auto-reload"""
            while True:
                # Remove --no-reload if present, then add it
                args = [arg for arg in sys.argv if arg != '--no-reload']
                args.append('--no-reload')
                
                process = subprocess.Popen([sys.executable] + args)
                last_mtime = get_mtime()
                
                try:
                    while process.poll() is None:
                        time.sleep(1)
                        current_mtime = get_mtime()
                        if current_mtime > last_mtime:
                            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Files changed, restarting...")
                            last_mtime = current_mtime
                            process.terminate()
                            process.wait(timeout=5)
                            if process.poll() is None:
                                process.kill()
                            break
                except KeyboardInterrupt:
                    process.terminate()
                    process.wait(timeout=5)
                    if process.poll() is None:
                        process.kill()
                    print("\nShutting down...")
                    break
        
        run_child()

