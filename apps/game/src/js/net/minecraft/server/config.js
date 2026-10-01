import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';

const MODULE_DIR = new URL('.', import.meta.url).pathname;
const PROJECT_ROOT = path.join(MODULE_DIR, '..', '..', '..', '..', '..');
const WORLDS_DIR = path.join(PROJECT_ROOT, 'worlds');

const defaults = {
    server: 'main',
    servers: [],
    port: 6008,
    host: '0.0.0.0',
    default_gamemode: 'creative',
    default_op: true,
    op_player_list: [],
    motd: 'Brand new server',
    allowMods: false,
    worldType: 'flat',
    seed: 0
};

// World types supported by the server generator.
const WORLD_TYPES = ['flat', 'normal', 'amplified'];

function sanitizeServerName(name) {
    return String(name || 'main').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'main';
}

// A "server" is a self-contained directory that owns its own world data and
// its own serverconfig.conf. The main server lives in the project root,
// additional servers live in worlds/<name>/.
function getServerDir(serverName) {
    const name = sanitizeServerName(serverName);
    return name === 'main' ? PROJECT_ROOT : path.join(WORLDS_DIR, name);
}

function getConfigPath(serverName) {
    return path.join(getServerDir(serverName), 'serverconfig.conf');
}

function parseValue(value) {
    value = value.trim();

    // Arrays: [item1, item2, ...]
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];
        return inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    }

    // Booleans
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Numbers
    if (/^\d+(\.\d+)?$/.test(value)) return Number(value);

    // Strings (strip quotes if present)
    return value.replace(/^["']|["']$/g, '');
}

function normalizeWorldType(worldType) {
    const wt = String(worldType || 'flat').toLowerCase().trim();
    return WORLD_TYPES.includes(wt) ? wt : 'flat';
}

function loadConfig(serverName = 'main') {
    const config = { ...defaults };
    config.server = sanitizeServerName(serverName);

    const configPath = getConfigPath(serverName);
    if (!fs.existsSync(configPath)) {
        return config;
    }

    const content = fs.readFileSync(configPath, 'utf8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;

        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (key in defaults) {
            config[key] = parseValue(value);
        }
    }

    config.worldType = normalizeWorldType(config.worldType);
    return config;
}

// Pick the startup server from the command line (--server <name>). The
// in-game /server command and last-used server (current_world.txt) can still
// override this at runtime, but the port/host from the selected server's
// serverconfig.conf are what the listener binds to.
function getRequestedServer() {
    if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
        return null;
    }
    const idx = process.argv.indexOf('--server');
    if (idx !== -1 && process.argv[idx + 1]) {
        return sanitizeServerName(process.argv[idx + 1]);
    }
    return null;
}

const requestedServer = getRequestedServer();

// Initial load uses the CLI-requested server if any, otherwise 'main'. The
// active server may later change at runtime via config.reload().
const config = loadConfig(requestedServer || 'main');

// Reload the config from the given server's directory, mutating this object
// in place so every module holding a reference sees the new values. If the
// server directory has no serverconfig.conf the current values are left
// untouched (a server without its own config inherits the active one).
function reloadConfig(serverName) {
    const target = sanitizeServerName(serverName);

    const configPath = getConfigPath(target);
    if (!fs.existsSync(configPath)) {
        config.server = target;
        return;
    }

    const fresh = loadConfig(target);
    for (const key of Object.keys(defaults)) {
        if (key === 'server' || key === 'servers') continue;
        config[key] = fresh[key];
    }
    config.server = target;
}

// List available servers: the explicit `servers` config wins when set,
// otherwise servers are auto-detected from worlds/ directories.
function listServers() {
    if (Array.isArray(config.servers) && config.servers.length > 0) {
        const servers = config.servers.map(sanitizeServerName);
        if (!servers.includes('main')) {
            servers.unshift('main');
        }
        return servers;
    }

    const servers = ['main'];
    if (fs.existsSync(WORLDS_DIR)) {
        const entries = fs.readdirSync(WORLDS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && /^[a-z0-9_]+$/.test(entry.name)) {
                const dir = path.join(WORLDS_DIR, entry.name);
                if (fs.existsSync(path.join(dir, 'world_data.bin')) || fs.existsSync(path.join(dir, 'serverconfig.conf'))) {
                    servers.push(entry.name);
                }
            }
        }
    }
    return servers;
}

config.reload = reloadConfig;
config.requestedServer = requestedServer;
config.listServers = listServers;

export default config;
