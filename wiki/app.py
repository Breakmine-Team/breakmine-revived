import sqlite3
import re
import hashlib
import os
import sys
import getpass
import uuid
import threading
from datetime import datetime
import urllib.request
from flask import Flask, Blueprint, Response, request, redirect, url_for, session, render_template_string, send_file, current_app
from werkzeug.serving import run_simple

SECRET_KEY = 'wikipedia_style_minimal_css_secret_key'
UPLOAD_FOLDER = 'mod_files'
TEMP_UPLOAD_FOLDER = 'temp_mods'
ALLOWED_EXTENSIONS = {'zip'}
MAX_FILE_SIZE = 50 * 1024 * 1024

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

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def format_file_size(size_bytes):
    if size_bytes < 1024: return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024: return f"{size_bytes / 1024:.1f} KB"
    else: return f"{size_bytes / (1024 * 1024):.1f} MB"

def get_db():
    conn = sqlite3.connect('wiki.db', timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn

# --- DATABASE SETUP ---
def init_db(force_reset_password=False):
    conn = sqlite3.connect('wiki.db', timeout=10.0)
    cursor = conn.cursor()
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

    cursor.execute('SELECT username FROM users WHERE username = ?', ('kai',))
    kai_exists = cursor.fetchone() is not None
    if not kai_exists or force_reset_password:
        print("\n--- 'kai' Account Setup ---")
        prompt = "Set password for 'kai': " if not kai_exists else "Set NEW password for 'kai': "
        pwd = getpass.getpass(prompt)
        while not pwd:
            print("Password cannot be empty!")
            pwd = getpass.getpass(prompt)
        salt, pwd_hash = hash_password(pwd)
        cursor.execute('INSERT INTO users (username, salt, password_hash) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt, password_hash=excluded.password_hash', ('kai', salt, pwd_hash))
        conn.commit()
        print("Password saved successfully for 'kai'.\n")

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

# --- TEMPLATES ---
WIKI_LAYOUT_TEMPLATE = """
<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="{{ meta_description | e }}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="{{ page_title | e }} | Breakmine Wiki">
<meta property="og:description" content="{{ meta_description | e }}">
<meta property="og:type" content="website">
<title>{{ page_title | e }} | Breakmine Wiki</title>
<style>
body { margin: 8px; font-family: sans-serif; } * { box-sizing: border-box; }
.wiki-container { display: flex; gap: 10px; align-items: flex-start; width: 100%; }
.wiki-sidebar { width: 220px; flex-shrink: 0; } .wiki-main { flex-grow: 1; min-width: 0; }
body.dark-theme hr { border-color: #444; } body.dark-theme { background-color: #1a1a1a; color: #e0e0e0; }
body.dark-theme a { color: #64b5f6; } body.dark-theme a:hover { color: #90caf9; }
body.dark-theme fieldset { border-color: #444; border-width: 2px; } body.dark-theme legend { color: #e0e0e0; }
body.dark-theme input, body.dark-theme textarea { background-color: #3d3d3d; color: #e0e0e0; border: 1px solid #555; border-radius: 3px; }
body.dark-theme button { background-color: #4d4d4d; color: #e0e0e0; border: 1px solid #555; border-radius: 3px; }
body.dark-theme button:hover { background-color: #5d5d5d; }
.btn { display: inline-block; padding: 3px 10px; text-decoration: none; border: 1px solid #999; border-radius: 3px; font-size: small; color: inherit; }
.btn:hover { background-color: #ddd; } body.dark-theme .btn { border-color: #666; color: #e0e0e0; } body.dark-theme .btn:hover { background-color: #4d4d4d; }
.error-msg { color: #c00; } body.dark-theme .error-msg { color: #f66; }
</style></head><body>
<div style="margin-bottom: 5px; font-size: larger;"><i>Breakmine: Revived</i> Wiki</div>
<div class="wiki-container"><fieldset class="wiki-sidebar"><legend>Controls</legend>
{% if session.get('user') %}
    <div style="margin-bottom: 4px;"><small>Logged in as: <strong>{{ session['user'] }}</strong></small></div>
    <form action="{{ url_for('auth.logout') }}" method="post" style="display:inline;"><button type="submit">Log Out</button></form>
{% else %}
    <form action="{{ url_for('auth.login') }}" method="post">
        <label for="username"><small>User:</small></label><br><input type="text" id="username" name="username" size="14" required>
        <label for="password"><small>Pass:</small></label><br><input type="password" id="password" name="password" size="14" required>
        <button type="submit">></button>
    </form>
    <div style="margin-top:4px;"><small><a href="{{ url_for('auth.register') }}">Register</a></small></div>
{% endif %}
<hr><form action="{{ url_for('wiki.search') }}" method="get">
    <label for="q"><small>Find Article:</small></label><br><input type="text" id="q" name="q" value="{{ search_query or '' }}" size="14" required>
    <button type="submit">></button>
</form><hr>
<label for="theme-toggle"><small>Dark Theme:</small></label><br><button type="button" onclick="toggleTheme()" id="theme-toggle">Toggle</button><hr>
<p><strong>Navigation</strong></p><ul>
    <li><a href="{{ url_for('wiki.view_page', slug='Main_Page') }}">Main Page</a></li>
    <li><a href="{{ url_for('wiki.view_page', slug='Patchwork') }}">Patchwork API</a></li>
    <li><a href="{{ url_for('wiki.all_pages') }}">All Pages</a></li>
</ul>
{% if session.get('user') == 'kai' %}<hr><p><strong>Admin Actions</strong></p><ul><li><a href="{{ url_for('wiki.new_page') }}">New Page</a></li></ul>{% endif %}
</fieldset>
<fieldset class="wiki-main">
<legend>{{ header_title }} {% if page %} - <small>Last modified: {{ page['updated_at'] }}</small>{% endif %}</legend>
{% if current_slug %}<div>
    <a href="{{ url_for('wiki.view_page', slug=current_slug) }}">[Article]</a> |
    <a href="{{ url_for('wiki.page_history', slug=current_slug) }}">[View History]</a>
    {% if session.get('user') == 'kai' %}| <a href="{{ url_for('wiki.edit_page', slug=current_slug) }}">[Edit]</a>{% endif %}
</div><hr>{% endif %}
<div>{{ body_content | safe }}</div>
</fieldset></div>
<script>
function toggleTheme() { document.body.classList.toggle('dark-theme'); localStorage.setItem('darkTheme', document.body.classList.contains('dark-theme')); }
if (localStorage.getItem('darkTheme') === 'true') { document.body.classList.add('dark-theme'); }
</script></body></html>"""

MODS_LAYOUT_TEMPLATE = """
<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="{{ meta_description | e }}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="{{ page_title | e }} | Breakmine Mods">
<meta property="og:description" content="{{ meta_description | e }}">
<meta property="og:type" content="website">
<title>{{ page_title | e }} | Breakmine Mods</title>
<style>
body { margin: 8px; font-family: sans-serif; } * { box-sizing: border-box; }
.wiki-container { display: flex; gap: 10px; align-items: flex-start; width: 100%; }
.wiki-sidebar { width: 220px; flex-shrink: 0; } .wiki-main { flex-grow: 1; min-width: 0; }
body.dark-theme hr { border-color: #444; } body.dark-theme { background-color: #1a1a1a; color: #e0e0e0; }
body.dark-theme a { color: #64b5f6; } body.dark-theme a:hover { color: #90caf9; }
body.dark-theme fieldset { border-color: #444; border-width: 2px; } body.dark-theme legend { color: #e0e0e0; }
body.dark-theme input, body.dark-theme textarea, body.dark-theme select { background-color: #3d3d3d; color: #e0e0e0; border: 1px solid #555; border-radius: 3px; }
body.dark-theme button { background-color: #4d4d4d; color: #e0e0e0; border: 1px solid #555; border-radius: 3px; }
body.dark-theme button:hover { background-color: #5d5d5d; }
.mod-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
.mod-table th, .mod-table td { border: 1px solid #aaa; padding: 6px 10px; text-align: left; }
.mod-table th { background-color: #e8e8e8; } .mod-table tr:nth-child(even) { background-color: #f5f5f5; } .mod-table tr:hover { background-color: #eee; }
body.dark-theme .mod-table th { background-color: #333; } body.dark-theme .mod-table tr:nth-child(even) { background-color: #2a2a2a; }
body.dark-theme .mod-table tr:hover { background-color: #3a3a3a; } body.dark-theme .mod-table th, body.dark-theme .mod-table td { border-color: #555; }
.btn { display: inline-block; padding: 3px 10px; text-decoration: none; border: 1px solid #999; border-radius: 3px; font-size: small; color: inherit; }
.btn:hover { background-color: #ddd; } body.dark-theme .btn { border-color: #666; color: #e0e0e0; } body.dark-theme .btn:hover { background-color: #4d4d4d; }
.btn-danger { color: #c00; } .btn-danger:hover { background-color: #fee; color: #900; }
body.dark-theme .btn-danger { color: #f66; } body.dark-theme .btn-danger:hover { background-color: #4d2020; color: #f88; }
.error-msg { color: #c00; } body.dark-theme .error-msg { color: #f66; }
.comment-box { border: 1px solid #aaa; padding: 10px; margin-bottom: 10px; border-radius: 4px; background-color: #fafafa; }
body.dark-theme .comment-box { border-color: #555; background-color: #2a2a2a; }
.comment-header { font-size: small; color: #666; margin-bottom: 5px; } body.dark-theme .comment-header { color: #999; }
.version-list { list-style: none; padding: 0; } .version-list li { margin-bottom: 5px; }
.mods-search-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 15px; }
.mods-search-bar input[type="text"] { flex-grow: 1; padding: 4px; } .mods-search-bar select { padding: 4px; }
</style></head><body>
<div style="margin-bottom: 5px; font-size: larger;"><i>Breakmine: Revived</i> Mods</div>
<div class="wiki-container"><fieldset class="wiki-sidebar"><legend>Controls</legend>
{% if session.get('user') %}
    <div style="margin-bottom: 4px;"><small>Logged in as: <strong>{{ session['user'] }}</strong></small></div>
    <form action="{{ url_for('auth.logout') }}" method="post" style="display:inline;"><button type="submit">Log Out</button></form>
{% else %}
    <form action="{{ url_for('auth.login') }}" method="post">
        <label for="username"><small>User:</small></label><br><input type="text" id="username" name="username" size="14" required>
        <label for="password"><small>Pass:</small></label><br><input type="password" id="password" name="password" size="14" required>
        <button type="submit">></button>
    </form>
    <div style="margin-top:4px;"><small><a href="{{ url_for('auth.register') }}">Register</a></small></div>
{% endif %}
<hr>
<label for="theme-toggle"><small>Dark Theme:</small></label><br><button type="button" onclick="toggleTheme()" id="theme-toggle">Toggle</button><hr>
<p><strong>Navigation</strong></p><ul>
    <li><a href="{{ url_for('mods.index') }}">Mods List</a></li>
</ul>
{% if session.get('user') %}<hr><p><strong>Mod Actions</strong></p><ul><li><a href="{{ url_for('mods.upload') }}">Upload Mod</a></li></ul>{% endif %}
</fieldset>
<fieldset class="wiki-main">
<legend>{{ header_title }}</legend>
<div>{{ body_content | safe }}</div>
</fieldset></div>
<script>
function toggleTheme() { document.body.classList.toggle('dark-theme'); localStorage.setItem('darkTheme', document.body.classList.contains('dark-theme')); }
if (localStorage.getItem('darkTheme') === 'true') { document.body.classList.add('dark-theme'); }
</script></body></html>"""

VIEW_TEMPLATE = "<div style=\"font-size: large;\">{{ formatted_content | safe }}</div>"
EDIT_TEMPLATE = """<form action="{{ url_for('wiki.save_page') }}" method="post"><p><label for="title">Article Title:</label><br>
{% if is_new %}<input type="text" id="title" name="title" required>
{% else %}<input type="text" id="title_display" value="{{ page['title'] }}" disabled><input type="hidden" id="title" name="title" value="{{ page['title'] }}">{% endif %}</p>
<p><label for="content">Article Text (Use [[Page Title]] for wiki links):</label><br><textarea id="content" name="content" rows="18" cols="70" required>{{ page['content'] if page else '' }}</textarea></p>
<p><label for="summary">Edit Summary:</label><br><input type="text" id="summary" name="summary" size="50" placeholder="Describe changes"></p>
<button type="submit">Save Changes</button> <a href="{{ url_for('wiki.view_page', slug=page['slug']) if page else url_for('wiki.index') }}" class="btn">Cancel</a></form>"""
HISTORY_TEMPLATE = "<p>Revision history for <strong>{{ page['title'] }}</strong>:</p><ul>{% for rev in revisions %}<li><strong>{{ rev['created_at'] }}</strong> - {% if rev['summary'] %}{{ rev['summary'] }}{% else %}<em>(no summary)</em>{% endif %}</li>{% endfor %}</ul>"
SEARCH_TEMPLATE = "<h3>Results for \"{{ query }}\"</h3>{% if results %}<ul>{% for item in results %}<li><a href=\"{{ url_for('wiki.view_page', slug=item['slug']) }}\">{{ item['title'] }}</a></li>{% endfor %}</ul>{% else %}<p>No matching articles found.</p>{% endif %}"
REGISTER_TEMPLATE = """{% if error %}<p class="error-msg">{{ error }}</p>{% endif %}<form action="{{ url_for('auth.register') }}" method="post"><p><label for="username">Username:</label><br><input type="text" id="username" name="username" size="30" required minlength="2" maxlength="32"><br><small>2-32 characters, alphanumeric and underscores only.</small></p>
<p><label for="password">Password:</label><br><input type="password" id="password" name="password" size="30" required minlength="4"><br><small>Minimum 4 characters.</small></p>
<p><label for="confirm">Confirm Password:</label><br><input type="password" id="confirm" name="confirm" size="30" required></p>
<button type="submit">Register</button> <a href="/" class="btn">Cancel</a></form>"""

MODS_INDEX_TEMPLATE = """<p>{% if session.get('user') %}<a href="{{ url_for('mods.upload') }}" class="btn">Upload New</a>{% else %}<a href="{{ url_for('auth.register') }}">Log in</a> to upload.{% endif %}</p>
<form action="{{ url_for('mods.index') }}" method="get" class="mods-search-bar">
<input type="text" name="q" value="{{ search_query | e }}" placeholder="Search mods...">
<select name="cat"><option value="">All Categories</option><option value="mod" {% if search_cat == 'mod' %}selected{% endif %}>Mod</option><option value="texture pack" {% if search_cat == 'texture pack' %}selected{% endif %}>Texture Pack</option></select>
<button type="submit">Search</button>{% if search_query or search_cat %}<a href="{{ url_for('mods.index') }}" class="btn">Clear</a>{% endif %}</form>
{% if mods %}<table class="mod-table"><thead><tr><th>Name</th><th>Category</th><th>Version</th><th>Author</th><th>Size</th><th>Downloads</th><th>Actions</th></tr></thead><tbody>
{% for mod in mods %}<tr><td><a href="{{ url_for('mods.view', mod_id=mod['id']) }}">{{ mod['name'] | e }}</a></td><td>{{ mod['category'] | e }}</td><td>{{ mod['version'] | e }}</td><td>{{ mod['uploaded_by'] | e }}</td><td>{{ mod['file_size_formatted'] }}</td><td>{{ mod['download_count'] }}</td><td>
<a href="{{ url_for('mods.download_version', mod_id=mod['id'], ver_id=mod['latest_ver_id']) }}" class="btn">Download</a>{% if can_delete %} <a href="{{ url_for('mods.delete', mod_id=mod['id']) }}" class="btn btn-danger">Delete</a>{% endif %}</td></tr>{% endfor %}
</tbody></table>{% else %}<p>No mods found.</p>{% endif %}"""

MODS_VIEW_TEMPLATE = """<h3>{{ mod['name'] | e }} <small>v{{ mod['version'] | e }}</small></h3>
<table class="mod-table" style="max-width: 600px;"><tr><th>Category</th><td>{{ mod['category'] | e }}</td></tr><tr><th>Author</th><td>{{ mod['uploaded_by'] | e }}</td></tr><tr><th>Current Version</th><td>{{ mod['version'] | e }}</td></tr><tr><th>Downloads</th><td>{{ mod['download_count'] }}</td></tr><tr><th>Uploaded</th><td>{{ mod['created_at'] }}</td></tr>
<tr><th>Description</th><td>{% if mod['description'] %}<pre style="white-space: pre-wrap; margin:0; font-family: inherit;">{{ mod['description'] | e }}</pre>{% else %}<em>No description.</em>{% endif %}</td></tr></table>
<div style="margin-top: 15px;"><h4>Versions</h4><ul class="version-list">{% for ver in versions %}<li><strong>v{{ ver['version'] | e }}</strong> <small>({{ ver['file_size_formatted'] }}) - {{ ver['created_at'] }} by {{ ver['uploaded_by'] | e }}</small>
<a href="{{ url_for('mods.download_version', mod_id=mod['id'], ver_id=ver['id']) }}" class="btn">Download</a>{% if can_edit %} <a href="{{ url_for('mods.delete_version', mod_id=mod['id'], ver_id=ver['id']) }}" class="btn btn-danger" onclick="return confirm('Delete this specific version?');">Del Ver</a>{% endif %}</li>{% endfor %}</ul>
{% if can_edit %}<a href="{{ url_for('mods.upload_version', mod_id=mod['id']) }}" class="btn">Upload New Version</a>{% endif %}</div>
<div style="margin-top: 10px;"><a href="{{ url_for('mods.edit', mod_id=mod['id']) }}" class="btn">Edit Info</a> {% if can_delete %}<a href="{{ url_for('mods.delete', mod_id=mod['id']) }}" class="btn btn-danger">Delete Mod</a>{% endif %} <a href="{{ url_for('mods.index') }}" class="btn">Back to Mods</a></div>
<hr style="margin-top: 20px;"><h4>Comments</h4>
{% if session.get('user') %}<form action="{{ url_for('mods.add_comment', mod_id=mod['id']) }}" method="post" style="margin-bottom: 15px;"><textarea name="content" rows="3" cols="60" placeholder="Leave a comment..." required></textarea><br><button type="submit">Post Comment</button></form>
{% else %}<p><small><a href="{{ url_for('auth.login') }}">Log in</a> to comment.</small></p>{% endif %}
{% if comments %}{% for c in comments %}<div class="comment-box"><div class="comment-header"><strong>{{ c['author'] | e }}</strong> at {{ c['created_at'] }} {% if can_delete or c['author'] == session.get('user') %}<a href="{{ url_for('mods.delete_comment', mod_id=mod['id'], comment_id=c['id']) }}" class="btn btn-danger" style="font-size: x-small; padding: 1px 5px;" onclick="return confirm('Delete?');">Del</a>{% endif %}</div><div style="white-space: pre-wrap;">{{ c['content'] | e }}</div></div>{% endfor %}{% else %}<p><em>No comments yet.</em></p>{% endif %}"""

MODS_UPLOAD_TEMPLATE = """{% if error %}<p class="error-msg">{{ error }}</p>{% endif %}<form action="{{ url_for('mods.upload') }}" method="post" enctype="multipart/form-data"><p><label for="name">Name:</label><br><input type="text" id="name" name="name" size="40" required></p>
<p><label for="category">Category:</label><br><select id="category" name="category"><option value="mod">Mod</option><option value="texture pack">Texture Pack</option></select></p>
<p><label for="version">Version:</label><br><input type="text" id="version" name="version" size="20" value="1.0.0"></p>
<p><label for="description">Description:</label><br><textarea id="description" name="description" rows="6" cols="60"></textarea></p>
<p><label for="file">File (.zip only):</label><br><input type="file" id="file" name="file" accept=".zip" required><br><small>Max 50 MB.</small></p>
<button type="submit">Upload</button> <a href="{{ url_for('mods.index') }}" class="btn">Cancel</a></form>"""

MODS_UPLOAD_VERSION_TEMPLATE = """{% if error %}<p class="error-msg">{{ error }}</p>{% endif %}<form action="{{ url_for('mods.upload_version', mod_id=mod_id) }}" method="post" enctype="multipart/form-data"><p><label for="version">New Version:</label><br><input type="text" id="version" name="version" size="20" value="{{ next_ver }}" required></p>
<p><label for="file">File (.zip only):</label><br><input type="file" id="file" name="file" accept=".zip" required><br><small>Max 50 MB.</small></p>
<button type="submit">Upload Version</button> <a href="{{ url_for('mods.view', mod_id=mod_id) }}" class="btn">Cancel</a></form>"""

MODS_EDIT_TEMPLATE = """{% if error %}<p class="error-msg">{{ error }}</p>{% endif %}<form action="{{ url_for('mods.edit', mod_id=mod_id) }}" method="post"><p><label for="name">Name:</label><br><input type="text" id="name" name="name" size="40" value="{{ mod['name'] | e }}" required></p>
<p><label for="category">Category:</label><br><select id="category" name="category"><option value="mod" {% if mod['category'] == 'mod' %}selected{% endif %}>Mod</option><option value="texture pack" {% if mod['category'] == 'texture pack' %}selected{% endif %}>Texture Pack</option></select></p>
<p><label for="description">Description:</label><br><textarea id="description" name="description" rows="6" cols="60">{{ mod['description'] | e }}</textarea></p>
<button type="submit">Save</button> <a href="{{ url_for('mods.view', mod_id=mod_id) }}" class="btn">Cancel</a></form>"""

MODS_DELETE_TEMPLATE = """<p>Delete <strong>{{ mod_name | e }}</strong> and all files/comments?</p><p><em>This cannot be undone.</em></p><form action="{{ url_for('mods.delete', mod_id=mod_id) }}" method="post"><button type="submit">Yes, Delete</button> <a href="{{ url_for('mods.index') }}" class="btn">Cancel</a></form>"""

# --- BLUEPRINTS ---
auth_bp = Blueprint('auth', __name__)
wiki_bp = Blueprint('wiki', __name__)
mods_bp = Blueprint('mods', __name__)
tempmod_bp = Blueprint('tempmod', __name__)

@auth_bp.route('/login', methods=['POST'])
def login():
    layout = current_app.config.get('LAYOUT', WIKI_LAYOUT_TEMPLATE)
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    if not username or not password:
        body = "<p class=\"error-msg\">Username and password required.</p>"
        return render_template_string(layout, page_title="Error", header_title="Error", current_slug=None, body_content=body, page=None, meta_description="Login error on Breakmine."), 401
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    db.close()
    if user and verify_password(user['salt'], user['password_hash'], password):
        session['user'] = username
        return redirect(request.referrer or '/')
    body = "<p class=\"error-msg\">Invalid username or password.</p>"
    return render_template_string(layout, page_title="Error", header_title="Error", current_slug=None, body_content=body, page=None, meta_description="Invalid login attempt on Breakmine."), 401

@auth_bp.route('/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return redirect(request.referrer or '/')

@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    layout = current_app.config.get('LAYOUT', WIKI_LAYOUT_TEMPLATE)
    if request.method == 'GET':
        body = render_template_string(REGISTER_TEMPLATE, error=None)
        return render_template_string(layout, page_title="Register", header_title="Create Account", current_slug=None, body_content=body, page=None, meta_description="Create an account for Breakmine: Revived.")
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
    body = render_template_string(REGISTER_TEMPLATE, error=error)
    return render_template_string(layout, page_title="Register", header_title="Create Account", current_slug=None, body_content=body, page=None, meta_description="Create an account for Breakmine: Revived.")

@wiki_bp.route('/')
def index(): return redirect(url_for('wiki.view_page', slug='Main_Page'))

@wiki_bp.route('/wiki/<slug>')
def view_page(slug):
    db = get_db()
    page = db.execute('SELECT * FROM pages WHERE slug = ?', (slug,)).fetchone()
    db.close()
    if not page: return render_template_string(WIKI_LAYOUT_TEMPLATE, page_title="404", header_title="404 - Not Found", current_slug=None, body_content="<p>Does not exist.</p>", page=None, meta_description="The requested wiki page could not be found."), 404
    body = render_template_string(VIEW_TEMPLATE, formatted_content=render_wikilinks(page['content']))
    meta_desc = re.sub(r'\[\[(.*?)\]\]', r'\1', page['content'])[:150].replace('\n', ' ').strip()
    return render_template_string(WIKI_LAYOUT_TEMPLATE, page_title=page['title'], header_title=page['title'], current_slug=slug, body_content=body, page=page, meta_description=meta_desc)

@wiki_bp.route('/history/<slug>')
def page_history(slug):
    db = get_db()
    page = db.execute('SELECT * FROM pages WHERE slug = ?', (slug,)).fetchone()
    revisions = db.execute('SELECT * FROM revisions WHERE slug = ? ORDER BY id DESC', (slug,)).fetchall()
    db.close()
    if not page: return "Not found", 404
    body = render_template_string(HISTORY_TEMPLATE, page=page, revisions=revisions)
    return render_template_string(WIKI_LAYOUT_TEMPLATE, page_title=f"History: {page['title']}", header_title=f"History: {page['title']}", current_slug=slug, body_content=body, page=page, meta_description=f"Revision history for the {page['title']} article.")

@wiki_bp.route('/edit/<slug>')
def edit_page(slug):
    if session.get('user') != 'kai': return "Unauthorized", 403
    db = get_db()
    page = db.execute('SELECT * FROM pages WHERE slug = ?', (slug,)).fetchone()
    db.close()
    if not page: return "Not found", 404
    body = render_template_string(EDIT_TEMPLATE, page=page, is_new=False)
    return render_template_string(WIKI_LAYOUT_TEMPLATE, page_title=f"Editing {page['title']}", header_title=f"Editing: {page['title']}", current_slug=slug, body_content=body, page=page, meta_description=f"Editing the {page['title']} article.")

@wiki_bp.route('/new')
def new_page():
    if session.get('user') != 'kai': return "Unauthorized", 403
    body = render_template_string(EDIT_TEMPLATE, page=None, is_new=True)
    return render_template_string(WIKI_LAYOUT_TEMPLATE, page_title="Create Article", header_title="Create Article", current_slug=None, body_content=body, page=None, meta_description="Create a new wiki article.")

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
    body = render_template_string(SEARCH_TEMPLATE, query=query, results=results)
    return render_template_string(WIKI_LAYOUT_TEMPLATE, page_title=f"Search: {query}", header_title="Search Results", current_slug=None, search_query=query, body_content=body, meta_description=f"Search results for '{query}' on the Breakmine Wiki.")

@wiki_bp.route('/all')
def all_pages():
    db = get_db()
    pages = db.execute('SELECT slug, title FROM pages ORDER BY title ASC').fetchall()
    db.close()
    list_items = ""
    for p in pages:
        list_items += '<li><a href="/wiki/' + p["slug"] + '">' + p["title"] + '</a></li>'
    body = f"<h3>All Articles ({len(pages)})</h3><ul>{list_items}</ul>"
    return render_template_string(WIKI_LAYOUT_TEMPLATE, page_title="All Pages", header_title="All Pages", current_slug=None, body_content=body, page=None, meta_description="A complete index of all articles on the Breakmine Wiki.")

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
    mods = [{'id':r['id'], 'name':r['name'], 'category':r['category'], 'version':r['version'], 'uploaded_by':r['uploaded_by'], 'file_size_formatted':format_file_size(r['file_size']), 'download_count':r['download_count'], 'latest_ver_id':r['latest_ver_id'], 'can_delete':_can_manage(user, r['uploaded_by'])} for r in rows]
    body = render_template_string(MODS_INDEX_TEMPLATE, mods=mods, search_query=q, search_cat=cat)
    meta_desc = "Browse and download community mods and texture packs for Breakmine: Revived."
    if q: meta_desc = f"Search results for '{q}' in Breakmine mods."
    return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="Mods", header_title="Mods", body_content=body, meta_description=meta_desc)

@mods_bp.route('/upload', methods=['GET', 'POST'])
def upload():
    if not session.get('user'): return redirect(url_for('auth.login'))
    if request.method == 'GET': return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="Upload", header_title="Upload", body_content=render_template_string(MODS_UPLOAD_TEMPLATE, error=None), meta_description="Upload a new mod or texture pack to Breakmine.")
    name = request.form.get('name', '').strip()
    category = 'mod' if request.form.get('category') != 'texture pack' else 'texture pack'
    version = request.form.get('version', '1.0.0').strip() or '1.0.0'
    desc = request.form.get('description', '').strip()
    file = request.files.get('file')
    error = None
    if not name: error = "Name required."
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
            mid = db.execute('INSERT INTO mods (name, category, version, description, uploaded_by) VALUES (?, ?, ?, ?, ?)', (name, category, version, desc, session['user'])).lastrowid
            db.execute('INSERT INTO mod_versions (mod_id, version, filename, original_filename, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)', (mid, version, fname, file.filename, len(data), session['user']))
            db.commit(); db.close()
            return redirect(url_for('mods.index'))
    return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="Upload", header_title="Upload", body_content=render_template_string(MODS_UPLOAD_TEMPLATE, error=error), meta_description="Upload a new mod or texture pack to Breakmine.")

@mods_bp.route('/view/<int:mod_id>')
def view(mod_id):
    db = get_db()
    mod = db.execute('SELECT * FROM mods WHERE id = ?', (mod_id,)).fetchone()
    if not mod: db.close(); return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="404", header_title="404", body_content="<p>Not found.</p>", meta_description="The requested mod could not be found."), 404
    versions = [dict(v, file_size_formatted=format_file_size(v['file_size'])) for v in db.execute('SELECT * FROM mod_versions WHERE mod_id = ? ORDER BY created_at DESC', (mod_id,)).fetchall()]
    comments = db.execute('SELECT * FROM mod_comments WHERE mod_id = ? ORDER BY created_at ASC', (mod_id,)).fetchall()
    db.close()
    user = session.get('user')
    ce = cd = _can_manage(user, mod['uploaded_by'])
    meta_desc = mod['description'][:150].replace('\n', ' ').strip() if mod['description'] else f"Download {mod['name']} v{mod['version']} created by {mod['uploaded_by']}."
    return render_template_string(MODS_LAYOUT_TEMPLATE, page_title=mod['name'], header_title=mod['name'], body_content=render_template_string(MODS_VIEW_TEMPLATE, mod=mod, versions=versions, comments=comments, can_edit=ce, can_delete=cd), meta_description=meta_desc)

@mods_bp.route('/edit/<int:mod_id>', methods=['GET', 'POST'])
def edit(mod_id):
    if not session.get('user'): return redirect(url_for('auth.login'))
    db = get_db()
    mod = db.execute('SELECT * FROM mods WHERE id = ?', (mod_id,)).fetchone()
    if not mod: db.close(); return "Not found", 404
    if not _can_manage(session['user'], mod['uploaded_by']): db.close(); return "Unauthorized", 403
    if request.method == 'GET': db.close(); return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="Edit", header_title="Edit", body_content=render_template_string(MODS_EDIT_TEMPLATE, mod=mod, mod_id=mod_id, error=None), meta_description=f"Editing {mod['name']}.")
    name = request.form.get('name', '').strip()
    category = 'mod' if request.form.get('category') != 'texture pack' else 'texture pack'
    desc = request.form.get('description', '').strip()
    error = None if name else "Name required."
    if not error: db.execute('UPDATE mods SET name=?, category=?, description=? WHERE id=?', (name, category, desc, mod_id)); db.commit(); db.close(); return redirect(url_for('mods.view', mod_id=mod_id))
    db.close()
    return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="Edit", header_title="Edit", body_content=render_template_string(MODS_EDIT_TEMPLATE, mod=mod, mod_id=mod_id, error=error), meta_description=f"Editing {mod['name']}.")

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
        return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="New Ver", header_title="New Ver", body_content=render_template_string(MODS_UPLOAD_VERSION_TEMPLATE, mod_id=mod_id, next_ver=nv, error=None), meta_description=f"Uploading a new version for {mod['name']}.")
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
    return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="New Ver", header_title="New Ver", body_content=render_template_string(MODS_UPLOAD_VERSION_TEMPLATE, mod_id=mod_id, next_ver=version, error=error), meta_description=f"Uploading a new version for {mod['name']}.")

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
    return render_template_string(MODS_LAYOUT_TEMPLATE, page_title="Delete", header_title="Delete", body_content=render_template_string(MODS_DELETE_TEMPLATE, mod_name=mod['name'], mod_id=mod_id), meta_description=f"Deleting {mod['name']}.")

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
wiki_app = Flask(__name__)
wiki_app.secret_key = SECRET_KEY
wiki_app.config['LAYOUT'] = WIKI_LAYOUT_TEMPLATE
wiki_app.config['IS_MODS_APP'] = False
wiki_app.register_blueprint(auth_bp)
wiki_app.register_blueprint(wiki_bp)

mods_app = Flask(__name__)
mods_app.secret_key = SECRET_KEY
mods_app.config['LAYOUT'] = MODS_LAYOUT_TEMPLATE
mods_app.config['IS_MODS_APP'] = True
mods_app.register_blueprint(auth_bp)
mods_app.register_blueprint(mods_bp)
mods_app.register_blueprint(tempmod_bp)

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

if __name__ == '__main__':
    reset_pw = '--reset-kai-password' in sys.argv
    init_db(force_reset_password=reset_pw)
    
    print("Starting Wiki on http://0.0.0.0:8001")
    print("Starting Mods on http://0.0.0.0:8004")
    
    def start_wiki(): run_simple('0.0.0.0', 8001, wiki_app, use_debugger=False, use_reloader=False)
    def start_mods(): run_simple('0.0.0.0', 8004, mods_app, use_debugger=False, use_reloader=False)
    
    t1 = threading.Thread(target=start_wiki)
    t2 = threading.Thread(target=start_mods)
    
    t1.start(); t2.start()
    
    try:
        while True: t1.join(timeout=1.0); t2.join(timeout=1.0)
    except KeyboardInterrupt: print("\nShutting down...")
