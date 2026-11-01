import { Buffer } from '../../../../../libraries/buffer.js';
import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';
import Logger from './logger.js';
import config from './config.js';

const log = Logger;

// Files the client mod loader stores as base64 (`textures/*.png.b64`,
// `sounds/*.ogg.b64`, GUI backdrops). Anything else is sent as text.
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
    '.ogg', '.wav', '.mp3'
]);

let cache = null;

// Mods handed to an integrated (singleplayer) server by the client that owns
// it. They are not written to disk: the client's installed mods stay the
// source of truth, and uninstalling one takes effect on the next world load.
let injectedMods = [];
let injectedGeneration = 0;

/**
 * Provide the local client's mods to an integrated server.
 *
 * The objects use the same shape as serverMods/ on disk (metadata plus a flat
 * file list), so the normal server-mod loader can register their commands and
 * authoritative hooks without knowing where they came from.
 */
export function setInjectedServerMods(mods) {
    injectedMods = Array.isArray(mods)
        ? mods.filter((mod) => mod && typeof mod === 'object' && typeof mod.id === 'string')
        : [];
    injectedGeneration++;
    cache = null;
}

/** Drop the local client mods when the integrated server stops. */
export function clearInjectedServerMods() {
    setInjectedServerMods([]);
}

/**
 * Directory holding the active server's server-side mods.
 *
 * It is resolved inside the active server directory so each server in
 * `worlds/` owns its own set of mods, just like it owns its world data and
 * config. `serverModsDir` is configurable but may not escape that directory.
 */
export function getServerModsDir() {
    const base = config.getServerDir(config.server);
    const configured = String(config.serverModsDir || 'servermods').replace(/\\/g, '/');
    const segments = configured
        .split('/')
        .filter((segment) => segment !== '' && segment !== '.');

    if (segments.length === 0 || segments.some((segment) => segment === '..')) {
        return path.join(base, 'servermods');
    }
    return path.join(base, ...segments);
}

function parseModDataSource(source) {
    let cleaned = source.replace(/export\s+default\s+class\s+\w+\s*\{/, '{');
    cleaned = cleaned.replace(/import\s+.*?from\s+["'][^"']*["']\s*;?/g, '');
    cleaned = cleaned.replace(/\}\s*;?\s*$/, '}');
    cleaned = cleaned.replace(/static\s+(\w+)\s*=/g, '$1 =');

    const wrapped = `return (function() { ${cleaned} return { NAME, ID, AUTHOR, VERSION }; })()`;
    try {
        return new Function(wrapped)();
    } catch (err) {
        return null;
    }
}

function isBinaryPath(filePath) {
    const dot = filePath.lastIndexOf('.');
    if (dot === -1) return false;
    return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

function collectFiles(dirAbs, prefix, out) {
    let entries;
    try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        // A symlink inside a mod could point anywhere on the server's disk.
        if (entry.isSymbolicLink()) continue;

        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const abs = path.join(dirAbs, entry.name);

        if (entry.isDirectory()) {
            collectFiles(abs, rel, out);
            continue;
        }
        if (!entry.isFile()) continue;

        try {
            if (isBinaryPath(rel)) {
                const bytes = fs.readFileSync(abs);
                out.push({ path: rel, binary: true, data: Buffer.from(bytes).toString('base64') });
            } else {
                out.push({ path: rel, binary: false, data: fs.readFileSync(abs, 'utf8') });
            }
        } catch (err) {
            log.warn('Server', `Could not read server mod file '${rel}': ${err.message}`);
        }
    }
}

function readModDirectory(dirAbs, folderName) {
    const modDataPath = path.join(dirAbs, 'ModData.js');
    if (!fs.existsSync(modDataPath)) {
        log.warn('Server', `Skipping server mod '${folderName}': ModData.js is missing.`);
        return null;
    }

    let source;
    try {
        source = fs.readFileSync(modDataPath, 'utf8');
    } catch (err) {
        log.warn('Server', `Skipping server mod '${folderName}': ${err.message}`);
        return null;
    }

    const meta = parseModDataSource(source);
    const id = meta && typeof meta.ID === 'string' ? meta.ID.trim() : '';
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        log.warn('Server', `Skipping server mod '${folderName}': ModData.js has no valid static ID.`);
        return null;
    }

    const files = [];
    collectFiles(dirAbs, '', files);

    return {
        id,
        name: (meta.NAME && String(meta.NAME)) || id,
        author: (meta.AUTHOR && String(meta.AUTHOR)) || 'Unknown',
        version: (meta.VERSION && String(meta.VERSION)) || '0.0.0',
        files
    };
}

/**
 * Read (and cache) every server-side mod for the active server.
 *
 * The returned shape is exactly what gets sent to clients: metadata plus a
 * flat file list. Text files carry text; PNG/OGG files carry base64, matching
 * the `.b64` layout the client mod loader already understands.
 */
export function readServerMods() {
    const modsDir = getServerModsDir();
    const cacheKey = `${modsDir}|${config.serverMods !== false}|${injectedGeneration}`;

    if (cache && cache.key === cacheKey) {
        return cache.mods;
    }

    const mods = [];

    if (config.serverMods !== false && fs.existsSync(modsDir)) {
        let entries = [];
        try {
            entries = fs.readdirSync(modsDir, { withFileTypes: true });
        } catch (err) {
            log.warn('Server', `Could not read server mods directory '${modsDir}': ${err.message}`);
        }

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
            const mod = readModDirectory(path.join(modsDir, entry.name), entry.name);
            if (mod) mods.push(mod);
        }
    }

    // A folder in this world's servermods/ wins over an injected copy of the
    // same mod, so an operator/server config can always override it.
    const knownIds = new Set(mods.map((mod) => mod.id));
    for (const mod of injectedMods) {
        if (knownIds.has(mod.id)) continue;
        knownIds.add(mod.id);
        mods.push(mod);
    }

    cache = { key: cacheKey, mods };
    if (mods.length > 0) {
        log.info('Server', `Loaded ${mods.length} server mod(s) from ${modsDir}`);
    }
    return mods;
}

/** Drop the cache after the operator adds or removes mods at runtime. */
export function clearServerModsCache() {
    cache = null;
}
