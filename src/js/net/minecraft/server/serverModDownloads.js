const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const config = require('./config.js').default;
const { loadCurrentWorld } = require('./world.js');
const { getServerModsDir, clearServerModsCache } = require('./serverMods.js');
const Logger = require('./logger.js').default;

const log = Logger;

const ENV_KEY = 'SERVER_MOD_URLS';
const INSTALL_MARKER = '.from-wiki';
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 200;
const REQUEST_TIMEOUT_MS = 30000;

function getModUrls() {
    if (typeof process === 'undefined' || !process.env) return [];
    const raw = process.env[ENV_KEY];
    if (typeof raw !== 'string' || raw.trim() === '') return [];

    return raw
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

async function resolveDownloadUrl(modUrl) {
    let pageUrl;
    try {
        pageUrl = new URL(modUrl);
    } catch {
        throw new Error('Not a valid URL');
    }

    if (pageUrl.protocol !== 'https:' && pageUrl.protocol !== 'http:') {
        throw new Error('Only http(s) URLs are supported');
    }

    if (!/\/view\/[^/]+\/?$/.test(pageUrl.pathname)) {
        return pageUrl.toString();
    }

    const response = await fetch(pageUrl, {
        headers: { 'user-agent': 'BreakmineServer/1.0 mod-installer' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`Could not read mod page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const match = html.match(/\/download\/[A-Za-z0-9_-]+\/v\/[A-Za-z0-9._-]+/);
    if (!match) {
        throw new Error('No download link found on the mod page');
    }

    return new URL(match[0], pageUrl).toString();
}

function parseModDataSource(source) {
    let cleaned = source.replace(/export\s+default\s+class\s+\w+\s*\{/, '{');
    cleaned = cleaned.replace(/import\s+.*?from\s+["'][^"']*["']\s*;?/g, '');
    cleaned = cleaned.replace(/\}\s*;?\s*$/, '}');
    cleaned = cleaned.replace(/static\s+(\w+)\s*=/g, '$1 =');

    const wrapped = `return (function() { ${cleaned} return { NAME, ID, AUTHOR, VERSION }; })()`;
    try {
        return new Function(wrapped)();
    } catch {
        return null;
    }
}

function resolveArchivePath(entryName, targetDir) {
    if (typeof entryName !== 'string' || entryName.length === 0) return null;
    if (entryName.includes('\0')) return null;

    const segments = entryName
        .replace(/\\/g, '/')
        .split('/')
        .filter((segment) => segment !== '' && segment !== '.');

    if (segments.length === 0) return null;
    if (segments.some((segment) => segment === '..' || path.isAbsolute(segment))) return null;
    if (segments.some((segment) => segment.length > MAX_FILENAME_LENGTH)) return null;

    const absolute = path.resolve(targetDir, ...segments);
    const root = targetDir.endsWith(path.sep) ? targetDir : targetDir + path.sep;
    return absolute.startsWith(root) ? absolute : null;
}

async function downloadModArchive(downloadUrl) {
    const response = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Archive is too large (${Math.round(declared / 1048576)} MB)`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Archive is too large (${Math.round(bytes.length / 1048576)} MB)`);
    }
    return bytes;
}

async function installMod(modUrl, modsDir) {
    const downloadUrl = await resolveDownloadUrl(modUrl);
    const bytes = await downloadModArchive(downloadUrl);
    const zip = await JSZip.loadAsync(bytes);

    const archives = Object.entries(zip.files)
        .filter(([, entry]) => !entry.dir)
        .map(([name, entry]) => ({
            name: name.replace(/\\/g, '/').replace(/^\.\//, ''),
            entry
        }))
        .filter(({ name }) => !name.startsWith('__MACOSX/'));

    const modDataEntry = archives
        .filter(({ name }) => name === 'ModData.js' || name.endsWith('/ModData.js'))
        .sort((a, b) => a.name.length - b.name.length)[0];
    if (!modDataEntry) {
        throw new Error('ModData.js not found in the archive');
    }

    const modData = parseModDataSource(await modDataEntry.entry.async('string'));
    const modId = modData && typeof modData.ID === 'string' ? modData.ID.trim() : '';
    if (!modId || !/^[A-Za-z0-9_-]{1,64}$/.test(modId)) {
        throw new Error('ModData.js does not declare a usable static ID');
    }

    const rootPrefix = modDataEntry.name === 'ModData.js'
        ? ''
        : modDataEntry.name.slice(0, -'ModData.js'.length);

    const targetDir = path.join(modsDir, modId);
    const tempDir = path.join(modsDir, `.install-${modId}-${process.pid}-${Date.now()}`);

    fs.mkdirSync(tempDir, { recursive: true });
    let files = 0;
    try {
        for (const { name, entry } of archives) {
            let relative = name;
            if (rootPrefix) {
                if (!relative.startsWith(rootPrefix)) continue;
                relative = relative.slice(rootPrefix.length);
            }
            if (!relative) continue;

            const absolute = resolveArchivePath(relative, tempDir);
            if (!absolute) continue;

            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, await entry.async('nodebuffer'));
            files++;
        }

        fs.writeFileSync(
            path.join(tempDir, INSTALL_MARKER),
            JSON.stringify({ source: downloadUrl, installedAt: new Date().toISOString() }, null, 2)
        );

        const replaced = fs.existsSync(targetDir);
        if (replaced) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        fs.renameSync(tempDir, targetDir);

        return {
            modId,
            name: (modData && modData.NAME) || modId,
            files,
            replaced,
            downloadUrl
        };
    } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw error;
    }
}

async function installServerModsFromEnv() {
    const urls = getModUrls();
    if (urls.length === 0) return [];

    const activeServer = config.requestedServer || loadCurrentWorld();
    config.reload(activeServer);

    if (config.serverMods === false) {
        log.warn('ServerMods', `${ENV_KEY} is set, but serverMods is disabled in serverconfig.conf.`);
        return [];
    }

    const modsDir = getServerModsDir();
    fs.mkdirSync(modsDir, { recursive: true });

    const results = await Promise.allSettled(urls.map(async (modUrl) => {
        try {
            return { modUrl, ...(await installMod(modUrl, modsDir)) };
        } catch (error) {
            error.modUrl = modUrl;
            throw error;
        }
    }));

    const installed = [];
    for (const outcome of results) {
        if (outcome.status === 'fulfilled') {
            const result = outcome.value;
            installed.push(result);
            log.info(
                'ServerMods',
                `${result.replaced ? 'Updated' : 'Installed'} '${result.name}' (${result.modId}, ${result.files} files) from ${result.downloadUrl}`
            );
        } else {
            const modUrl = outcome.reason?.modUrl || 'unknown URL';
            log.warn('ServerMods', `Could not install mod from '${modUrl}': ${outcome.reason?.message || outcome.reason}`);
        }
    }

    clearServerModsCache();
    return installed;
}

module.exports = { installServerModsFromEnv };
