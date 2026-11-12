const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const { IsomorphicFilesystem } = require('./src/js/net/minecraft/client/fs/IsomorphicFilesystem.js');
const fs = new IsomorphicFilesystem();
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const Logger = require('./src/js/net/minecraft/server/logger.js').default;

// All runtime state lives here: auth.db, secrets.json, uploaded skins and capes.
// Docker mounts a volume over DATA_DIR so accounts and sessions survive rebuilds.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const SKIN_UPLOAD_DIR = path.join(DATA_DIR, 'skins');
const CAPE_UPLOAD_DIR = path.join(DATA_DIR, 'capes');

// Allowlist map and common default cape paths
const CAPE_MAP_FILE = path.join(__dirname, 'USER_CAPE_MAP.txt');
const COMMON_CAPE_PATH = path.join(DATA_DIR, 'common-capes', 'common.png');

function loadOrCreateSecrets() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(SKIN_UPLOAD_DIR, { recursive: true });
    fs.mkdirSync(CAPE_UPLOAD_DIR, { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, 'common-capes'), { recursive: true });

    let secrets = null;
    if (fs.existsSync(SECRETS_FILE)) {
        try {
            secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
        } catch (err) {
            secrets = null;
        }
    }

    if (!secrets || !secrets.jwtSecret || secrets.jwtSecret.length < 64) {
        secrets = {
            jwtSecret: crypto.randomBytes(64).toString('hex'),
            createdAt: new Date().toISOString(),
        };
        Logger.info('Secrets', 'Generated new JWT secret');
    }

    // The admin panel password is generated once and stored beside the JWT
    // secret. ADMIN_PASSWORD overrides it without touching the store.
    if (!secrets.adminPassword || typeof secrets.adminPassword !== 'string') {
        secrets.adminPassword = crypto.randomBytes(12).toString('base64url');
        if (!process.env.ADMIN_PASSWORD) {
            Logger.info('Admin', `Generated admin panel password: ${secrets.adminPassword}`);
        }
    }

    fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    return secrets;
}

const secrets = loadOrCreateSecrets();

const PORT = Number(process.env.PORT) || 6006;
const JWT_EXPIRES_IN = '7d';
const BCRYPT_ROUNDS = 12;
const MAX_SKIN_SIZE = 256 * 1024;
const MAX_CAPE_SIZE = 256 * 1024;

const CAPE_WIDTH = 64;
const CAPE_HEIGHT = 32;

const SITE_DIR = process.env.SITE_DIR || __dirname;
const SITE_HOSTNAMES = new Set(
    (process.env.SITE_HOSTNAMES || 'breakmine.com')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
);

function hostnameOf(req) {
    const raw = req.headers['x-forwarded-host'] || req.headers.host || '';
    return raw.split(',')[0].trim().toLowerCase();
}

// Requests relayed by the WebSocket API arrive from loopback (see
// replayLoopbackRequest). They carry a marker header so the HTTP rate limiters
// step aside: the socket transport does its own per-client limiting, and one
// shared loopback bucket would throttle every WebSocket client at once. The
// header alone is not enough, because anyone could send it over plain HTTP.
function isWsReplay(req) {
    if (req.headers['x-breakmine-ws'] !== '1') return false;
    const address = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    return address === '127.0.0.1' || address === '::1';
}

function getCapeAllowlist() {
    const map = new Map();
    if (!fs.existsSync(CAPE_MAP_FILE)) return map;

    const content = fs.readFileSync(CAPE_MAP_FILE, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const [username, capeFilename] = trimmed.split(/\s+/);
        if (username && capeFilename) {
            map.set(username.toLowerCase(), capeFilename);
        }
    }
    return map;
}

const db = new Database(path.join(DATA_DIR, 'auth.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_login INTEGER,
        skin_path TEXT,
        cape_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    -- Skin history was removed; users.skin_path is the single active skin again.
    DROP TABLE IF EXISTS user_skins;
    CREATE TABLE IF NOT EXISTS revoked_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_jti TEXT UNIQUE NOT NULL,
        revoked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON revoked_tokens(token_jti);
`);

if (!db.prepare('PRAGMA table_info(users)').all().some((col) => col.name === 'cape_path')) {
    db.exec('ALTER TABLE users ADD COLUMN cape_path TEXT');
    Logger.info('Auth', 'Added cape_path column to users');
}

// Admin-managed cape catalog. A cape is uploaded once and then assigned to
// accounts; `cape_choices` remembers which one (or '' for none) a player wears.
db.exec(`
    CREATE TABLE IF NOT EXISTS capes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cape_assignments (
        cape_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        assigned_at INTEGER NOT NULL,
        PRIMARY KEY (cape_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cape_assignments_user ON cape_assignments(user_id);

    CREATE TABLE IF NOT EXISTS cape_choices (
        user_id TEXT PRIMARY KEY,
        cape_id TEXT NOT NULL
    );

    -- Single-use gift codes an admin mints for a cape ("XXX-XXX").
    CREATE TABLE IF NOT EXISTS cape_codes (
        code TEXT PRIMARY KEY,
        cape_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        redeemed_by TEXT,
        redeemed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_cape_codes_cape ON cape_codes(cape_id);
`);

const stmts = {
    createUser: db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'),
    findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findById: db.prepare('SELECT id, username, created_at, last_login, skin_path, cape_path FROM users WHERE id = ?'),
    updateLastLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),
    updateSkinPath: db.prepare('UPDATE users SET skin_path = ? WHERE id = ?'),
    updateCapePath: db.prepare('UPDATE users SET cape_path = ? WHERE id = ?'),
    updatePasswordHash: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    listUsers: db.prepare('SELECT id, username, created_at, last_login, skin_path FROM users ORDER BY username COLLATE NOCASE'),
    revokeToken: db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_jti, revoked_at, expires_at) VALUES (?, ?, ?)'),
    isTokenRevoked: db.prepare('SELECT 1 FROM revoked_tokens WHERE token_jti = ? AND expires_at > ?'),
    cleanExpiredTokens: db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?'),
};

const capeStmts = {
    listCapes: db.prepare('SELECT * FROM capes ORDER BY name COLLATE NOCASE'),
    getCape: db.prepare('SELECT * FROM capes WHERE id = ?'),
    insertCape: db.prepare('INSERT INTO capes (id, name, filename, created_at) VALUES (?, ?, ?, ?)'),
    deleteCape: db.prepare('DELETE FROM capes WHERE id = ?'),
    deleteCapeAssignments: db.prepare('DELETE FROM cape_assignments WHERE cape_id = ?'),
    deleteCapeChoices: db.prepare('DELETE FROM cape_choices WHERE cape_id = ?'),
    assignCape: db.prepare('INSERT OR IGNORE INTO cape_assignments (cape_id, user_id, assigned_at) VALUES (?, ?, ?)'),
    assignCapeToAll: db.prepare('INSERT OR IGNORE INTO cape_assignments (cape_id, user_id, assigned_at) SELECT ?, id, ? FROM users'),
    countCapeAssignments: db.prepare('SELECT COUNT(*) AS count FROM cape_assignments WHERE cape_id = ?'),
    unassignCape: db.prepare('DELETE FROM cape_assignments WHERE cape_id = ? AND user_id = ?'),
    assignmentsForCape: db.prepare('SELECT u.username FROM cape_assignments a JOIN users u ON u.id = a.user_id WHERE a.cape_id = ? ORDER BY u.username COLLATE NOCASE'),
    capesForUser: db.prepare('SELECT c.* FROM capes c JOIN cape_assignments a ON a.cape_id = c.id WHERE a.user_id = ? ORDER BY c.name COLLATE NOCASE'),
    isAssigned: db.prepare('SELECT 1 FROM cape_assignments WHERE cape_id = ? AND user_id = ?'),
    getChoice: db.prepare('SELECT cape_id FROM cape_choices WHERE user_id = ?'),
    setChoice: db.prepare('INSERT INTO cape_choices (user_id, cape_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET cape_id = excluded.cape_id'),
    clearChoice: db.prepare('DELETE FROM cape_choices WHERE user_id = ?'),
    deleteUserAssignments: db.prepare('DELETE FROM cape_assignments WHERE user_id = ?'),
    clearChoiceForCape: db.prepare('DELETE FROM cape_choices WHERE user_id = ? AND cape_id = ?'),
    insertCapeCode: db.prepare('INSERT INTO cape_codes (code, cape_id, created_at) VALUES (?, ?, ?)'),
    getCapeCode: db.prepare('SELECT code, cape_id, created_at, redeemed_by, redeemed_at FROM cape_codes WHERE code = ?'),
    redeemCapeCode: db.prepare('UPDATE cape_codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ? AND redeemed_by IS NULL'),
    deleteCapeCodes: db.prepare('DELETE FROM cape_codes WHERE cape_id = ?'),
    capeCodeCounts: db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN redeemed_by IS NULL THEN 1 ELSE 0 END), 0) AS unused FROM cape_codes WHERE cape_id = ?'),
    listCapeCodes: db.prepare('SELECT code, redeemed_by, redeemed_at FROM cape_codes WHERE cape_id = ? ORDER BY created_at DESC LIMIT 200'),
};

setInterval(() => stmts.cleanExpiredTokens.run(Date.now()), 3600000);

// OAuth clients and the single-use authorization codes handed to them. Codes
// are stored hashed: the plain code only ever exists in the redirect that
// delivers it to the site.
db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_secret_hash TEXT,
        name TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used INTEGER
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL,
        code_challenge TEXT,
        code_challenge_method TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON oauth_codes(client_id);
`);

const oauthStmts = {
    insertClient: db.prepare('INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, verified, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    upsertTrustedClient: db.prepare(`INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, verified, created_at)
        VALUES (?, NULL, ?, ?, 1, ?)
        ON CONFLICT(client_id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris, verified = 1`),
    getClient: db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?'),
    touchClient: db.prepare('UPDATE oauth_clients SET last_used = ? WHERE client_id = ?'),
    insertCode: db.prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    getCode: db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?'),
    consumeCode: db.prepare('UPDATE oauth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL'),
    cleanCodes: db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?'),
};

setInterval(() => oauthStmts.cleanCodes.run(Date.now() - 86400000), 900000);

function isSupportedSkinSize(width, height) {
    if (width === 64 && (height === 32 || height === 64)) return true;
    // HD skins keep the 64px layout scaled by a whole number. Modern skins are
    // square; some older HD skins use a half-height (128x64, 256x128) layout.
    return width >= 128 && width % 64 === 0 && (height === width || height * 2 === width);
}

function isSupportedCapeSize(width, height) {
    // Classic capes are 64x32. HD capes keep that layout scaled by a whole
    // number (128x64, 256x128, ...), which is what the client renders from.
    if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
    return width > 0 && width % CAPE_WIDTH === 0 && height * 2 === width;
}

function removeSkinFile(filename) {
    if (!filename) return;
    const skinPath = path.resolve(SKIN_UPLOAD_DIR, filename);
    if (fs.existsSync(skinPath)) fs.unlinkSync(skinPath);
}

async function sendSkinFile(res, filename) {
    const skinPath = path.resolve(SKIN_UPLOAD_DIR, filename);
    if (!fs.existsSync(skinPath)) return false;

    const image = sharp(skinPath);
    const metadata = await image.metadata();

    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
    if (metadata.width === 64 && metadata.height === 64) {
        image.extract({ left: 0, top: 0, width: 64, height: 32 }).png().pipe(res);
    } else {
        res.sendFile(skinPath);
    }
    return true;
}

const app = express();

// Traefik is the only hop in front of this container, so trust its
// X-Forwarded-For header. Without this, express-rate-limit rejects requests
// with ERR_ERL_UNEXPECTED_X_FORWARDED_FOR instead of limiting by client IP.
// Override TRUST_PROXY if another proxy (for example Cloudflare) is in front.
const trustProxyEnv = String(process.env.TRUST_PROXY ?? '1').trim();
const trustProxy = trustProxyEnv === ''
    ? 1
    : /^\d+$/.test(trustProxyEnv)
        ? Number(trustProxyEnv)
        : trustProxyEnv === 'false'
            ? false
            : trustProxyEnv === 'true'
                ? true
                : trustProxyEnv;
app.set('trust proxy', trustProxy);

const CORS_ALLOWLIST = new Set(
    (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((o) => o.trim().toLowerCase())
        .filter(Boolean)
);
const CORS_WIDE_OPEN = CORS_ALLOWLIST.size === 0;

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
    origin: CORS_WIDE_OPEN ? '*' : (origin, callback) => {
        if (!origin || CORS_ALLOWLIST.has(origin.toLowerCase())) return callback(null, true);
        callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Type', 'Content-Length'],
    maxAge: 86400,
}));

const CATALOG_PATH = path.join(__dirname, 'catalog.json');
const LINKSET_TYPE = 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

function sendCatalog(req, res) {
    fs.readFile(CATALOG_PATH, (err, body) => {
        if (err) return res.status(404).json({ error: 'API catalog not found' });
        res.set('Content-Type', LINKSET_TYPE);
        res.set('Cache-Control', 'public, max-age=3600');
        res.status(200).send(body);
    });
}

app.get('/.well-known/api-catalog', sendCatalog);

app.get('/catalog.json', (req, res) => {
    res.set('Content-Type', LINKSET_TYPE);
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(CATALOG_PATH);
});

app.get('/openapi.json', (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, 'openapi.json'));
});

app.get('/api-docs.html', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, 'api-docs.html'));
});

const serveSite = express.static(SITE_DIR, { index: 'index.html', fallthrough: true });
app.use((req, res, next) => {
    if (!SITE_HOSTNAMES.has(hostnameOf(req))) return next();
    return serveSite(req, res, next);
});

app.get('/robots.txt', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(`# robots.txt for breakmine.com
# Per RFC 9309: https://www.rfc-editor.org/rfc/rfc9309

User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /data/
Disallow: /players/
Disallow: /worlds/

Sitemap: https://breakmine.com/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
    const sitemapPath = path.join(__dirname, 'sitemap.xml');
    if (fs.existsSync(sitemapPath)) {
        res.set('Content-Type', 'application/xml');
        res.sendFile(sitemapPath);
    } else {
        res.status(404).json({ error: 'Sitemap not found' });
    }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

const authLimiter = rateLimit({ windowMs: 900000, max: 10, skip: isWsReplay });
const adminLimiter = rateLimit({ windowMs: 900000, max: 20, skip: isWsReplay });
const redeemLimiter = rateLimit({ windowMs: 900000, max: 20, skip: isWsReplay });

function makeUploader(destination, maxSize) {
    return multer({
        storage: multer.diskStorage({
            destination,
            filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.png'),
        }),
        limits: { fileSize: maxSize },
        fileFilter: (req, file, cb) => {
            cb(file.mimetype === 'image/png' ? null : new Error('Only PNG images are allowed'), file.mimetype === 'image/png');
        },
    });
}

const upload = makeUploader(SKIN_UPLOAD_DIR, MAX_SKIN_SIZE);

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    try {
        const decoded = jwt.verify(authHeader.slice(7), secrets.jwtSecret, { algorithms: ['HS256'] });
        if (stmts.isTokenRevoked.get(decoded.jti, Date.now())) {
            return res.status(401).json({ error: 'Token has been revoked' });
        }
        if (!stmts.findById.get(decoded.sub)) {
            return res.status(401).json({ error: 'Account no longer exists' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' });
    }
}

function validateUsername(username) {
    if (!username || typeof username !== 'string') return { valid: false, error: 'Username is required' };
    const trimmed = username.trim();
    if (trimmed.length < 3) return { valid: false, error: 'Username must be at least 3 characters' };
    if (trimmed.length > 32) return { valid: false, error: 'Username must be 32 characters or less' };
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
    return { valid: true, value: trimmed };
}

function validatePassword(password) {
    if (!password || typeof password !== 'string') return { valid: false, error: 'Password is required' };
    if (password.length < 6) return { valid: false, error: 'Password must be at least 6 characters' };
    if (password.length > 128) return { valid: false, error: 'Password must be 128 characters or less' };
    return { valid: true, value: password };
}

app.get('/', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' }));
app.get('/api/status', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' }));

app.post('/api/register', async (req, res) => {
    try {
        const usernameVal = validateUsername(req.body.username);
        if (!usernameVal.valid) return res.status(400).json({ error: usernameVal.error });

        const passwordVal = validatePassword(req.body.password);
        if (!passwordVal.valid) return res.status(400).json({ error: passwordVal.error });

        if (stmts.findByUsername.get(usernameVal.value)) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const hash = await bcrypt.hash(passwordVal.value, BCRYPT_ROUNDS);
        stmts.createUser.run(uuidv4(), usernameVal.value, hash, Date.now());

        Logger.info('Auth', `Registered: ${usernameVal.value}`);
        res.status(201).json({ message: 'User created successfully', username: usernameVal.value });
    } catch (err) {
        Logger.error('Auth', `Register failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const usernameVal = validateUsername(req.body.username);
        if (!usernameVal.valid) return res.status(400).json({ error: usernameVal.error });

        const passwordVal = validatePassword(req.body.password);
        if (!passwordVal.valid) return res.status(400).json({ error: passwordVal.error });

        const user = stmts.findByUsername.get(usernameVal.value);
        if (!user) {
            await bcrypt.compare(passwordVal.value, '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
            Logger.warn('Auth', `Failed login attempt: ${usernameVal.value}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!(await bcrypt.compare(passwordVal.value, user.password_hash))) {
            Logger.warn('Auth', `Failed login attempt: ${usernameVal.value}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const jti = uuidv4();
        const token = jwt.sign({ sub: user.id, username: user.username, jti }, secrets.jwtSecret, {
            expiresIn: JWT_EXPIRES_IN,
            algorithm: 'HS256',
            issuer: 'auth-server',
        });

        stmts.updateLastLogin.run(Date.now(), user.id);
        Logger.info('Auth', `Login: ${usernameVal.value}`);
        res.json({ token, expiresIn: JWT_EXPIRES_IN });
    } catch (err) {
        Logger.error('Auth', `Login failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/logout', authenticateToken, (req, res) => {
    try {
        const decoded = jwt.decode(req.headers.authorization.slice(7));
        stmts.revokeToken.run(req.user.jti, Date.now(), decoded.exp * 1000);
        Logger.info('Auth', `Logout: ${req.user.username}`);
        res.json({ message: 'Logged out successfully' });
    } catch (err) {
        Logger.error('Auth', `Logout failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/user/:username', (req, res) => {
    try {
        const usernameVal = validateUsername(req.params.username);
        if (!usernameVal.valid) return res.status(400).json({ error: 'Invalid username' });

        const user = stmts.findByUsername.get(usernameVal.value);
        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({
            username: user.username,
            created_at: user.created_at,
            last_login: user.last_login,
            has_skin: !!user.skin_path,
            has_cape: (() => {
                const choice = capeStmts.getChoice.get(user.id);
                return !!choice && choice.cape_id !== '';
            })(),
        });
    } catch (err) {
        Logger.error('Auth', `GetUser failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/upload_skin', authenticateToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const user = stmts.findById.get(req.user.sub);
        const previousSkin = user?.skin_path;
        stmts.updateSkinPath.run(req.file.filename, req.user.sub);

        if (previousSkin && previousSkin !== req.file.filename) {
            removeSkinFile(previousSkin);
        }

        Logger.info('Skin', `Uploaded: ${req.user.username}`);
        res.json({ message: 'Skin uploaded successfully', filename: req.file.filename });
    } catch (err) {
        Logger.error('Skin', `Upload failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/skin/:username', async (req, res) => {
    try {
        const usernameVal = validateUsername(req.params.username);
        if (!usernameVal.valid) return res.status(400).json({ error: 'Invalid username' });

        const user = stmts.findByUsername.get(usernameVal.value);
        if (!user || !user.skin_path) return res.status(404).json({ error: 'Skin not found' });

        if (!await sendSkinFile(res, user.skin_path)) {
            stmts.updateSkinPath.run(null, user.id);
            return res.status(404).json({ error: 'Skin not found' });
        }
    } catch (err) {
        Logger.error('Skin', `GetSkin failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Explicitly disable user cape uploads
app.post('/api/upload_cape', authenticateToken, (req, res) => {
    res.status(403).json({ error: 'User-uploaded capes are disabled' });
});

app.get('/cape/:username', (req, res) => {
    try {
        const usernameVal = validateUsername(req.params.username);
        if (!usernameVal.valid) return res.status(400).json({ error: 'Invalid username' });

        const user = stmts.findByUsername.get(usernameVal.value);
        const requestedId = typeof req.query.id === 'string' ? req.query.id : null;

        // An explicit picker request: only serve capes assigned to that
        // account, so guessing an id cannot reveal someone else's cape.
        if (user && requestedId && requestedId !== 'common') {
            const cape = capeStmts.getCape.get(requestedId);
            if (cape && capeStmts.isAssigned.get(cape.id, user.id) && sendCapeFile(res, cape.filename)) {
                return;
            }
            return res.status(404).json({ error: 'Cape not found' });
        }

        // The account's saved choice. An empty choice means "no cape"; no row
        // means fall back to the allowlist/common cape below.
        if (user && !requestedId) {
            const choice = capeStmts.getChoice.get(user.id);

            if (choice) {
                if (choice.cape_id === '') return res.status(404).json({ error: 'No cape' });

                const cape = capeStmts.getCape.get(choice.cape_id);
                if (cape && capeStmts.isAssigned.get(cape.id, user.id) && sendCapeFile(res, cape.filename)) {
                    return;
                }
            }
        }

        // 1. Check USER_CAPE_MAP.txt allowlist
        const capeAllowlist = getCapeAllowlist();
        if (user && capeAllowlist.has(user.username.toLowerCase())) {
            const customCapeFile = capeAllowlist.get(user.username.toLowerCase());
            const customCapePath = path.resolve(CAPE_UPLOAD_DIR, customCapeFile);

            if (fs.existsSync(customCapePath)) {
                res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
                return res.sendFile(customCapePath);
            }
        }

        // 2. Fallback: serve common cape for all non-allowlisted users
        if (fs.existsSync(COMMON_CAPE_PATH)) {
            res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
            return res.sendFile(COMMON_CAPE_PATH);
        }

        res.status(404).json({ error: 'Cape not found' });
    } catch (err) {
        Logger.error('Cape', `GetCape failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Cape catalog, picker API and admin panel -------------------------------

const ADMIN_COOKIE = 'breakmine_admin';
const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
const CAPE_NAME_MAX = 40;

// Matches the names produced by UsernameGenerator.js exactly:
// Capitalized action + capitalized object + a two-digit number.
const SPAM_USERNAME_ACTIONS = [
    'Jumping', 'Crawling', 'Running', 'Sleeping', 'Waving',
    'Smiling', 'Singing', 'Coding', 'Reading', 'Inventive',
    'Energetic', 'Swift', 'Dancing', 'Frozen', 'Woven',
    'Crimson', 'Shadowy', 'Electric', 'Ransacked', 'Mystic',
];
const SPAM_USERNAME_OBJECTS = [
    'Potato', 'Dolphin', 'Rocket', 'Anchor', 'Planet',
    'Noodle', 'Kraken', 'Vortex', 'Castle', 'Quasar',
    'Pencil', 'Lantern', 'Walrus', 'Comet', 'Pixel',
    'Goblin', 'Phantom', 'Tsunami', 'Phoenix', 'Sprocket',
];
const SPAM_USERNAME_PATTERN = new RegExp(
    `^(?:${SPAM_USERNAME_ACTIONS.join('|')})(?:${SPAM_USERNAME_OBJECTS.join('|')})[1-9][0-9]$`
);

function getAdminPassword() {
    return process.env.ADMIN_PASSWORD || secrets.adminPassword;
}

function constantTimeEquals(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function readCookies(req) {
    const cookies = {};
    const header = req.headers.cookie;
    if (!header) return cookies;

    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        const name = part.slice(0, index).trim();
        if (!name) continue;
        try {
            cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
        } catch (err) {
            // Ignore malformed cookie values.
        }
    }
    return cookies;
}

function getAdminSession(req) {
    const token = readCookies(req)[ADMIN_COOKIE];
    if (!token) return null;

    try {
        const decoded = jwt.verify(token, secrets.jwtSecret, { algorithms: ['HS256'] });
        return decoded && decoded.admin === true ? decoded : null;
    } catch (err) {
        return null;
    }
}

function requireAdmin(req, res, next) {
    if (!getAdminSession(req)) return res.redirect('/admin');
    next();
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}

function adminStyles() {
    return `
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; background: #14161a; color: #e6e6e6; font: 14px/1.45 system-ui, sans-serif; }
        h1 { font-size: 20px; margin: 0 0 16px; }
        h2 { font-size: 16px; margin: 24px 0 10px; }
        a { color: #7fb8ff; }
        .card { max-width: 420px; margin: 60px auto; background: #1c2026; border: 1px solid #2c323a; border-radius: 10px; padding: 20px; }
        label { display: block; margin-bottom: 12px; font-size: 13px; color: #b9c0c9; }
        input[type=text], input[type=password], input[type=file], select { width: 100%; margin-top: 4px; padding: 8px; background: #12151a; border: 1px solid #303742; border-radius: 6px; color: inherit; }
        button { padding: 6px 12px; background: #2f6fed; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
        button.danger { background: #a83232; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 10px; border-bottom: 1px solid #2a3038; vertical-align: top; }
        .thumb { width: 40px; height: 56px; image-rendering: pixelated; background: #0e1013; border-radius: 4px; }
        .muted { color: #8d97a3; font-size: 12px; }
        .pill { display: inline-flex; align-items: center; gap: 4px; background: #262d36; border-radius: 999px; padding: 2px 4px 2px 8px; margin: 0 4px 4px 0; }
        .pill button { background: transparent; color: #aab4c0; padding: 0 4px; font-size: 14px; }
        form.inline { display: inline; }
        .assign { margin-top: 6px; display: flex; gap: 6px; }
        .assign input { width: 180px; }
        .actions { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .actions input[type=file] { width: 180px; }
        .actions input[type=password] { width: 170px; }
        .actions select { width: 190px; }
        .msg { padding: 8px 10px; border-radius: 6px; background: #1d3a26; color: #9fe0b1; margin-bottom: 12px; }
        .error { padding: 8px 10px; border-radius: 6px; background: #3a1d1d; color: #ffb4b4; margin-bottom: 12px; }
        .topbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 18px; }
        .topbar form { margin: 0; }
        .upload { background: #1c2026; border: 1px solid #2c323a; border-radius: 10px; padding: 16px; margin-bottom: 20px; display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
        .upload label { margin: 0; flex: 1 1 220px; }
        .purge { background: #1c2026; border: 1px solid #2c323a; border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
        .purge-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .purge-actions form { display: flex; gap: 6px; align-items: center; }
        button:disabled { opacity: 0.45; cursor: not-allowed; }
    `;
}

function renderAdminLogin(res, error = '', status = 200) {
    res.status(status).type('html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Breakmine Admin</title><style>${adminStyles()}</style></head>
<body>
    <form class="card" method="post" action="/admin/login">
        <h1>Breakmine Admin</h1>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
        <label>Admin password<input type="password" name="password" autofocus required></label>
        <button type="submit">Sign in</button>
    </form>
</body>
</html>`);
}

function renderAdminPanel(req, res) {
    const capes = capeStmts.listCapes.all();
    const users = stmts.listUsers.all();
    const spamCount = users.filter((user) => SPAM_USERNAME_PATTERN.test(user.username)).length;
    const neverLoggedInSpamCount = users.filter(
        (user) => SPAM_USERNAME_PATTERN.test(user.username) && user.last_login == null
    ).length;
    const message = typeof req.query.msg === 'string' ? req.query.msg : '';
    const error = typeof req.query.err === 'string' ? req.query.err : '';

    const formatDate = (value, fallback) => value ? new Date(value).toLocaleString() : fallback;

    const capeRows = capes.map((cape) => {
        const assigned = capeStmts.assignmentsForCape.all(cape.id).map((row) => row.username);
        const id = encodeURIComponent(cape.id);
        const pills = assigned.length === 0
            ? '<span class="muted">Not assigned to anyone</span>'
            : assigned.map((username) => `<form class="inline" method="post" action="/admin/capes/${id}/unassign">
                    <input type="hidden" name="username" value="${escapeHtml(username)}">
                    <span class="pill">${escapeHtml(username)}<button type="submit" title="Unassign">×</button></span>
                </form>`).join(' ');

        return `<tr>
            <td><img class="thumb" src="/admin/capes/${id}/thumb" alt=""></td>
            <td><strong>${escapeHtml(cape.name)}</strong><div class="muted">${escapeHtml(cape.id)}</div></td>
            <td>${pills}
                <form class="assign" method="post" action="/admin/capes/${id}/assign">
                    <input type="text" name="username" placeholder="username, othername" required>
                    <button type="submit">Assign</button>
                </form>
            </td>
            <td>
                <div class="actions">
                    <form method="post" action="/admin/capes/${id}/assign-all" onsubmit="return confirm('Gift this cape to all ${users.length} registered players?')">
                        <button type="submit"${users.length === 0 ? ' disabled' : ''}>Gift All</button>
                    </form>
                    <form method="post" action="/admin/capes/${id}/unassign-all" onsubmit="return confirm('Remove this cape from all ${assigned.length} assigned players?')">
                        <button class="danger" type="submit"${assigned.length === 0 ? ' disabled' : ''}>Remove All</button>
                    </form>
                    <form method="post" action="/admin/capes/${id}/delete" onsubmit="return confirm('Delete this cape and unassign it from everyone?')">
                        <button class="danger" type="submit">Delete</button>
                    </form>
                </div>
            </td>
        </tr>`;
    }).join('');

    const userRows = users.map((user) => {
        const choice = capeStmts.getChoice.get(user.id);
        const selectedCape = choice ? choice.cape_id : null;
        const userId = encodeURIComponent(user.id);
        const capeOptions = [
            `<option value="default"${selectedCape === null ? ' selected' : ''}>Server default</option>`,
            `<option value="none"${selectedCape === '' ? ' selected' : ''}>No cape</option>`,
            ...capes.map((cape) => `<option value="${escapeHtml(cape.id)}"${selectedCape === cape.id ? ' selected' : ''}>${escapeHtml(cape.name)}</option>`)
        ].join('');

        return `<tr>
            <td><strong>${escapeHtml(user.username)}</strong><div class="muted">${escapeHtml(user.id)}</div></td>
            <td>${formatDate(user.created_at, '—')}</td>
            <td>${formatDate(user.last_login, 'Never')}</td>
            <td>
                <div class="muted">${user.skin_path ? 'Custom skin' : 'Default skin'}</div>
                <form class="actions" method="post" action="/admin/users/${userId}/skin" enctype="multipart/form-data">
                    <input type="file" name="file" accept="image/png" required>
                    <button type="submit">Upload</button>
                </form>
                ${user.skin_path ? `<form method="post" action="/admin/users/${userId}/skin/reset"><button type="submit">Reset skin</button></form>` : ''}
            </td>
            <td>
                <form class="actions" method="post" action="/admin/users/${userId}/cape">
                    <select name="capeId">${capeOptions}</select>
                    <button type="submit">Apply</button>
                </form>
            </td>
            <td>
                <form class="actions" method="post" action="/admin/users/${userId}/password">
                    <input type="password" name="password" minlength="6" maxlength="128" placeholder="New password" autocomplete="new-password" required>
                    <button type="submit">Set</button>
                </form>
            </td>
            <td><form method="post" action="/admin/users/${userId}/delete" onsubmit="return confirm('Delete this player and all their account data?')">
                <button class="danger" type="submit">Delete</button>
            </form></td>
        </tr>`;
    }).join('');

    const purgeBar = `
    <div class="purge">
        <div>
            <strong>Spam cleanup</strong>
            <div class="muted">Matches auto-generated usernames such as JumpingPotato42.</div>
        </div>
        <div class="purge-actions">
            <form method="post" action="/admin/users/purge-spam" onsubmit="return confirm('Delete all ${spamCount} auto-generated spam accounts? This cannot be undone.')">
                <button class="danger" type="submit"${spamCount === 0 ? ' disabled' : ''}>Purge Spam</button>
                <span class="muted">${spamCount} account${spamCount === 1 ? '' : 's'}</span>
            </form>
            <form method="post" action="/admin/users/purge-spam-never-logged-in" onsubmit="return confirm('Delete ${neverLoggedInSpamCount} auto-generated accounts that never logged in? This cannot be undone.')">
                <button class="danger" type="submit"${neverLoggedInSpamCount === 0 ? ' disabled' : ''}>Purge Spam (Never logged in)</button>
                <span class="muted">${neverLoggedInSpamCount} account${neverLoggedInSpamCount === 1 ? '' : 's'}</span>
            </form>
        </div>
    </div>`;

    res.type('html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Breakmine Admin</title><style>${adminStyles()}</style></head>
<body>
    <div class="topbar">
        <h1>Breakmine Admin</h1>
        <form method="post" action="/admin/logout"><button type="submit">Sign out</button></form>
    </div>

    ${message ? `<div class="msg">${escapeHtml(message)}</div>` : ''}
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

    <h2>Capes</h2>
    <form class="upload" method="post" action="/admin/capes" enctype="multipart/form-data">
        <label>Cape name<input type="text" name="name" maxlength="${CAPE_NAME_MAX}" placeholder="e.g. Founder Cape" required></label>
        <label>Cape PNG (64×32 or HD)<input type="file" name="file" accept="image/png" required></label>
        <button type="submit">Upload cape</button>
    </form>

    <table>
        <thead><tr><th></th><th>Name</th><th>Assigned players</th><th></th></tr></thead>
        <tbody>${capeRows || '<tr><td colspan="4" class="muted">No capes uploaded yet.</td></tr>'}</tbody>
    </table>

    <h2>Players</h2>
    ${purgeBar}
    <table>
        <thead><tr><th>Player</th><th>Created</th><th>Last login</th><th>Skin</th><th>Cape</th><th>Password</th><th></th></tr></thead>
        <tbody>${userRows || '<tr><td colspan="7" class="muted">No players registered yet.</td></tr>'}</tbody>
    </table>
</body>
</html>`);
}

function sendCapeFile(res, filename) {
    const capePath = path.resolve(CAPE_UPLOAD_DIR, filename);
    if (!fs.existsSync(capePath)) return false;

    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.sendFile(capePath);
    return true;
}

function capeDataUrl(filename) {
    try {
        const capePath = path.resolve(CAPE_UPLOAD_DIR, filename);
        if (!fs.existsSync(capePath)) return null;
        return 'data:image/png;base64,' + fs.readFileSync(capePath).toString('base64');
    } catch (err) {
        return null;
    }
}

// --- Cape gift codes --------------------------------------------------------
// Admins mint single-use codes shaped "XXX-XXX" for one cape; redeeming a code
// assigns that cape to the account and equips it. Ambiguous characters
// (I, O, 0, 1) are left out so a code can be typed from a screenshot.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_MAX_PER_BATCH = 50;

function compactCapeCode(raw) {
    return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function formatCapeCode(compact) {
    return `${compact.slice(0, 3)}-${compact.slice(3)}`;
}

function generateCapeCode() {
    let compact = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        compact += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    return compact;
}

function createCapeCodes(capeId, count) {
    const codes = [];

    for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < 25; attempt++) {
            const code = formatCapeCode(generateCapeCode());
            try {
                capeStmts.insertCapeCode.run(code, capeId, Date.now());
                codes.push(code);
                break;
            } catch (err) {
                if (!String(err.code || '').includes('SQLITE_CONSTRAINT')) throw err;
            }
        }
    }

    return codes;
}

app.get('/api/capes', authenticateToken, (req, res) => {
    try {
        const capes = capeStmts.capesForUser.all(req.user.sub)
            .map((cape) => ({ id: cape.id, name: cape.name, texture: capeDataUrl(cape.filename) }))
            .filter((cape) => typeof cape.texture === 'string');

        const choice = capeStmts.getChoice.get(req.user.sub);
        res.json({ capes, choice: choice ? choice.cape_id : null });
    } catch (err) {
        Logger.error('Cape', `List failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/cape/choice', authenticateToken, (req, res) => {
    try {
        const raw = req.body ? req.body.capeId : null;

        if (raw === null || raw === undefined) {
            capeStmts.clearChoice.run(req.user.sub);
            return res.json({ choice: null });
        }

        if (typeof raw !== 'string' || raw.length > 64) {
            return res.status(400).json({ error: 'Invalid cape id' });
        }

        if (raw === '') {
            capeStmts.setChoice.run(req.user.sub, '');
            return res.json({ choice: '' });
        }

        const cape = capeStmts.getCape.get(raw);
        if (!cape) return res.status(404).json({ error: 'Cape not found' });
        if (!capeStmts.isAssigned.get(cape.id, req.user.sub)) {
            return res.status(403).json({ error: 'That cape is not assigned to you' });
        }

        capeStmts.setChoice.run(req.user.sub, cape.id);
        res.json({ choice: cape.id });
    } catch (err) {
        Logger.error('Cape', `Choice failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/capes/redeem', authenticateToken, redeemLimiter, (req, res) => {
    const compact = compactCapeCode(req.body?.code);
    if (compact.length !== CODE_LENGTH) {
        return res.status(400).json({ error: 'Gift codes look like ABC-123.' });
    }

    const code = formatCapeCode(compact);
    const entry = capeStmts.getCapeCode.get(code);
    const cape = entry ? capeStmts.getCape.get(entry.cape_id) : null;
    if (!cape) return res.status(404).json({ error: 'That gift code is not valid.' });

    if (entry.redeemed_by) {
        const message = entry.redeemed_by === req.user.sub
            ? `You already redeemed this code for "${cape.name}".`
            : 'That gift code was already redeemed.';
        return res.status(409).json({ error: message });
    }

    try {
        const redeemed = capeStmts.redeemCapeCode.run(req.user.sub, Date.now(), code);
        if (redeemed.changes === 0) {
            return res.status(409).json({ error: 'That gift code was already redeemed.' });
        }

        capeStmts.assignCape.run(cape.id, req.user.sub, Date.now());
        capeStmts.setChoice.run(req.user.sub, cape.id);

        Logger.info('Cape', `${req.user.username || req.user.sub} redeemed cape "${cape.name}" (${code})`);
        res.json({
            message: `Redeemed "${cape.name}"!`,
            cape: { id: cape.id, name: cape.name },
            choice: cape.id,
        });
    } catch (err) {
        Logger.error('Cape', `Redeem failed: ${err.message}`);
        return res.status(500).json({ error: 'Could not redeem that code.' });
    }
});

function purgeSpamAccounts(res, neverLoggedInOnly) {
    try {
        const accounts = stmts.listUsers.all().filter((user) =>
            SPAM_USERNAME_PATTERN.test(user.username) &&
            (!neverLoggedInOnly || user.last_login == null)
        );

        const deleteAccounts = db.transaction((usersToDelete) => {
            for (const user of usersToDelete) {
                capeStmts.deleteUserAssignments.run(user.id);
                capeStmts.clearChoice.run(user.id);
                stmts.deleteUser.run(user.id);
            }
        });
        deleteAccounts(accounts);

        for (const user of accounts) {
            try { removeSkinFile(user.skin_path); } catch (error) {
                Logger.warn('Admin', `Could not delete skin for purged account ${user.username}: ${error.message}`);
            }
        }

        const noun = neverLoggedInOnly ? 'never-logged-in spam account' : 'spam account';
        if (accounts.length === 0) {
            return res.redirect('/admin?msg=' + encodeURIComponent(`No ${noun}s found.`));
        }

        const label = `${accounts.length} ${accounts.length === 1 ? noun : `${noun}s`}`;
        Logger.info('Admin', `Purged ${label}`);
        res.redirect('/admin?msg=' + encodeURIComponent(`Purged ${label}.`));
    } catch (error) {
        Logger.error('Admin', `Spam purge failed: ${error.message}`);
        res.redirect('/admin?err=' + encodeURIComponent('Could not purge spam accounts.'));
    }
}

app.get('/admin', (req, res) => {
    if (!getAdminSession(req)) return renderAdminLogin(res);
    renderAdminPanel(req, res);
});

app.post('/admin/login', adminLimiter, (req, res) => {
    const password = req.body ? req.body.password : '';
    const expected = getAdminPassword();

    if (!expected || !constantTimeEquals(password, expected)) {
        Logger.warn('Admin', 'Failed admin panel login');
        return renderAdminLogin(res, 'Incorrect password.', 401);
    }

    const token = jwt.sign({ admin: true }, secrets.jwtSecret, { expiresIn: '12h', algorithm: 'HS256' });
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const secure = req.secure || forwardedProto === 'https';

    res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}${secure ? '; Secure' : ''}`);
    res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.redirect('/admin');
});

const uploadCape = makeUploader(CAPE_UPLOAD_DIR, MAX_CAPE_SIZE);

app.post('/admin/capes', requireAdmin, (req, res) => {
    uploadCape.single('file')(req, res, async (err) => {
        if (err) {
            return res.redirect('/admin?err=' + encodeURIComponent(err.message || 'Upload failed.'));
        }

        const name = String(req.body?.name || '').trim();
        const file = req.file;

        const fail = (message) => {
            if (file) {
                try { fs.unlinkSync(file.path); } catch (removeError) { /* already gone */ }
            }
            res.redirect('/admin?err=' + encodeURIComponent(message));
        };

        if (!file) return fail('Choose a PNG file.');
        if (name.length < 1 || name.length > CAPE_NAME_MAX) {
            return fail(`Cape name must be 1-${CAPE_NAME_MAX} characters.`);
        }

        try {
            const metadata = await sharp(file.path).metadata();
            if (metadata.format !== 'png' || !isSupportedCapeSize(metadata.width, metadata.height)) {
                return fail('Cape PNG must be 64×32, or HD at a whole multiple of that (128×64, 256×128).');
            }

            const id = uuidv4();
            capeStmts.insertCape.run(id, name, file.filename, Date.now());
            Logger.info('Cape', `Uploaded cape "${name}" (${id})`);
            res.redirect('/admin?msg=' + encodeURIComponent(`Uploaded cape "${name}".`));
        } catch (error) {
            fail('Could not read the uploaded PNG.');
        }
    });
});

app.post('/admin/capes/:id/assign', requireAdmin, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.redirect('/admin?err=' + encodeURIComponent('Cape not found.'));

    const requested = String(req.body?.username || '').split(/[,\s]+/).filter(Boolean);
    if (requested.length === 0) return res.redirect('/admin?err=' + encodeURIComponent('Enter a username.'));

    const assigned = [];
    const unknown = [];

    for (const name of requested) {
        const usernameVal = validateUsername(name);
        const user = usernameVal.valid ? stmts.findByUsername.get(usernameVal.value) : null;
        if (!user) {
            unknown.push(name);
            continue;
        }
        capeStmts.assignCape.run(cape.id, user.id, Date.now());
        assigned.push(user.username);
    }

    const message = assigned.length > 0 ? `Assigned "${cape.name}" to ${assigned.join(', ')}.` : '';
    if (unknown.length > 0) {
        const query = new URLSearchParams();
        if (message) query.set('msg', message);
        query.set('err', `Unknown user${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`);
        return res.redirect('/admin?' + query.toString());
    }

    res.redirect('/admin?msg=' + encodeURIComponent(message));
});

app.post('/admin/capes/:id/assign-all', requireAdmin, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.redirect('/admin?err=' + encodeURIComponent('Cape not found.'));

    try {
        const added = capeStmts.assignCapeToAll.run(cape.id, Date.now()).changes;
        const total = capeStmts.countCapeAssignments.get(cape.id).count;
        Logger.info('Admin', `Gifted cape "${cape.name}" to all players (${added} new assignments)`);

        const message = total === 0
            ? `There are no players to assign "${cape.name}" to.`
            : added === 0
                ? `"${cape.name}" is already assigned to all ${total} player${total === 1 ? '' : 's'}.`
                : `Gifted "${cape.name}" to ${added} player${added === 1 ? '' : 's'} (${total} total).`;
        res.redirect('/admin?msg=' + encodeURIComponent(message));
    } catch (error) {
        Logger.error('Admin', `Gift all cape failed: ${error.message}`);
        res.redirect('/admin?err=' + encodeURIComponent('Could not assign that cape to all players.'));
    }
});

app.post('/admin/capes/:id/unassign-all', requireAdmin, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.redirect('/admin?err=' + encodeURIComponent('Cape not found.'));

    try {
        const removed = db.transaction(() => {
            const result = capeStmts.deleteCapeAssignments.run(cape.id);
            capeStmts.deleteCapeChoices.run(cape.id);
            return result.changes;
        })();
        Logger.info('Admin', `Removed cape "${cape.name}" from all players (${removed} assignments)`);

        const message = removed === 0
            ? `"${cape.name}" was not assigned to any players.`
            : `Removed "${cape.name}" from ${removed} player${removed === 1 ? '' : 's'}.`;
        res.redirect('/admin?msg=' + encodeURIComponent(message));
    } catch (error) {
        Logger.error('Admin', `Remove all cape failed: ${error.message}`);
        res.redirect('/admin?err=' + encodeURIComponent('Could not remove that cape from all players.'));
    }
});

app.post('/admin/capes/:id/unassign', requireAdmin, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    const usernameVal = validateUsername(String(req.body?.username || ''));
    const user = cape && usernameVal.valid ? stmts.findByUsername.get(usernameVal.value) : null;

    if (!cape || !user) return res.redirect('/admin?err=' + encodeURIComponent('User or cape not found.'));

    capeStmts.unassignCape.run(cape.id, user.id);
    capeStmts.clearChoiceForCape.run(user.id, cape.id);
    res.redirect('/admin?msg=' + encodeURIComponent(`Unassigned "${cape.name}" from ${user.username}.`));
});

app.post('/admin/capes/:id/delete', requireAdmin, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.redirect('/admin?err=' + encodeURIComponent('Cape not found.'));

    capeStmts.deleteCapeAssignments.run(cape.id);
    capeStmts.deleteCapeChoices.run(cape.id);
    capeStmts.deleteCapeCodes.run(cape.id);
    capeStmts.deleteCape.run(cape.id);

    try {
        const capePath = path.resolve(CAPE_UPLOAD_DIR, cape.filename);
        if (fs.existsSync(capePath)) fs.unlinkSync(capePath);
    } catch (err) {
        Logger.warn('Cape', `Could not delete cape file: ${err.message}`);
    }

    Logger.info('Cape', `Deleted cape "${cape.name}"`);
    res.redirect('/admin?msg=' + encodeURIComponent(`Deleted cape "${cape.name}".`));
});

app.get('/admin/capes/:id/thumb', requireAdmin, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape || !sendCapeFile(res, cape.filename)) {
        if (!res.headersSent) res.status(404).end();
    }
});

app.post('/admin/users/:id/skin', requireAdmin, (req, res) => {
    upload.single('file')(req, res, async (err) => {
        const user = stmts.findById.get(req.params.id);
        const file = req.file;

        const fail = (message) => {
            if (file) {
                try { fs.unlinkSync(file.path); } catch (removeError) { /* already gone */ }
            }
            res.redirect('/admin?err=' + encodeURIComponent(message));
        };

        if (err) return fail(err.message || 'Upload failed.');
        if (!user) return fail('Player not found.');
        if (!file) return fail('Choose a PNG file.');

        try {
            const metadata = await sharp(file.path).metadata();
            const validSize = isSupportedSkinSize(metadata.width, metadata.height);
            if (metadata.format !== 'png' || !validSize) {
                return fail('Skin PNG must be 64×64, 64×32, or a larger HD skin.');
            }

            const previousSkin = user.skin_path;
            stmts.updateSkinPath.run(file.filename, user.id);
            if (previousSkin && previousSkin !== file.filename) {
                try { removeSkinFile(previousSkin); } catch (error) {
                    Logger.warn('Admin', `Could not delete previous skin for ${user.username}: ${error.message}`);
                }
            }

            Logger.info('Admin', `Changed skin for ${user.username}`);
            res.redirect('/admin?msg=' + encodeURIComponent(`Changed skin for ${user.username}.`));
        } catch (error) {
            fail('Could not read the uploaded PNG.');
        }
    });
});

app.post('/admin/users/:id/skin/reset', requireAdmin, (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.redirect('/admin?err=' + encodeURIComponent('Player not found.'));

    const previousSkin = user.skin_path;
    stmts.updateSkinPath.run(null, user.id);
    if (previousSkin) {
        try { removeSkinFile(previousSkin); } catch (error) {
            Logger.warn('Admin', `Could not delete skin for ${user.username}: ${error.message}`);
        }
    }

    Logger.info('Admin', `Reset skin for ${user.username}`);
    res.redirect('/admin?msg=' + encodeURIComponent(`Reset skin for ${user.username}.`));
});

app.post('/admin/users/:id/cape', requireAdmin, (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.redirect('/admin?err=' + encodeURIComponent('Player not found.'));

    const raw = typeof req.body?.capeId === 'string' ? req.body.capeId : 'default';

    if (raw === 'default') {
        capeStmts.clearChoice.run(user.id);
        return res.redirect('/admin?msg=' + encodeURIComponent(`Reset ${user.username} to the server default cape.`));
    }

    if (raw === 'none') {
        capeStmts.setChoice.run(user.id, '');
        return res.redirect('/admin?msg=' + encodeURIComponent(`Removed the cape from ${user.username}.`));
    }

    const cape = capeStmts.getCape.get(raw);
    if (!cape) return res.redirect('/admin?err=' + encodeURIComponent('Cape not found.'));

    // Assigning through the player row lets the admin change the worn cape
    // directly, without first using the separate cape-assignment form.
    capeStmts.assignCape.run(cape.id, user.id, Date.now());
    capeStmts.setChoice.run(user.id, cape.id);

    Logger.info('Admin', `Set cape "${cape.name}" for ${user.username}`);
    res.redirect('/admin?msg=' + encodeURIComponent(`Set ${user.username}'s cape to ${cape.name}.`));
});

app.post('/admin/users/:id/password', requireAdmin, async (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.redirect('/admin?err=' + encodeURIComponent('Player not found.'));

    const passwordVal = validatePassword(req.body?.password);
    if (!passwordVal.valid) {
        return res.redirect('/admin?err=' + encodeURIComponent(passwordVal.error));
    }

    try {
        const hash = await bcrypt.hash(passwordVal.value, BCRYPT_ROUNDS);
        stmts.updatePasswordHash.run(hash, user.id);
        Logger.info('Admin', `Changed password for ${user.username}`);
        res.redirect('/admin?msg=' + encodeURIComponent(`Changed password for ${user.username}.`));
    } catch (error) {
        Logger.error('Admin', `Could not change password for ${user.username}: ${error.message}`);
        res.redirect('/admin?err=' + encodeURIComponent('Could not change that password.'));
    }
});

app.post('/admin/users/purge-spam', requireAdmin, (req, res) => {
    purgeSpamAccounts(res, false);
});

app.post('/admin/users/purge-spam-never-logged-in', requireAdmin, (req, res) => {
    purgeSpamAccounts(res, true);
});

app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.redirect('/admin?err=' + encodeURIComponent('Player not found.'));

    try {
        capeStmts.deleteUserAssignments.run(user.id);
        capeStmts.clearChoice.run(user.id);
        stmts.deleteUser.run(user.id);

        try { removeSkinFile(user.skin_path); } catch (error) {
            Logger.warn('Admin', `Could not delete skin for ${user.username}: ${error.message}`);
        }

        Logger.info('Admin', `Deleted account: ${user.username}`);
        res.redirect('/admin?msg=' + encodeURIComponent(`Deleted ${user.username}.`));
    } catch (error) {
        Logger.error('Admin', `Could not delete ${user.username}: ${error.message}`);
        res.redirect('/admin?err=' + encodeURIComponent('Could not delete that account.'));
    }
});

// --- JSON admin API ---------------------------------------------------------
// The in-game devtools window (admin() in index.html) talks to these routes.
// The server-rendered /admin panel cannot be embedded: it sends
// X-Frame-Options: SAMEORIGIN and its session cookie is SameSite=Strict, so a
// cross-origin frame could neither render nor keep the session. Every route
// below expects `Authorization: Bearer <admin token>` and returns JSON.

// No isWsReplay skip here: the in-game panel logs in over the WebSocket relay,
// and every relayed request arrives from loopback, so a shared bucket is
// better than no limit on admin password attempts.
const adminApiLimiter = rateLimit({ windowMs: 900000, max: 30 });

function requireAdminToken(req, res, next) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing admin token' });
    }

    try {
        const decoded = jwt.verify(header.slice(7), secrets.jwtSecret, { algorithms: ['HS256'] });
        if (!decoded || decoded.admin !== true) {
            return res.status(403).json({ error: 'Not an admin token' });
        }
        req.admin = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            error: err.name === 'TokenExpiredError' ? 'Admin session expired' : 'Invalid admin token',
        });
    }
}

function decodePngPayload(payload, maxBytes) {
    if (typeof payload !== 'string' || payload.length === 0) return { error: 'Choose a PNG file.' };

    const comma = payload.indexOf(',');
    const base64 = payload.startsWith('data:') && comma !== -1 ? payload.slice(comma + 1) : payload;

    let buffer;
    try {
        buffer = Buffer.from(base64, 'base64');
    } catch (err) {
        return { error: 'Could not read that file.' };
    }

    if (buffer.length === 0) return { error: 'Choose a PNG file.' };
    if (buffer.length > maxBytes) return { error: `File too large. Max ${maxBytes / 1024}KB` };
    return { buffer };
}

function writePngFile(directory, buffer) {
    const filename = crypto.randomBytes(16).toString('hex') + '.png';
    fs.writeFileSync(path.join(directory, filename), buffer);
    return filename;
}

function spamAccountCounts() {
    const users = stmts.listUsers.all();
    return {
        count: users.filter((user) => SPAM_USERNAME_PATTERN.test(user.username)).length,
        neverLoggedInCount: users.filter((user) =>
            SPAM_USERNAME_PATTERN.test(user.username) && user.last_login == null).length,
    };
}

function setUserCape(user, raw) {
    if (raw === 'default') {
        capeStmts.clearChoice.run(user.id);
        return { message: `Reset ${user.username} to the server default cape.` };
    }

    if (raw === 'none') {
        capeStmts.setChoice.run(user.id, '');
        return { message: `Removed the cape from ${user.username}.` };
    }

    const cape = capeStmts.getCape.get(String(raw));
    if (!cape) return { error: 'Cape not found.' };

    capeStmts.assignCape.run(cape.id, user.id, Date.now());
    capeStmts.setChoice.run(user.id, cape.id);
    return { message: `Set ${user.username}'s cape to ${cape.name}.` };
}

app.post('/api/admin/login', adminApiLimiter, (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const expected = getAdminPassword();

    if (!expected || !constantTimeEquals(password, expected)) {
        Logger.warn('Admin', 'Failed admin API login');
        return res.status(401).json({ error: 'Incorrect password' });
    }

    const token = jwt.sign({ admin: true }, secrets.jwtSecret, { expiresIn: '12h', algorithm: 'HS256' });
    res.json({ token, expiresIn: '12h' });
});

app.get('/api/admin/state', requireAdminToken, (req, res) => {
    try {
        const capes = capeStmts.listCapes.all().map((cape) => {
            const codes = capeStmts.capeCodeCounts.get(cape.id);
            return {
                id: cape.id,
                name: cape.name,
                createdAt: cape.created_at,
                texture: capeDataUrl(cape.filename),
                assigned: capeStmts.assignmentsForCape.all(cape.id).map((row) => row.username),
                codeCounts: { total: codes.total, unused: codes.unused },
            };
        });

        const users = stmts.listUsers.all().map((user) => {
            const choice = capeStmts.getChoice.get(user.id);
            return {
                id: user.id,
                username: user.username,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                hasSkin: !!user.skin_path,
                capeId: choice ? choice.cape_id : null,
            };
        });

        res.json({ capes, users, spam: spamAccountCounts(), now: Date.now() });
    } catch (err) {
        Logger.error('Admin', `Admin state failed: ${err.message}`);
        res.status(500).json({ error: 'Could not load the admin state.' });
    }
});

app.post('/api/admin/capes', requireAdminToken, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (name.length < 1 || name.length > CAPE_NAME_MAX) {
        return res.status(400).json({ error: `Cape name must be 1-${CAPE_NAME_MAX} characters.` });
    }

    const decoded = decodePngPayload(req.body?.png, MAX_CAPE_SIZE);
    if (decoded.error) return res.status(400).json({ error: decoded.error });

    try {
        const metadata = await sharp(decoded.buffer).metadata();
        if (metadata.format !== 'png' || !isSupportedCapeSize(metadata.width, metadata.height)) {
            return res.status(400).json({ error: 'Cape PNG must be 64×32, or HD at a whole multiple of that (128×64, 256×128).' });
        }

        const filename = writePngFile(CAPE_UPLOAD_DIR, decoded.buffer);
        const id = uuidv4();
        capeStmts.insertCape.run(id, name, filename, Date.now());
        Logger.info('Cape', `Uploaded cape "${name}" (${id}) via admin API`);
        res.status(201).json({ message: `Uploaded cape "${name}".`, cape: { id, name } });
    } catch (err) {
        Logger.error('Cape', `Admin cape upload failed: ${err.message}`);
        res.status(400).json({ error: 'Could not read the uploaded PNG.' });
    }
});

app.post('/api/admin/capes/:id/assign', requireAdminToken, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.status(404).json({ error: 'Cape not found.' });

    const requested = String(req.body?.usernames || '').split(/[,\s]+/).filter(Boolean);
    if (requested.length === 0) return res.status(400).json({ error: 'Enter a username.' });

    const assigned = [];
    const unknown = [];

    for (const name of requested) {
        const usernameVal = validateUsername(name);
        const user = usernameVal.valid ? stmts.findByUsername.get(usernameVal.value) : null;
        if (!user) {
            unknown.push(name);
            continue;
        }
        capeStmts.assignCape.run(cape.id, user.id, Date.now());
        assigned.push(user.username);
    }

    Logger.info('Admin', `Assigned cape "${cape.name}" to ${assigned.join(', ') || 'nobody'}`);
    res.json({
        assigned,
        unknown,
        message: assigned.length > 0
            ? `Assigned "${cape.name}" to ${assigned.join(', ')}.`
            : `No matching players for ${unknown.join(', ')}.`,
    });
});

app.post('/api/admin/capes/:id/unassign', requireAdminToken, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    const usernameVal = validateUsername(String(req.body?.username || ''));
    const user = cape && usernameVal.valid ? stmts.findByUsername.get(usernameVal.value) : null;

    if (!cape || !user) return res.status(404).json({ error: 'User or cape not found.' });

    capeStmts.unassignCape.run(cape.id, user.id);
    capeStmts.clearChoiceForCape.run(user.id, cape.id);
    Logger.info('Admin', `Unassigned cape "${cape.name}" from ${user.username}`);
    res.json({ message: `Unassigned "${cape.name}" from ${user.username}.` });
});

app.post('/api/admin/capes/:id/assign-all', requireAdminToken, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.status(404).json({ error: 'Cape not found.' });

    try {
        const added = capeStmts.assignCapeToAll.run(cape.id, Date.now()).changes;
        const total = capeStmts.countCapeAssignments.get(cape.id).count;
        Logger.info('Admin', `Gifted cape "${cape.name}" to all players (${added} new assignments)`);
        res.json({
            message: total === 0
                ? `There are no players to assign "${cape.name}" to.`
                : added === 0
                    ? `"${cape.name}" is already assigned to all ${total} player${total === 1 ? '' : 's'}.`
                    : `Gifted "${cape.name}" to ${added} player${added === 1 ? '' : 's'} (${total} total).`,
        });
    } catch (err) {
        Logger.error('Admin', `Gift all cape failed: ${err.message}`);
        res.status(500).json({ error: 'Could not assign that cape to all players.' });
    }
});

app.post('/api/admin/capes/:id/unassign-all', requireAdminToken, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.status(404).json({ error: 'Cape not found.' });

    try {
        const removed = db.transaction(() => {
            const result = capeStmts.deleteCapeAssignments.run(cape.id);
            capeStmts.deleteCapeChoices.run(cape.id);
            return result.changes;
        })();
        Logger.info('Admin', `Removed cape "${cape.name}" from all players (${removed} assignments)`);
        res.json({
            message: removed === 0
                ? `"${cape.name}" was not assigned to any players.`
                : `Removed "${cape.name}" from ${removed} player${removed === 1 ? '' : 's'}.`,
        });
    } catch (err) {
        Logger.error('Admin', `Remove all cape failed: ${err.message}`);
        res.status(500).json({ error: 'Could not remove that cape from all players.' });
    }
});

app.delete('/api/admin/capes/:id', requireAdminToken, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.status(404).json({ error: 'Cape not found.' });

    capeStmts.deleteCapeAssignments.run(cape.id);
    capeStmts.deleteCapeChoices.run(cape.id);
    capeStmts.deleteCapeCodes.run(cape.id);
    capeStmts.deleteCape.run(cape.id);

    try {
        const capePath = path.resolve(CAPE_UPLOAD_DIR, cape.filename);
        if (fs.existsSync(capePath)) fs.unlinkSync(capePath);
    } catch (err) {
        Logger.warn('Cape', `Could not delete cape file: ${err.message}`);
    }

    Logger.info('Cape', `Deleted cape "${cape.name}"`);
    res.json({ message: `Deleted cape "${cape.name}".` });
});

app.post('/api/admin/capes/:id/codes', requireAdminToken, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.status(404).json({ error: 'Cape not found.' });

    const requested = Number.parseInt(String(req.body?.count ?? ''), 10);
    const count = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), CODE_MAX_PER_BATCH) : 1;

    try {
        const codes = createCapeCodes(cape.id, count);
        if (codes.length === 0) {
            return res.status(500).json({ error: 'Could not generate gift codes.' });
        }

        Logger.info('Cape', `Generated ${codes.length} gift code(s) for "${cape.name}"`);
        res.status(201).json({
            codes,
            cape: { id: cape.id, name: cape.name },
            message: `Generated ${codes.length} code${codes.length === 1 ? '' : 's'} for "${cape.name}".`,
        });
    } catch (err) {
        Logger.error('Cape', `Gift code generation failed: ${err.message}`);
        res.status(500).json({ error: 'Could not generate gift codes.' });
    }
});

app.get('/api/admin/capes/:id/codes', requireAdminToken, (req, res) => {
    const cape = capeStmts.getCape.get(req.params.id);
    if (!cape) return res.status(404).json({ error: 'Cape not found.' });
    res.json({ codes: capeStmts.listCapeCodes.all(cape.id) });
});

app.post('/api/admin/users/purge-spam', requireAdminToken, (req, res) => {
    const neverLoggedInOnly = req.body?.neverLoggedIn === true || req.body?.neverLoggedIn === 'true';

    try {
        const accounts = stmts.listUsers.all().filter((user) =>
            SPAM_USERNAME_PATTERN.test(user.username) &&
            (!neverLoggedInOnly || user.last_login == null)
        );

        const removeAccounts = db.transaction((list) => {
            for (const user of list) {
                capeStmts.deleteUserAssignments.run(user.id);
                capeStmts.clearChoice.run(user.id);
                stmts.deleteUser.run(user.id);
            }
        });
        removeAccounts(accounts);

        for (const user of accounts) {
            try { removeSkinFile(user.skin_path); } catch (err) { /* already gone */ }
        }

        const noun = neverLoggedInOnly ? 'never-logged-in spam account' : 'spam account';
        const message = accounts.length === 0
            ? `No ${noun}s found.`
            : `Purged ${accounts.length} ${accounts.length === 1 ? noun : noun + 's'}.`;
        Logger.info('Admin', message);
        res.json({ message, purged: accounts.length });
    } catch (err) {
        Logger.error('Admin', `Spam purge failed: ${err.message}`);
        res.status(500).json({ error: 'Could not purge spam accounts.' });
    }
});

app.post('/api/admin/users/:id/skin', requireAdminToken, async (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Player not found.' });

    const decoded = decodePngPayload(req.body?.png, MAX_SKIN_SIZE);
    if (decoded.error) return res.status(400).json({ error: decoded.error });

    try {
        const metadata = await sharp(decoded.buffer).metadata();
        if (metadata.format !== 'png' || !isSupportedSkinSize(metadata.width, metadata.height)) {
            return res.status(400).json({ error: 'Skin PNG must be 64×64, 64×32, or a larger HD skin.' });
        }

        const previousSkin = user.skin_path;
        const filename = writePngFile(SKIN_UPLOAD_DIR, decoded.buffer);
        stmts.updateSkinPath.run(filename, user.id);
        if (previousSkin && previousSkin !== filename) {
            try { removeSkinFile(previousSkin); } catch (err) {
                Logger.warn('Admin', `Could not delete previous skin for ${user.username}: ${err.message}`);
            }
        }

        Logger.info('Admin', `Changed skin for ${user.username}`);
        res.json({ message: `Changed skin for ${user.username}.` });
    } catch (err) {
        res.status(400).json({ error: 'Could not read the uploaded PNG.' });
    }
});

app.post('/api/admin/users/:id/skin/reset', requireAdminToken, (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Player not found.' });

    const previousSkin = user.skin_path;
    stmts.updateSkinPath.run(null, user.id);
    if (previousSkin) {
        try { removeSkinFile(previousSkin); } catch (err) {
            Logger.warn('Admin', `Could not delete skin for ${user.username}: ${err.message}`);
        }
    }

    Logger.info('Admin', `Reset skin for ${user.username}`);
    res.json({ message: `Reset skin for ${user.username}.` });
});

app.post('/api/admin/users/:id/cape', requireAdminToken, (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Player not found.' });

    const raw = typeof req.body?.capeId === 'string' ? req.body.capeId : 'default';
    const result = setUserCape(user, raw);
    if (result.error) return res.status(404).json({ error: result.error });

    Logger.info('Admin', result.message);
    res.json({ message: result.message });
});

app.post('/api/admin/users/:id/password', requireAdminToken, async (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Player not found.' });

    const passwordVal = validatePassword(req.body?.password);
    if (!passwordVal.valid) return res.status(400).json({ error: passwordVal.error });

    try {
        const hash = await bcrypt.hash(passwordVal.value, BCRYPT_ROUNDS);
        stmts.updatePasswordHash.run(hash, user.id);
        Logger.info('Admin', `Changed password for ${user.username}`);
        res.json({ message: `Changed password for ${user.username}.` });
    } catch (err) {
        Logger.error('Admin', `Could not change password for ${user.username}: ${err.message}`);
        res.status(500).json({ error: 'Could not change that password.' });
    }
});

app.delete('/api/admin/users/:id', requireAdminToken, (req, res) => {
    const user = stmts.findById.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Player not found.' });

    try {
        capeStmts.deleteUserAssignments.run(user.id);
        capeStmts.clearChoice.run(user.id);
        stmts.deleteUser.run(user.id);

        try { removeSkinFile(user.skin_path); } catch (err) {
            Logger.warn('Admin', `Could not delete skin for ${user.username}: ${err.message}`);
        }

        Logger.info('Admin', `Deleted account: ${user.username}`);
        res.json({ message: `Deleted ${user.username}.` });
    } catch (err) {
        Logger.error('Admin', `Could not delete ${user.username}: ${err.message}`);
        res.status(500).json({ error: 'Could not delete that account.' });
    }
});

// --- OAuth 2.0: "Sign in with Breakmine" ------------------------------------
//
// Other sites register a client (POST /oauth/register, or a start-up entry in
// OAUTH_CLIENTS) and send the browser to /oauth/authorize. The player signs in
// with their Breakmine account - or creates one on the spot - and is asked to
// allow that site to use it. Approving redirects back with a single-use code,
// which the site trades for a bearer token at /oauth/token.
//
//   GET  /oauth/authorize    login/signup form, then the consent screen (HTML)
//   POST /oauth/authorize    login, signup, approve, deny, switch account
//   POST /oauth/token        authorization_code -> access token
//   GET  /oauth/userinfo     bearer token -> { id, username, ... }
//   POST /oauth/revoke       revoke a token early
//   POST /oauth/register     dynamic client registration
//   GET  /oauth/breakmine.js browser SDK: BreakmineAuth.login() -> { token, username }
//
// Browser clients use PKCE (S256) and token_endpoint_auth_method=none; server
// clients get a client_secret and send it as a form field or HTTP Basic.

const OAUTH_SCOPE = 'profile';
const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
const OAUTH_TOKEN_TTL = '7d';
const OAUTH_TOKEN_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_SESSION_COOKIE = 'breakmine_oauth';
const OAUTH_SESSION_SECONDS = 12 * 60 * 60;
const OAUTH_CLIENT_NAME_MAX = 60;
const OAUTH_MAX_REDIRECT_URIS = 5;

// Dedicated CORS: the token, userinfo and registration endpoints are called
// from the registering site's own origin, which is not in CORS_ORIGINS.
const oauthCors = cors({
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    maxAge: 86400,
});

const oauthPromptLimiter = rateLimit({ windowMs: 900000, max: 120 });
const oauthLoginLimiter = rateLimit({ windowMs: 900000, max: 10 });

// Kept short on purpose: plenty for a pasteable URL, and long enough that a
// loopback dev server with a path works.
const OAUTH_MAX_URI_LENGTH = 500;

function findOAuthClient(clientId) {
    return clientId ? oauthStmts.getClient.get(clientId) : null;
}

function oauthClientName(raw) {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > OAUTH_CLIENT_NAME_MAX) return null;
    return name;
}

// Discord-style redirect rules: https anywhere, http only for loopback, so a
// developer's localhost test works without allowing plaintext third-party hops.
function isAllowedRedirectUri(value) {
    let url;
    try {
        url = new URL(value);
    } catch (err) {
        return false;
    }
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

function normalizeRedirectUris(raw) {
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
    const uris = [];

    for (const value of list) {
        if (typeof value !== 'string') continue;
        const uri = value.trim();
        if (!uri) continue;
        if (uri.length > OAUTH_MAX_URI_LENGTH) return { error: 'That redirect URI is too long.' };
        if (!isAllowedRedirectUri(uri)) {
            return { error: `Use an https redirect URI (http is only allowed for localhost): ${uri}` };
        }
        if (!uris.includes(uri)) uris.push(uri);
    }

    if (uris.length === 0) return { error: 'At least one redirect_uri is required.' };
    if (uris.length > OAUTH_MAX_REDIRECT_URIS) {
        return { error: `Register at most ${OAUTH_MAX_REDIRECT_URIS} redirect URIs.` };
    }
    return { uris };
}

function readOAuthParam(source, name) {
    const value = source ? source[name] : undefined;
    return typeof value === 'string' ? value.trim() : '';
}

function sha256Base64Url(value) {
    return crypto.createHash('sha256').update(value).digest('base64url');
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function requestOrigin(req) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    return `${forwardedProto || (req.secure ? 'https' : 'http')}://${hostnameOf(req)}`;
}

function oauthIssuer(req) {
    return String(process.env.OAUTH_ISSUER || requestOrigin(req)).replace(/\/+$/, '');
}

// Validates everything the prompt needs, from either the query string or the
// posted form. The client and its redirect URI are re-checked on every request
// so a tampered hidden field cannot redirect a code somewhere else.
function parseOAuthRequest(source) {
    const clientId = readOAuthParam(source, 'client_id');
    if (!clientId) return { error: 'This sign-in link is missing its application id.' };

    const client = findOAuthClient(clientId);
    if (!client) return { error: 'That application is not registered with Breakmine.' };

    let registered = [];
    try {
        registered = JSON.parse(client.redirect_uris);
    } catch (err) {
        registered = [];
    }
    if (!Array.isArray(registered)) registered = [];

    const requestedUri = readOAuthParam(source, 'redirect_uri');
    const redirectUri = requestedUri || (registered.length === 1 ? registered[0] : '');
    if (!redirectUri || !registered.includes(redirectUri)) {
        return { error: 'That application asked to return to a page it is not registered for.' };
    }

    const responseType = readOAuthParam(source, 'response_type') || 'code';
    if (responseType !== 'code') return { error: 'Only response_type=code is supported.' };

    const state = readOAuthParam(source, 'state');
    if (state.length > 200) return { error: 'The state value is too long.' };

    const scope = (readOAuthParam(source, 'scope') || OAUTH_SCOPE).split(/\s+/).filter(Boolean).join(' ');
    if (scope !== OAUTH_SCOPE) return { error: `Only the "${OAUTH_SCOPE}" scope is supported.` };

    const codeChallenge = readOAuthParam(source, 'code_challenge');
    const codeChallengeMethod = codeChallenge ? (readOAuthParam(source, 'code_challenge_method') || 'S256') : '';
    if (codeChallenge) {
        if (codeChallengeMethod !== 'S256') return { error: 'Only code_challenge_method=S256 is supported.' };
        if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return { error: 'That code_challenge is malformed.' };
    } else if (!client.client_secret_hash) {
        return { error: 'This application has to use PKCE (code_challenge) to sign players in.' };
    }

    return {
        client,
        clientId: client.client_id,
        clientName: client.name,
        verified: !!client.verified,
        redirectUri,
        state,
        scope,
        codeChallenge,
        codeChallengeMethod,
    };
}

function oauthRequestQuery(request) {
    const params = new URLSearchParams();
    params.set('client_id', request.clientId);
    params.set('redirect_uri', request.redirectUri);
    params.set('response_type', 'code');
    params.set('scope', request.scope);
    if (request.state) params.set('state', request.state);
    if (request.codeChallenge) {
        params.set('code_challenge', request.codeChallenge);
        params.set('code_challenge_method', request.codeChallengeMethod);
    }
    return params.toString();
}

function oauthRequestFields(request) {
    const values = {
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        response_type: 'code',
        state: request.state,
        scope: request.scope,
        code_challenge: request.codeChallenge,
        code_challenge_method: request.codeChallengeMethod,
    };

    return Object.entries(values)
        .filter(([, value]) => value)
        .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
        .join('\n            ');
}

function oauthStyles() {
    return `
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body {
            margin: 0; min-height: 100vh; padding: 24px;
            display: flex; align-items: center; justify-content: center;
            background-color: #b3c6ff;
            background-image:
                linear-gradient(rgba(255, 255, 255, 0.24) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.24) 1px, transparent 1px);
            background-size: 32px 32px;
            color: #3a4250;
            font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .card {
            width: 100%; max-width: 400px; padding: 22px 22px 14px;
            background: #f4f4f4; border: 1px solid #9aa6c7; border-radius: 6px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.22);
        }
        .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-weight: 700; color: #2f3640; }
        .brand img { width: 20px; height: 20px; image-rendering: pixelated; }
        h1 { font-size: 18px; line-height: 1.3; margin: 0 0 8px; color: #2f3640; }
        p { margin: 0 0 14px; }
        .sub { color: #5b6472; }
        .field { display: block; margin-bottom: 12px; font-size: 12px; color: #5b6472; }
        input[type=text], input[type=password] {
            display: block; width: 100%; margin-top: 4px; padding: 8px 10px;
            background: linear-gradient(to bottom, #d0d0d0 0%, #f4f4f4 100%);
            border: 1px solid #b5b5b5; border-radius: 4px; color: #2f3640;
            box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.18); font: inherit; outline: none;
        }
        input:focus { border-color: #2f6fed; }
        .buttons { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 16px; }
        button {
            padding: 7px 16px; cursor: pointer; color: #4a4a4a; font: inherit; font-weight: 600;
            background: linear-gradient(to bottom, #ececec 0%, #d8d8d8 100%);
            border: 1px solid #b5b5b5; border-radius: 3px;
            text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
        }
        button:hover { background: linear-gradient(to bottom, #d8d8d8 0%, #c4c4c4 100%); }
        button.primary {
            background: linear-gradient(to bottom, #6fd3c7 0%, #26a69a 100%);
            border-color: #1f857c; color: #0d2a28;
            text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
        }
        button.primary:hover { background: linear-gradient(to bottom, #7ddbd0 0%, #2fb3a7 100%); }
        button.link { background: none; border: 0; padding: 0; color: #2f6fed; font-weight: 500; text-decoration: underline; }
        .switch { color: #2f6fed; font-size: 13px; }
        .scopes { list-style: none; margin: 0 0 14px; padding: 0; }
        .scopes li { position: relative; padding-left: 20px; margin-bottom: 6px; color: #39414d; }
        .scopes li::before { content: "\u2713"; position: absolute; left: 0; color: #26a69a; font-weight: 700; }
        .account {
            display: flex; gap: 6px; align-items: center; padding: 8px 10px; margin-bottom: 14px;
            background: #e9edf7; border: 1px solid #c3cbe0; border-radius: 4px;
        }
        .account strong { color: #2f3640; }
        .warn { padding: 8px 10px; margin-bottom: 14px; background: #fff4d6; border: 1px solid #e6c86a; border-radius: 4px; color: #6b5312; }
        .error { padding: 8px 10px; margin-bottom: 14px; background: #ffe2e0; border: 1px solid #e0a29d; border-radius: 4px; color: #8f2119; }
        .foot { margin: 16px 0 0; font-size: 11px; color: #7c8698; }
    `;
}

function renderOAuthPage(res, { title, body, status = 200 }) {
    res.status(status).type('html').send(`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} \u00b7 Breakmine</title>
    <link rel="icon" type="image/x-icon" href="https://breakmine.com/src/resources/favicon.ico">
    <style>${oauthStyles()}</style>
</head>
<body>
    <main class="card">
        <div class="brand"><img src="https://breakmine.com/src/resources/favicon.ico" alt=""> Breakmine account</div>
${body}
        <p class="foot">This page is served by Breakmine. Your password is only ever sent to Breakmine.</p>
    </main>
</body>
</html>`);
}

function renderOAuthNotice(res, message, status = 400) {
    renderOAuthPage(res, {
        status,
        title: 'Sign-in unavailable',
        body: `        <h1>Sign-in unavailable</h1>
        <p class="sub">${escapeHtml(message)}</p>`,
    });
}

function renderOAuthForm(res, { request, user, mode, error, status = 200, username = '' }) {
    const host = (() => {
        try { return new URL(request.redirectUri).host; } catch (err) { return 'this site'; }
    })();
    const fields = oauthRequestFields(request);
    const name = escapeHtml(request.clientName);
    let body = '';

    if (mode === 'consent' && user) {
        const warning = request.verified
            ? ''
            : `        <div class="warn">${name} has not been reviewed by Breakmine. Only continue if you trust ${escapeHtml(host)}.</div>\n`;

        body = `        <h1>Allow ${name} to use your Breakmine account?</h1>
        <div class="account"><span>Signed in as</span> <strong>${escapeHtml(user.username)}</strong></div>
${warning}        <p class="sub">${name} will be able to read:</p>
        <ul class="scopes">
            <li>Your username, ${escapeHtml(user.username)}</li>
            <li>Your account id and the date you joined</li>
        </ul>
        <p class="sub">It never gets your password, your skin or your capes.</p>
        <form method="post" action="/oauth/authorize">
            ${fields}
            <input type="hidden" name="action" value="approve">
            <div class="buttons">
                <button type="submit" class="primary">Allow</button>
                <button type="submit" name="action" value="deny">Not now</button>
            </div>
        </form>
        <form method="post" action="/oauth/authorize">
            ${fields}
            <input type="hidden" name="action" value="logout">
            <p class="foot" style="margin-top:14px"><button type="submit" class="link">Not ${escapeHtml(user.username)}?</button></p>
        </form>`;
    } else {
        const signup = mode === 'signup';
        const errorHtml = error ? `        <div class="error">${escapeHtml(error)}</div>\n` : '';
        const otherMode = signup ? 'login' : 'signup';
        const switchHref = `/oauth/authorize?${oauthRequestQuery(request)}&mode=${otherMode}`;

        body = `        <h1>${signup ? 'Create a Breakmine account' : 'Sign in to Breakmine'}</h1>
        <p class="sub">${name} (${escapeHtml(host)}) wants to use your Breakmine account.</p>
${errorHtml}        <form method="post" action="/oauth/authorize" autocomplete="on">
            ${fields}
            <label class="field">Username
                <input type="text" name="username" required minlength="3" maxlength="32" autocomplete="username" value="${escapeHtml(username)}">
            </label>
            <label class="field">Password
                <input type="password" name="password" required minlength="6" maxlength="128" autocomplete="${signup ? 'new-password' : 'current-password'}">
            </label>
            <div class="buttons">
                <button type="submit" class="primary" name="action" value="${signup ? 'signup' : 'login'}">${signup ? 'Create account' : 'Sign in'}</button>
                <a class="switch" href="${escapeHtml(switchHref)}">${signup ? 'I already have an account' : 'Create an account'}</a>
            </div>
        </form>`;
    }

    renderOAuthPage(res, { status, title: mode === 'consent' ? 'Allow access' : 'Sign in', body });
}

function oauthSessionUser(req) {
    const token = readCookies(req)[OAUTH_SESSION_COOKIE];
    if (!token) return null;

    try {
        const decoded = jwt.verify(token, secrets.jwtSecret, { algorithms: ['HS256'] });
        if (!decoded || decoded.oauthSession !== true) return null;
        return stmts.findById.get(decoded.sub) || null;
    } catch (err) {
        return null;
    }
}

function setOAuthSessionCookie(req, res, user) {
    const token = jwt.sign({ sub: user.id, username: user.username, oauthSession: true }, secrets.jwtSecret, {
        expiresIn: OAUTH_SESSION_SECONDS,
        algorithm: 'HS256',
    });

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const secure = req.secure || forwardedProto === 'https';
    res.append('Set-Cookie', `${OAUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_SESSION_SECONDS}${secure ? '; Secure' : ''}`);
}

function clearOAuthSessionCookie(res) {
    res.append('Set-Cookie', `${OAUTH_SESSION_COOKIE}=; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function issueOAuthToken(user, client, scope) {
    const jti = uuidv4();
    const token = jwt.sign({
        sub: user.id,
        username: user.username,
        jti,
        scope,
        client_id: client.client_id,
        token_use: 'oauth',
    }, secrets.jwtSecret, {
        expiresIn: OAUTH_TOKEN_TTL,
        algorithm: 'HS256',
        issuer: 'breakmine-oauth',
    });
    return { token, jti };
}

function authenticateOAuthToken(req, res, next) {
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    try {
        const decoded = jwt.verify(header.slice(7), secrets.jwtSecret, { algorithms: ['HS256'] });
        if (decoded.token_use !== 'oauth') {
            return res.status(401).json({ error: 'Not an OAuth access token' });
        }
        if (stmts.isTokenRevoked.get(decoded.jti, Date.now())) {
            return res.status(401).json({ error: 'Token has been revoked' });
        }

        const user = stmts.findById.get(decoded.sub);
        if (!user) return res.status(401).json({ error: 'Account no longer exists' });

        req.oauth = { ...decoded, user };
        next();
    } catch (err) {
        return res.status(401).json({ error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' });
    }
}

function basicAuthCredentials(req) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Basic ')) return null;

    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    return { id: decoded.slice(0, colon), secret: decoded.slice(colon + 1) };
}

async function handleOAuthSignIn(req, res, action) {
    const request = parseOAuthRequest(req.body);
    if (request.error) return renderOAuthNotice(res, request.error, 400);

    const usernameVal = validateUsername(req.body?.username);
    const passwordVal = validatePassword(req.body?.password);
    const fail = (message, status = 400) => renderOAuthForm(res, {
        request,
        user: null,
        mode: action === 'signup' ? 'signup' : 'login',
        error: message,
        status,
        username: typeof req.body?.username === 'string' ? req.body.username : '',
    });

    if (!usernameVal.valid) return fail(usernameVal.error);
    if (!passwordVal.valid) return fail(passwordVal.error);

    try {
        if (action === 'signup') {
            if (stmts.findByUsername.get(usernameVal.value)) {
                return fail('That username is already taken.', 409);
            }

            const hash = await bcrypt.hash(passwordVal.value, BCRYPT_ROUNDS);
            stmts.createUser.run(uuidv4(), usernameVal.value, hash, Date.now());
            Logger.info('OAuth', `Registered via ${request.clientName}: ${usernameVal.value}`);
        } else {
            const user = stmts.findByUsername.get(usernameVal.value);
            // Same dummy compare as /api/login, so a missing account costs the
            // same time as a wrong password.
            const matches = await bcrypt.compare(
                passwordVal.value,
                user ? user.password_hash : '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
            );
            if (!user || !matches) {
                Logger.warn('OAuth', `Failed sign-in for ${usernameVal.value} via ${request.clientName}`);
                return fail('Incorrect username or password.', 401);
            }
            stmts.updateLastLogin.run(Date.now(), user.id);
        }

        const user = stmts.findByUsername.get(usernameVal.value);
        setOAuthSessionCookie(req, res, user);
        res.redirect(303, `/oauth/authorize?${oauthRequestQuery(request)}`);
    } catch (err) {
        Logger.error('OAuth', `Sign-in failed: ${err.message}`);
        fail('Something went wrong. Try again.', 500);
    }
}

function handleOAuthDecision(req, res, action) {
    const request = parseOAuthRequest(req.body);
    if (request.error) return renderOAuthNotice(res, request.error, 400);

    const promptUrl = `/oauth/authorize?${oauthRequestQuery(request)}`;
    const user = oauthSessionUser(req);

    if (action === 'logout') {
        clearOAuthSessionCookie(res);
        return res.redirect(303, promptUrl);
    }

    // The session cookie expired between the consent page and the click.
    if (!user) return res.redirect(303, promptUrl);

    try {
        const target = new URL(request.redirectUri);

        if (action !== 'approve') {
            target.searchParams.set('error', 'access_denied');
            target.searchParams.set('error_description', 'The player declined to share their Breakmine account.');
            if (request.state) target.searchParams.set('state', request.state);
            Logger.info('OAuth', `${user.username} declined ${request.clientName}`);
            return res.redirect(303, target.toString());
        }

        const code = crypto.randomBytes(32).toString('base64url');
        oauthStmts.insertCode.run(
            sha256Hex(code),
            request.client.client_id,
            user.id,
            request.redirectUri,
            request.scope,
            request.codeChallenge || null,
            request.codeChallengeMethod || null,
            Date.now(),
            Date.now() + OAUTH_CODE_TTL_MS
        );
        oauthStmts.touchClient.run(Date.now(), request.client.client_id);

        target.searchParams.set('code', code);
        if (request.state) target.searchParams.set('state', request.state);
        Logger.info('OAuth', `${user.username} approved ${request.clientName}`);
        res.redirect(303, target.toString());
    } catch (err) {
        Logger.error('OAuth', `Consent failed: ${err.message}`);
        renderOAuthNotice(res, 'Something went wrong. Try again.', 500);
    }
}

app.get('/oauth/authorize', oauthPromptLimiter, (req, res) => {
    const request = parseOAuthRequest(req.query);
    if (request.error) return renderOAuthNotice(res, request.error, 400);

    const user = oauthSessionUser(req);
    const mode = user ? 'consent' : (req.query.mode === 'signup' ? 'signup' : 'login');
    renderOAuthForm(res, { request, user, mode });
});

app.post('/oauth/authorize', (req, res) => {
    const action = readOAuthParam(req.body, 'action');

    if (action === 'login' || action === 'signup') {
        return oauthLoginLimiter(req, res, () => handleOAuthSignIn(req, res, action));
    }
    return handleOAuthDecision(req, res, action);
});

const oauthEndpointLimiter = rateLimit({ windowMs: 900000, max: 120 });

app.post('/oauth/token', oauthEndpointLimiter, oauthCors, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    if (readOAuthParam(body, 'grant_type') !== 'authorization_code') {
        return res.status(400).json({
            error: 'unsupported_grant_type',
            error_description: 'Use grant_type=authorization_code.',
        });
    }

    const basic = basicAuthCredentials(req);
    const clientId = readOAuthParam(body, 'client_id') || (basic ? basic.id : '');
    const client = findOAuthClient(clientId);
    if (!client) {
        return res.status(401).json({ error: 'invalid_client', error_description: 'Unknown client.' });
    }

    const secret = readOAuthParam(body, 'client_secret') || (basic ? basic.secret : '');
    if (client.client_secret_hash) {
        if (!secret || !(await bcrypt.compare(secret, client.client_secret_hash))) {
            return res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client credentials.' });
        }
    } else if (secret) {
        return res.status(401).json({ error: 'invalid_client', error_description: 'This client does not use a secret.' });
    }

    const code = readOAuthParam(body, 'code');
    if (!code) return res.status(400).json({ error: 'invalid_request', error_description: 'Missing code.' });

    const codeHash = sha256Hex(code);
    const stored = oauthStmts.getCode.get(codeHash);
    const invalidGrant = (description) => res.status(400).json({ error: 'invalid_grant', error_description: description });

    if (!stored || stored.client_id !== client.client_id) return invalidGrant('That code is not valid.');
    if (stored.consumed_at) return invalidGrant('That code was already used.');
    if (stored.expires_at < Date.now()) return invalidGrant('That code expired. Start the sign-in again.');

    const redirectUri = readOAuthParam(body, 'redirect_uri');
    if (redirectUri && redirectUri !== stored.redirect_uri) {
        return invalidGrant('redirect_uri does not match the one the code was issued for.');
    }

    if (stored.code_challenge) {
        const verifier = readOAuthParam(body, 'code_verifier');
        if (!verifier) return invalidGrant('code_verifier is required for this client.');
        const expected = Buffer.from(stored.code_challenge);
        const actual = Buffer.from(sha256Base64Url(verifier));
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
            return invalidGrant('code_verifier does not match the code_challenge.');
        }
    } else if (!client.client_secret_hash) {
        return invalidGrant('This client has to use PKCE.');
    }

    const user = stmts.findById.get(stored.user_id);
    if (!user) return invalidGrant('That account no longer exists.');

    if (oauthStmts.consumeCode.run(Date.now(), codeHash).changes === 0) {
        return invalidGrant('That code was already used.');
    }
    oauthStmts.touchClient.run(Date.now(), client.client_id);

    const { token } = issueOAuthToken(user, client, stored.scope);
    res.set('Cache-Control', 'no-store');
    res.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: OAUTH_TOKEN_SECONDS,
        scope: stored.scope,
        username: user.username,
    });
});

function sendOAuthUserInfo(req, res) {
    const { user, scope } = req.oauth;
    const choice = capeStmts.getChoice.get(user.id);

    res.set('Cache-Control', 'no-store');
    res.json({
        sub: user.id,
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        has_skin: !!user.skin_path,
        has_cape: !!choice && choice.cape_id !== '',
        scope,
    });
}

app.get('/oauth/userinfo', oauthCors, authenticateOAuthToken, sendOAuthUserInfo);
// Also under /api/ so the game reaches it through the WebSocket relay.
app.get('/api/oauth/userinfo', oauthCors, authenticateOAuthToken, sendOAuthUserInfo);

app.post('/oauth/revoke', oauthCors, authenticateOAuthToken, (req, res) => {
    try {
        const decoded = jwt.decode(req.headers.authorization.slice(7));
        stmts.revokeToken.run(req.oauth.jti, Date.now(), decoded.exp * 1000);
        Logger.info('OAuth', `Revoked token for ${req.oauth.username} (${req.oauth.client_id || 'client'})`);
    } catch (err) {
        Logger.warn('OAuth', `Could not revoke token: ${err.message}`);
    }

    // RFC 7009: revoking is always reported as success.
    res.status(200).json({});
});

app.post('/oauth/register', oauthEndpointLimiter, oauthCors, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const name = oauthClientName(body.client_name || body.name);
    if (!name) {
        return res.status(400).json({
            error: 'invalid_client_metadata',
            error_description: `client_name must be 2-${OAUTH_CLIENT_NAME_MAX} characters.`,
        });
    }

    const normalized = normalizeRedirectUris(body.redirect_uris || body.redirect_uri);
    if (normalized.error) {
        return res.status(400).json({ error: 'invalid_redirect_uri', error_description: normalized.error });
    }

    const method = String(body.token_endpoint_auth_method || 'none').trim().toLowerCase();
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
        return res.status(400).json({
            error: 'invalid_client_metadata',
            error_description: 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.',
        });
    }

    try {
        const clientId = 'bm_' + crypto.randomBytes(12).toString('hex');
        const clientSecret = method === 'none' ? '' : crypto.randomBytes(24).toString('base64url');
        const secretHash = clientSecret ? await bcrypt.hash(clientSecret, BCRYPT_ROUNDS) : null;

        oauthStmts.insertClient.run(
            clientId,
            secretHash,
            name,
            JSON.stringify(normalized.uris),
            0,
            Date.now()
        );

        const issuer = oauthIssuer(req);
        Logger.info('OAuth', `Registered client "${name}" (${clientId}) for ${normalized.uris.join(', ')}`);

        res.status(201).json({
            client_id: clientId,
            ...(clientSecret ? { client_secret: clientSecret } : {}),
            client_name: name,
            redirect_uris: normalized.uris,
            token_endpoint_auth_method: method,
            grant_types: ['authorization_code'],
            response_types: ['code'],
            scope: OAUTH_SCOPE,
            authorization_endpoint: `${issuer}/oauth/authorize`,
            token_endpoint: `${issuer}/oauth/token`,
            userinfo_endpoint: `${issuer}/oauth/userinfo`,
            sdk: `${issuer}/oauth/breakmine.js`,
        });
    } catch (err) {
        Logger.error('OAuth', `Client registration failed: ${err.message}`);
        res.status(500).json({ error: 'server_error', error_description: 'Could not register that application.' });
    }
});

// The browser SDK is a real file so it can be read and self-hosted, but it is
// served from this origin so the token exchange is same-origin with the API.
app.get('/oauth/breakmine.js', (req, res) => {
    res.set({
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
    });
    res.sendFile(path.join(__dirname, 'oauth-client.js'));
});

// Clients listed in OAUTH_CLIENTS skip the "not reviewed" warning on the
// consent screen. Shape: [{ "client_id": "...", "name": "...", "redirect_uris": ["https://..."] }]
function loadTrustedOAuthClients() {
    const raw = process.env.OAUTH_CLIENTS;
    if (!raw) return;

    let list;
    try {
        list = JSON.parse(raw);
    } catch (err) {
        Logger.warn('OAuth', 'OAUTH_CLIENTS is not valid JSON; no trusted clients loaded');
        return;
    }
    if (!Array.isArray(list)) {
        Logger.warn('OAuth', 'OAUTH_CLIENTS must be a JSON array; no trusted clients loaded');
        return;
    }

    for (const entry of list) {
        const clientId = String(entry?.client_id || '').trim();
        const name = oauthClientName(entry?.name || entry?.client_name);
        const normalized = normalizeRedirectUris(entry?.redirect_uris);

        if (!clientId || !name || normalized.error) {
            Logger.warn('OAuth', `Skipping trusted client ${clientId || '(no id)'}: ${normalized.error || 'id and name are required'}`);
            continue;
        }

        oauthStmts.upsertTrustedClient.run(clientId, name, JSON.stringify(normalized.uris), Date.now());
        Logger.info('OAuth', `Trusted client ready: ${name} (${clientId})`);
    }
}

loadTrustedOAuthClients();

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const isCapeUpload = req.originalUrl.startsWith('/api/upload_cape') || req.originalUrl.startsWith('/admin/capes');
        const maxSize = isCapeUpload ? MAX_CAPE_SIZE : MAX_SKIN_SIZE;
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File too large. Max ${maxSize / 1024}KB` : err.message });
    }
    if (err.message === 'Only PNG images are allowed') return res.status(400).json({ error: err.message });
    next(err);
});

app.use((err, req, res, next) => {
    Logger.error('Server', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// --- WebSocket API -----------------------------------------------------------
//
// School and office filters regularly block plain HTTP requests to
// breakmine.com while letting WebSocket traffic through, which made login and
// skin uploads unusable on those networks. Every API route is therefore also
// reachable over a WebSocket at /api-ws.
//
// Protocol: one JSON object per frame, both ways.
//   client -> {"id": "3", "method": "POST", "path": "/api/login",
//              "headers": {"Authorization": "Bearer ..."},
//              "body": "{\"username\":...}"}   (binary bodies: "bodyBase64")
//   server -> {"id": "3", "status": 200, "contentType": "application/json",
//              "json": {...}}
//
// Each request is replayed against the loopback HTTP API instead of getting a
// second implementation, so validation, auth, uploads and error shapes can
// never drift between the two transports. Only API, skin and cape paths are
// relayed, so this cannot be used as a general proxy for the site.

const WS_API_PATH = '/api-ws';
const WS_MAX_PAYLOAD = 4 * 1024 * 1024;
const WS_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const WS_REQUEST_TIMEOUT_MS = 30000;
const WS_MAX_IN_FLIGHT = 8;
const WS_WINDOW_MS = 15 * 60 * 1000;
const WS_REQUESTS_PER_WINDOW = 120;
const WS_AUTH_REQUESTS_PER_WINDOW = 10;
const WS_ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'DELETE']);
const WS_ALLOWED_PREFIXES = ['/api/', '/skin/', '/cape/'];
const WS_FORWARDED_HEADERS = new Set(['authorization', 'content-type', 'accept']);
const WS_AUTH_PATHS = new Set(['/api/login', '/api/register']);

const loopbackAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

function replayLoopbackRequest(method, requestPath, headers, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port: PORT,
            method,
            path: requestPath,
            agent: loopbackAgent,
            headers: {
                ...headers,
                host: '127.0.0.1',
                'x-breakmine-ws': '1',
                ...(body ? { 'content-length': body.length } : {}),
            },
        }, (res) => {
            const chunks = [];
            let size = 0;

            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > WS_MAX_RESPONSE_BYTES) {
                    req.destroy(new Error('Response too large'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => resolve({
                status: res.statusCode || 500,
                contentType: String(res.headers['content-type'] || ''),
                body: Buffer.concat(chunks),
            }));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.setTimeout(WS_REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Upstream request timed out')));
        if (body) req.write(body);
        req.end();
    });
}

function attachApiWebSocket(server) {
    const wss = new WebSocketServer({
        server,
        path: WS_API_PATH,
        maxPayload: WS_MAX_PAYLOAD,
    });

    wss.on('connection', (ws) => {
        const state = {
            count: 0,
            authCount: 0,
            resetAt: Date.now() + WS_WINDOW_MS,
            inFlight: 0,
        };

        const send = (payload) => {
            if (ws.readyState === 1) ws.send(JSON.stringify(payload));
        };

        ws.on('message', async (data, isBinary) => {
            if (isBinary) {
                ws.close(1003, 'Binary frames are not supported');
                return;
            }

            let message;
            try {
                message = JSON.parse(data.toString());
            } catch (err) {
                send({ id: null, status: 400, error: 'Invalid JSON' });
                return;
            }

            const id = message && message.id !== undefined ? message.id : null;
            const method = String((message && message.method) || 'GET').toUpperCase();
            const requestPath = String((message && message.path) || '');

            if (!WS_ALLOWED_METHODS.has(method)) {
                send({ id, status: 405, error: 'Method not allowed' });
                return;
            }

            if (!requestPath.startsWith('/') || requestPath.includes('..') ||
                !WS_ALLOWED_PREFIXES.some((prefix) => requestPath.startsWith(prefix))) {
                send({ id, status: 404, error: 'Unsupported API path' });
                return;
            }

            const now = Date.now();
            if (now >= state.resetAt) {
                state.count = 0;
                state.authCount = 0;
                state.resetAt = now + WS_WINDOW_MS;
            }

            if (state.count >= WS_REQUESTS_PER_WINDOW) {
                send({ id, status: 429, error: 'Too many requests' });
                return;
            }
            if (WS_AUTH_PATHS.has(requestPath) && state.authCount >= WS_AUTH_REQUESTS_PER_WINDOW) {
                send({ id, status: 429, error: 'Too many authentication attempts' });
                return;
            }
            if (state.inFlight >= WS_MAX_IN_FLIGHT) {
                send({ id, status: 429, error: 'Too many concurrent requests' });
                return;
            }

            state.count += 1;
            if (WS_AUTH_PATHS.has(requestPath)) state.authCount += 1;

            const headers = {};
            if (message && message.headers && typeof message.headers === 'object') {
                for (const [name, value] of Object.entries(message.headers)) {
                    const key = String(name).toLowerCase();
                    if (!WS_FORWARDED_HEADERS.has(key)) continue;
                    if (typeof value !== 'string' || /[\r\n]/.test(value)) continue;
                    headers[key] = value.slice(0, 4096);
                }
            }

            let body = null;
            if (message && typeof message.bodyBase64 === 'string') {
                body = Buffer.from(message.bodyBase64, 'base64');
            } else if (message && typeof message.body === 'string' && message.body.length > 0) {
                body = Buffer.from(message.body, 'utf8');
            }
            if (body && body.length > WS_MAX_PAYLOAD) {
                send({ id, status: 413, error: 'Request body too large' });
                return;
            }

            state.inFlight += 1;
            try {
                const response = await replayLoopbackRequest(method, requestPath, headers, body);

                if (response.contentType.includes('application/json')) {
                    const text = response.body.toString('utf8');
                    let json = null;
                    try {
                        json = JSON.parse(text);
                    } catch (err) {
                        json = null;
                    }
                    if (json !== null) send({ id, status: response.status, contentType: response.contentType, json });
                    else send({ id, status: response.status, contentType: response.contentType, body: text });
                } else if (response.contentType.startsWith('text/') || response.contentType.includes('xml')) {
                    send({
                        id,
                        status: response.status,
                        contentType: response.contentType,
                        body: response.body.toString('utf8'),
                    });
                } else {
                    send({
                        id,
                        status: response.status,
                        contentType: response.contentType,
                        bodyBase64: response.body.toString('base64'),
                    });
                }
            } catch (err) {
                Logger.error('WebSocket', `Relay failed for ${method} ${requestPath}: ${err.message}`);
                send({ id, status: 502, error: 'API relay failed' });
            } finally {
                state.inFlight -= 1;
            }
        });

        ws.on('error', () => {
            // ws emits 'close' right after; nothing else to do per connection.
        });
    });

    return wss;
}

const server = http.createServer(app);
attachApiWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
    Logger.info('Server', `Listening on 0.0.0.0:${PORT} (API over HTTP and ws://…${WS_API_PATH})`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });