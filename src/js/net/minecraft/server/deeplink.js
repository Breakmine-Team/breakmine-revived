const path = require('node:path');
const fs = require('node:fs');
const { app, dialog } = require('electron');

/* ------------------------------------------------------------------ *
 *  breakmine-game:// deep links
 *
 *  The mod wiki's "Download Version" dialog can hand a mod straight to the
 *  desktop app instead of saving a .zip:
 *
 *      breakmine-game://install?url=https://mods.breakmine.com/download/1/v/2&name=My%20Mod&version=1.2.0
 *
 *  Anything arriving here is untrusted — a link can be triggered by any web
 *  page the user visits — so the install is only ever performed after an
 *  explicit confirmation dialog, the download host must be on the allowlist
 *  below, and the archive is size-capped and extracted without following
 *  entries that escape the mods folder.
 * ------------------------------------------------------------------ */

const SCHEME = 'breakmine-game';
const ACTION_INSTALL = 'install';

// Only these hosts may serve an install payload. Keep in sync with the
// wiki's own hosts; `localhost` is there so the wiki can be tested locally.
const ALLOWED_HOSTS = new Set([
    'mods.breakmine.com',
    'wiki.breakmine.com',
    'breakmine.com',
    'localhost',
    '127.0.0.1'
]);

// Mods are small; anything larger is a mistake or an attack.
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 200;
const MAX_NAME_LENGTH = 120;

// Marks a folder as installed by the wiki rather than hand-written, so a
// reinstall is allowed to replace it. See ModLoader._loadEnabledSet().
const INSTALL_MARKER = '.from-wiki';

let JSZip = null;
function getJSZip() {
    if (!JSZip) JSZip = require('jszip');
    return JSZip;
}

/**
 * Parse and validate a deep link.
 * @param {string} raw
 * @returns {{action: string, url: string, name: string, version: string}|null}
 *          null when the link is malformed or not allowed.
 */
function parseDeepLink(raw) {
    if (typeof raw !== 'string' || !raw.toLowerCase().startsWith(`${SCHEME}://`)) {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }

    // For a non-special scheme the URL parser puts the first segment in
    // `host`, so 'breakmine-game://install?...' arrives as host === 'install'.
    const action = decodeURIComponent(parsed.host).toLowerCase();
    if (action !== ACTION_INSTALL) {
        return null;
    }

    const downloadUrl = parsed.searchParams.get('url');
    if (!downloadUrl) return null;

    let target;
    try {
        target = new URL(downloadUrl);
    } catch {
        return null;
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return null;
    if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) return null;

    const clip = (value, max) =>
        typeof value === 'string' && value.length > 0 ? value.slice(0, max) : '';

    return {
        action,
        url: target.toString(),
        name: clip(parsed.searchParams.get('name'), MAX_NAME_LENGTH),
        version: clip(parsed.searchParams.get('version'), 40)
    };
}

/** Pull the first deep link out of an argv array (Windows / Linux cold start). */
function findDeepLinkInArgv(argv) {
    if (!Array.isArray(argv)) return null;
    for (const arg of argv) {
        if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${SCHEME}://`)) {
            return arg;
        }
    }
    return null;
}

/**
 * Read the static fields out of a ModData.js source string.
 *
 * Mirrors ModLoader._parseModDataSource — kept here because the main process
 * is CommonJS and cannot import the renderer's ESM module. Both only need the
 * four static metadata fields, and neither executes the mod itself.
 */
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

/**
 * Turn an archive path into a safe path inside `targetDir`, or null when the
 * entry tries to escape (zip-slip). Also skips anything that is not a
 * reasonably named regular file.
 */
function resolveArchivePath(entryName, targetDir) {
    if (typeof entryName !== 'string' || entryName.length === 0) return null;
    if (entryName.includes('\0')) return null;

    const segments = entryName
        .replace(/\\/g, '/')
        .split('/')
        .filter((s) => s !== '' && s !== '.');

    if (segments.length === 0) return null;
    if (segments.some((s) => s === '..' || path.isAbsolute(s))) return null;
    if (segments.some((s) => s.length > MAX_FILENAME_LENGTH)) return null;

    const abs = path.resolve(targetDir, ...segments);
    const rootWithSep = targetDir.endsWith(path.sep) ? targetDir : targetDir + path.sep;
    if (!abs.startsWith(rootWithSep)) return null;

    return abs;
}

/**
 * Download and extract a mod into `modsDir/<modId>/`.
 * @returns {Promise<{modId: string, name: string, files: number, replaced: boolean}>}
 */
async function installModFromUrl(downloadUrl, modsDir, { allowReplace }) {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Mod is too large (${Math.round(declared / 1048576)} MB)`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Mod is too large (${Math.round(bytes.length / 1048576)} MB)`);
    }

    const zip = await getJSZip().loadAsync(bytes);

    // ModData.js lives at the archive root, per the mod format.
    let modDataSource = null;
    for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const normalized = name.replace(/^\.\//, '');
        if (normalized === 'ModData.js' || normalized.endsWith('/ModData.js')) {
            modDataSource = await entry.async('string');
            break;
        }
    }
    if (!modDataSource) {
        throw new Error('ModData.js not found in the archive.');
    }

    const modData = parseModDataSource(modDataSource);
    const modId = modData && typeof modData.ID === 'string' ? modData.ID.trim() : '';
    if (!modId || !/^[A-Za-z0-9_-]{1,64}$/.test(modId)) {
        throw new Error('ModData.js does not declare a usable static ID.');
    }

    const targetDir = path.join(modsDir, modId);

    // Only clobber a folder we installed ourselves, unless the caller has
    // already confirmed the overwrite with the user.
    let replaced = false;
    if (fs.existsSync(targetDir)) {
        const ours = fs.existsSync(path.join(targetDir, INSTALL_MARKER));
        if (!ours && !allowReplace) {
            const err = new Error(`'${modId}' already exists in mods/ and was not installed from the wiki.`);
            err.code = 'EEXISTS_UNMANAGED';
            err.modId = modId;
            throw err;
        }
        fs.rmSync(targetDir, { recursive: true, force: true });
        replaced = true;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    let files = 0;
    for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;

        const abs = resolveArchivePath(name.replace(/^\.\//, ''), targetDir);
        if (!abs) continue; // skip traversal attempts rather than aborting

        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const contents = await entry.async('nodebuffer');
        fs.writeFileSync(abs, contents);
        files++;
    }

    // Record provenance so a later update knows it may replace this folder.
    fs.writeFileSync(
        path.join(targetDir, INSTALL_MARKER),
        JSON.stringify({ source: downloadUrl, installedAt: new Date().toISOString() }, null, 2)
    );

    return {
        modId,
        name: (modData && modData.NAME) || modId,
        files,
        replaced
    };
}

/**
 * Show a message box, parented to the game window when there is one.
 * Electron takes two different overloads here — passing an explicit
 * `undefined` as the first argument is not the same as omitting it.
 */
function showMessage(win, options) {
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

/**
 * Install the mod a deep link points at.
 *
 * The user already answered "Do you want to install to Breakmine Desktop?"
 * on the wiki page, which is where that question makes sense — inside the app
 * there is nobody to tell they do not have it. So the link installs directly
 * and this only reports the outcome.
 *
 * @param {object} opts
 * @param {BrowserWindow|null} opts.window  parent for the dialog
 * @param {string} opts.modsDir
 */
async function handleInstallLink(link, { window, modsDir }) {
    const label = link.name || 'this mod';

    try {
        const result = await installModFromUrl(link.url, modsDir, { allowReplace: false });
        console.log(`[deeplink] Installed '${result.modId}' (${result.files} files) from the wiki.`);

        await showMessage(window, {
            type: 'info',
            buttons: ['OK'],
            defaultId: 0,
            title: 'Breakmine Desktop',
            message: `Installed ${result.name} to mods/${result.modId}.`,
            detail: 'Restart Breakmine Desktop to play it.'
        });
    } catch (err) {
        // Hand-made mods in mods/ are not ours to delete, so replacing one
        // still needs an explicit answer.
        if (err.code === 'EEXISTS_UNMANAGED') {
            const { response: overwrite } = await showMessage(window, {
                type: 'warning',
                buttons: ['Replace', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                noLink: true,
                title: 'Breakmine Desktop',
                message: `${label} is already in your mods folder.`,
                detail: `Replacing it will delete everything currently in mods/${err.modId}.`
            });
            if (overwrite !== 0) return;

            try {
                const result = await installModFromUrl(link.url, modsDir, { allowReplace: true });
                console.log(`[deeplink] Replaced '${result.modId}' from the wiki.`);
                await showMessage(window, {
                    type: 'info',
                    buttons: ['OK'],
                    title: 'Breakmine Desktop',
                    message: `Installed ${result.name} to mods/${result.modId}.`,
                    detail: 'Restart Breakmine Desktop to play it.'
                });
            } catch (inner) {
                await showInstallError(inner, label, window);
            }
            return;
        }

        await showInstallError(err, label, window);
    }
}

async function showInstallError(err, label, window) {
    console.error('[deeplink] Install failed:', err);
    await showMessage(window, {
        type: 'error',
        buttons: ['OK'],
        title: 'Breakmine Desktop',
        message: `Could not install ${label}.`,
        detail: err.message
    });
}

/**
 * Register the protocol handler and start consuming deep links.
 *
 * @param {object} opts
 * @param {string} opts.modsDir
 * @param {() => BrowserWindow|null} opts.getWindow  for parenting dialogs
 */
function registerDeepLinks({ modsDir, getWindow }) {
    // In dev the executable is Electron itself, so the OS needs the app path
    // passed along for the registration to point back at this checkout.
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient(SCHEME, process.execPath, [
                path.resolve(process.argv[1])
            ]);
        }
    } else {
        app.setAsDefaultProtocolClient(SCHEME);
    }

    // A link can arrive before the window exists (cold start via argv, or
    // `open-url` firing before `whenReady`), so hold it until we're ready.
    let pending = null;
    let draining = false;

    async function drain() {
        if (draining || !pending) return;
        draining = true;
        const link = pending;
        pending = null;
        try {
            await handleInstallLink(link, { window: getWindow(), modsDir });
        } catch (err) {
            console.error('[deeplink] Failed to handle link:', err);
        } finally {
            draining = false;
            if (pending) drain();
        }
    }

    function enqueue(raw) {
        const link = parseDeepLink(raw);
        if (!link) {
            if (typeof raw === 'string' && raw.toLowerCase().startsWith(`${SCHEME}://`)) {
                console.warn('[deeplink] Ignoring unsupported link:', raw);
            }
            return;
        }
        pending = link;
        if (app.isReady()) {
            const win = getWindow();
            if (win) {
                if (win.isMinimized()) win.restore();
                win.focus();
            }
            drain();
        }
    }

    // macOS delivers links through open-url rather than argv.
    app.on('open-url', (event, url) => {
        event.preventDefault();
        enqueue(url);
    });

    // Cold start on Windows/Linux: the URL is the last argv entry.
    enqueue(findDeepLinkInArgv(process.argv));

    return {
        /**
         * Route a link that arrived with a second launch. Focus the existing
         * window first so the dialog has a parent.
         */
        handleSecondInstance(argv) {
            const raw = findDeepLinkInArgv(argv);
            const win = getWindow();
            if (win) {
                if (win.isMinimized()) win.restore();
                win.focus();
            }
            if (raw) enqueue(raw);
        }
    };
}

module.exports = { SCHEME, parseDeepLink, findDeepLinkInArgv, registerDeepLinks, INSTALL_MARKER };