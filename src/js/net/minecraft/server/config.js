import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';

const MODULE_DIR = path.moduleDir();
// process / env only exist under Node (electron, standalone server). Running
// as an integrated server inside a browser worker there is no process, so
// read the env through this guard instead of bare process.env.
const ENV = (typeof process !== 'undefined' && process.env) || {};
const PROJECT_ROOT = ENV.DATA_DIR || path.join(MODULE_DIR, '..', '..', '..', '..', '..');
const WORLDS_DIR = path.join(PROJECT_ROOT, 'worlds');

const defaults = {
    server: 'main',
    servers: [],
    port: parseInt(ENV.SERVER_PORT || '6008', 10),
    host: '0.0.0.0',
    default_gamemode: 'creative',
    default_op: true,
    op_player_list: [],
    // Names an operator removed with /deop. Checked before default_op so a
    // server that opens op to everyone can still demote a single player.
    deop_player_list: [],
    // Operators that may also kick, ban and unban. A super op is an op too.
    super_op_player_list: [],
    motd: 'Brand new server',
    allowMods: false,
    // Server-side mods are sent to every client on join. The folder is
    // relative to the active server's directory (PROJECT_ROOT for "main",
    // worlds/<name>/ otherwise).
    serverMods: true,
    serverModsDir: 'servermods',
    worldType: 'flat',
    seed: 0,
    // Destructive gameplay rules. Environment switches can turn these off
    // for a server; clients receive the same values on login so their local
    // prediction does not fight the authoritative server.
    allowTNT: true,
    allowLiquidFlow: true,
    icon: null // Server icon (base64 data URL or path to icon file)
};

function isEnvEnabled(name) {
    const value = ENV[name];
    return typeof value === 'string'
        && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

// These are intentionally one-way: setting the variable turns the behavior
// off, while leaving it unset keeps the normal serverconfig value.
function applyEnvOverrides(config) {
    if (isEnvEnabled('SERVER_DISABLE_TNT')) {
        config.allowTNT = false;
    }
    if (isEnvEnabled('SERVER_DISABLE_LIQUID_FLOW')) {
        config.allowLiquidFlow = false;
    }
    return config;
}

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
    if (fs.existsSync(configPath)) {
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
    }

    config.worldType = normalizeWorldType(config.worldType);
    return applyEnvOverrides(config);
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

    // Clear icon cache when switching servers
    cachedIcon = null;
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
config.getServerDir = getServerDir;

// Load server icon from file or config
let cachedIcon = null;
const MAX_ICON_SIZE = 64 * 1024; // 64KB max for server icon

async function fetchIconFromUrl(url) {
    try {
        console.log(`[Icon] Fetching icon from URL: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            console.log(`[Icon] Failed to fetch icon: HTTP ${response.status}`);
            return null;
        }
        const buffer = await response.arrayBuffer();
        const data = Buffer.from(buffer);
        console.log(`[Icon] Icon file size: ${data.length} bytes`);
        if (data.length <= MAX_ICON_SIZE) {
            const base64 = data.toString('base64');
            const dataUrl = `data:image/png;base64,${base64}`;
            console.log('[Icon] Successfully loaded icon from URL');
            return dataUrl;
        } else {
            console.log('[Icon] Icon from URL too large');
            return null;
        }
    } catch (e) {
        console.log(`[Icon] Failed to fetch icon from URL: ${e.message}`);
        return null;
    }
}

function loadServerIcon() {
    if (cachedIcon !== null) return cachedIcon;

    console.log(`[Icon] Loading icon for server: ${config.server}`);

    // Check environment variable first (highest priority)
    const envIcon = ENV.SERVER_ICON;
    if (envIcon && typeof envIcon === 'string') {
        console.log('[Icon] Checking SERVER_ICON environment variable');
        // If it's a data URL, use it directly
        if (envIcon.startsWith('data:image')) {
            console.log('[Icon] Using data URL from environment variable');
            cachedIcon = envIcon;
            return cachedIcon;
        }
        // If it's a URL, fetch it
        if (envIcon.startsWith('http://') || envIcon.startsWith('https://')) {
            fetchIconFromUrl(envIcon).then(icon => {
                if (icon) {
                    cachedIcon = icon;
                }
            });
            return null; // Return null for now, will be cached when fetch completes
        }
        // Otherwise treat it as a file path
        const pathsToTry = [
            path.join(PROJECT_ROOT, envIcon),  // Project root
            path.join(getServerDir(config.server), envIcon)  // Server directory
        ];

        for (const iconPath of pathsToTry) {
            try {
                console.log(`[Icon] Trying to load icon from env path: ${iconPath}`);
                if (fs.existsSync(iconPath)) {
                    const data = fs.readFileSync(iconPath);
                    console.log(`[Icon] Icon file size: ${data.length} bytes`);
                    if (data.length <= MAX_ICON_SIZE) {
                        const base64 = Buffer.from(data).toString('base64');
                        cachedIcon = `data:image/png;base64,${base64}`;
                        console.log('[Icon] Successfully loaded icon from env file');
                        return cachedIcon;
                    } else {
                        console.log('[Icon] Icon file too large');
                    }
                }
            } catch (e) {
                console.log(`[Icon] Failed to load icon from env path: ${e.message}`);
            }
        }
        console.log('[Icon] Icon from env does not exist in any location');
    }

    // If icon is already a data URL in config, use it
    if (config.icon && config.icon.startsWith('data:image')) {
        console.log('[Icon] Using data URL from config');
        cachedIcon = config.icon;
        return cachedIcon;
    }

    // If icon is a URL, fetch it
    if (config.icon && (config.icon.startsWith('http://') || config.icon.startsWith('https://'))) {
        fetchIconFromUrl(config.icon).then(icon => {
            if (icon) {
                cachedIcon = icon;
            }
        });
        return null; // Return null for now, will be cached when fetch completes
    }

    // If icon is a file path, try to load it (relative to project root first, then server dir)
    if (config.icon && typeof config.icon === 'string') {
        const pathsToTry = [
            path.join(PROJECT_ROOT, config.icon),  // Project root
            path.join(getServerDir(config.server), config.icon)  // Server directory
        ];

        for (const iconPath of pathsToTry) {
            try {
                console.log(`[Icon] Trying to load icon from path: ${iconPath}`);
                if (fs.existsSync(iconPath)) {
                    const data = fs.readFileSync(iconPath);
                    console.log(`[Icon] Icon file size: ${data.length} bytes`);
                    if (data.length <= MAX_ICON_SIZE) {
                        const base64 = Buffer.from(data).toString('base64');
                        cachedIcon = `data:image/png;base64,${base64}`;
                        console.log('[Icon] Successfully loaded icon from file');
                        return cachedIcon;
                    } else {
                        console.log('[Icon] Icon file too large');
                    }
                }
            } catch (e) {
                console.log(`[Icon] Failed to load icon from path: ${e.message}`);
            }
        }
        console.log('[Icon] Icon file does not exist in any location');
    }

    // Try to load server_icon.png from project root first, then server directory
    const defaultPaths = [
        path.join(PROJECT_ROOT, 'server_icon.png'),
        path.join(getServerDir(config.server), 'server_icon.png')
    ];

    for (const iconPath of defaultPaths) {
        try {
            console.log(`[Icon] Trying default server_icon.png: ${iconPath}`);
            if (fs.existsSync(iconPath)) {
                const data = fs.readFileSync(iconPath);
                console.log(`[Icon] Default icon file size: ${data.length} bytes`);
                if (data.length <= MAX_ICON_SIZE) {
                    const base64 = Buffer.from(data).toString('base64');
                    cachedIcon = `data:image/png;base64,${base64}`;
                    console.log('[Icon] Successfully loaded default icon');
                    return cachedIcon;
                } else {
                    console.log('[Icon] Default icon file too large');
                }
            }
        } catch (e) {
            console.log(`[Icon] Failed to load default icon: ${e.message}`);
        }
    }

    console.log('[Icon] No icon found');
    cachedIcon = null;
    return null;
}

function getServerIcon() {
    return loadServerIcon();
}

config.getServerIcon = getServerIcon;

function serializeNameList(list) {
    const names = Array.isArray(list) ? list : [];
    return '[' + names.map(name => `"${String(name).replace(/["\[\],]/g, '')}"`).join(', ') + ']';
}

// Persist the op/deop lists back into the active server's config file. Only
// those two lines are touched, so comments and hand-edited keys survive.
function writePlayerLists() {
    const configPath = getConfigPath(config.server);
    const dir = getServerDir(config.server);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const lines = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8').split('\n') : [];
    const values = {
        op_player_list: serializeNameList(config.op_player_list),
        deop_player_list: serializeNameList(config.deop_player_list),
        super_op_player_list: serializeNameList(config.super_op_player_list)
    };

    const written = new Set();
    const out = lines.map(line => {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1 || line.trim().startsWith('#')) {
            return line;
        }
        const key = line.slice(0, eqIdx).trim();
        if (!(key in values)) {
            return line;
        }
        written.add(key);
        return `${key}=${values[key]}`;
    });

    for (const key of Object.keys(values)) {
        if (!written.has(key)) {
            out.push(`${key}=${values[key]}`);
        }
    }

    fs.writeFileSync(configPath, out.join('\n'));
}

config.writePlayerLists = writePlayerLists;

export default config;
