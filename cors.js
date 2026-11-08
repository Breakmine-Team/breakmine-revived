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
const MAX_CAPE_SIZE = 64 * 1024;

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
};

setInterval(() => stmts.cleanExpiredTokens.run(Date.now()), 3600000);

function isSupportedSkinSize(width, height) {
    if (width === 64 && (height === 32 || height === 64)) return true;
    // HD skins keep the 64px layout scaled by a whole number. Modern skins are
    // square; some older HD skins use a half-height (128x64, 256x128) layout.
    return width >= 128 && width % 64 === 0 && (height === width || height * 2 === width);
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
        <label>Cape PNG (64×32)<input type="file" name="file" accept="image/png" required></label>
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
            if (metadata.format !== 'png' || metadata.width !== CAPE_WIDTH || metadata.height !== CAPE_HEIGHT) {
                return fail('Cape PNG must be 64×32 pixels.');
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