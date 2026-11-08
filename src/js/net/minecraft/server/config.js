import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';

const MODULE_DIR = path.moduleDir();



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
    deop_player_list: [],
    super_op_player_list: [],
    motd: 'Brand new server',
    allowMods: false,
    serverMods: true,
    serverModsDir: 'servermods',
    worldType: 'flat',
    seed: 0,
    allowTNT: true,
    allowLiquidFlow: true,
    icon: null 
};

function isEnvEnabled(name) {
    const value = ENV[name];
    return typeof value === 'string'
        && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}


function parseNameList(value) {
    if (typeof value !== 'string') {
        return [];
    }

    return value
        .split(',')
        .map(name => name.trim().replace(/^["']|["']$/g, ''))
        .filter(name => name.length > 0);
}




const envSuperOps = parseNameList(ENV.SUPER_OPS);

function isEnvSuperOp(name) {
    const wanted = String(name || '').toLowerCase();
    return wanted.length > 0 && envSuperOps.some(entry => entry.toLowerCase() === wanted);
}



function applyEnvOverrides(config) {
    if (isEnvEnabled('SERVER_DISABLE_TNT')) {
        config.allowTNT = false;
    }
    if (isEnvEnabled('SERVER_DISABLE_LIQUID_FLOW')) {
        config.allowLiquidFlow = false;
    }
    return config;
}


const WORLD_TYPES = ['flat', 'normal', 'amplified', 'hellish'];

function sanitizeServerName(name) {
    return String(name || 'main').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'main';
}




function getServerDir(serverName) {
    const name = sanitizeServerName(serverName);
    return name === 'main' ? PROJECT_ROOT : path.join(WORLDS_DIR, name);
}

function getConfigPath(serverName) {
    return path.join(getServerDir(serverName), 'serverconfig.conf');
}

function parseValue(value) {
    value = value.trim();

    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];
        return inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    }

    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    if (/^\d+(\.\d+)?$/.test(value)) return Number(value);

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



const config = loadConfig(requestedServer || 'main');





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

    cachedIcon = null;
}



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


let cachedIcon = null;
const MAX_ICON_SIZE = 64 * 1024; 

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

    const envIcon = ENV.SERVER_ICON;
    if (envIcon && typeof envIcon === 'string') {
        console.log('[Icon] Checking SERVER_ICON environment variable');
        if (envIcon.startsWith('data:image')) {
            console.log('[Icon] Using data URL from environment variable');
            cachedIcon = envIcon;
            return cachedIcon;
        }
        if (envIcon.startsWith('http://') || envIcon.startsWith('https://')) {
            fetchIconFromUrl(envIcon).then(icon => {
                if (icon) {
                    cachedIcon = icon;
                }
            });
            return null; 
        }
        const pathsToTry = [
            path.join(PROJECT_ROOT, envIcon),  
            path.join(getServerDir(config.server), envIcon)  
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

    if (config.icon && config.icon.startsWith('data:image')) {
        console.log('[Icon] Using data URL from config');
        cachedIcon = config.icon;
        return cachedIcon;
    }

    if (config.icon && (config.icon.startsWith('http://') || config.icon.startsWith('https://'))) {
        fetchIconFromUrl(config.icon).then(icon => {
            if (icon) {
                cachedIcon = icon;
            }
        });
        return null; 
    }

    if (config.icon && typeof config.icon === 'string') {
        const pathsToTry = [
            path.join(PROJECT_ROOT, config.icon),  
            path.join(getServerDir(config.server), config.icon)  
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

config.getEnvSuperOps = () => [...envSuperOps];
config.isEnvSuperOp = isEnvSuperOp;

export default config;
