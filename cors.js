const express = require('express');
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

// All runtime state lives here: auth.db, secrets.json and uploaded skins.
// Docker mounts a volume over DATA_DIR so accounts and sessions survive rebuilds.
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');

function loadOrCreateSecrets() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, 'skins'), { recursive: true });

    if (fs.existsSync(SECRETS_FILE)) {
        const secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
        if (secrets.jwtSecret && secrets.jwtSecret.length >= 64) {
            return secrets;
        }
    }

    const secrets = {
        jwtSecret: crypto.randomBytes(64).toString('hex'),
        createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    Logger.info('Secrets', 'Generated new JWT secret');
    return secrets;
}

const secrets = loadOrCreateSecrets();

const PORT = Number(process.env.PORT) || 6006;
const JWT_EXPIRES_IN = '7d';
const BCRYPT_ROUNDS = 12;
const MAX_SKIN_SIZE = 256 * 1024;
const UPLOAD_DIR = path.join(DATA_DIR, 'skins');

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
        skin_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE TABLE IF NOT EXISTS revoked_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_jti TEXT UNIQUE NOT NULL,
        revoked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON revoked_tokens(token_jti);
`);

const stmts = {
    createUser: db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'),
    findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findById: db.prepare('SELECT id, username, created_at, last_login, skin_path FROM users WHERE id = ?'),
    updateLastLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),
    updateSkinPath: db.prepare('UPDATE users SET skin_path = ? WHERE id = ?'),
    revokeToken: db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_jti, revoked_at, expires_at) VALUES (?, ?, ?)'),
    isTokenRevoked: db.prepare('SELECT 1 FROM revoked_tokens WHERE token_jti = ? AND expires_at > ?'),
    cleanExpiredTokens: db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?'),
};

setInterval(() => stmts.cleanExpiredTokens.run(Date.now()), 3600000);

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(rateLimit({ windowMs: 900000, max: 100 }));
app.use(express.json({ limit: '1mb' }));

const authLimiter = rateLimit({ windowMs: 900000, max: 10 });

const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.png'),
    }),
    limits: { fileSize: MAX_SKIN_SIZE },
    fileFilter: (req, file, cb) => {
        cb(file.mimetype === 'image/png' ? null : new Error('Only PNG images are allowed'), file.mimetype === 'image/png');
    },
});

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
        if (user?.skin_path) {
            const oldPath = path.join(UPLOAD_DIR, user.skin_path);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        stmts.updateSkinPath.run(req.file.filename, req.user.sub);
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

        const skinPath = path.resolve(UPLOAD_DIR, user.skin_path);
        if (!fs.existsSync(skinPath)) {
            stmts.updateSkinPath.run(null, user.id);
            return res.status(404).json({ error: 'Skin not found' });
        }

        const image = sharp(skinPath);
        const metadata = await image.metadata();
        if (metadata.width === 64 && metadata.height === 64) {
            res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
            image.extract({ left: 0, top: 0, width: 64, height: 32 }).png().pipe(res);
        } else {
            res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
            res.sendFile(skinPath);
        }
    } catch (err) {
        Logger.error('Skin', `GetSkin failed: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File too large. Max ${MAX_SKIN_SIZE / 1024}KB` : err.message });
    }
    if (err.message === 'Only PNG images are allowed') return res.status(400).json({ error: err.message });
    next(err);
});

app.use((err, req, res, next) => {
    Logger.error('Server', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, '0.0.0.0', () => {
    Logger.info('Server', `Listening on 0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });
