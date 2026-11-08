import { Buffer } from '../../../../../libraries/buffer.js';
import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';
import Logger from './logger.js';
import config from './config.js';

const log = Logger;



const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
    '.ogg', '.wav', '.mp3'
]);

let cache = null;




let injectedMods = [];
let injectedGeneration = 0;

export function setInjectedServerMods(mods) {
    injectedMods = Array.isArray(mods)
        ? mods.filter((mod) => mod && typeof mod === 'object' && typeof mod.id === 'string')
        : [];
    injectedGeneration++;
    cache = null;
}

export function clearInjectedServerMods() {
    setInjectedServerMods([]);
}

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

export function clearServerModsCache() {
    cache = null;
}
