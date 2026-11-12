const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

/**
 * Keeps the desktop game current by downloading the published single-file
 * build instead of re-downloading and re-running the AppImage installer.
 *
 * scripts/publish-single.js uploads that build to the data-store as index.html
 * with a version.txt beside it, which is exactly what a browser gets from
 * https://breakmine.com. The desktop app now reads the same two files: on
 * launch it compares version.txt with the copy it already has in userData and,
 * if they differ, replaces its local copy and reloads. The bundled dist/ build
 * stays in the package as a first-run/offline fallback.
 */

const GAME_URL = 'https://datastore.breakmine.com/index.html';
const VERSION_URL = 'https://datastore.breakmine.com/version.txt';

const META_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

// Sanity bounds. The published build is tens of megabytes; anything much
// smaller is an error page or a truncated response, so it must not replace a
// working copy.
const MIN_GAME_BYTES = 1024 * 1024;
const MAX_GAME_BYTES = 512 * 1024 * 1024;
const PROGRESS_STEP_BYTES = 5 * 1024 * 1024;

const GAME_DIR = path.join(app.getPath('userData'), 'game');
const GAME_FILE = path.join(GAME_DIR, 'index.html');
const VERSION_FILE = path.join(GAME_DIR, 'version.txt');
const PARTIAL_FILE = path.join(GAME_DIR, 'index.html.part');

// The build electron-builder ships (see electron-builder.yml), used until the
// download lands and whenever datastore is unreachable.
const BUNDLED_GAME = path.join(__dirname, '..', '..', '..', '..', '..', 'dist', 'index.html');

let running = false;

function megabytes(bytes) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function send(win, status) {
    if (win && !win.isDestroyed()) {
        win.webContents.send('game:updateStatus', status);
    }
}

function installedVersion() {
    try {
        return fs.readFileSync(VERSION_FILE, 'utf8').trim();
    } catch {
        return '';
    }
}

function installedGame() {
    try {
        return fs.statSync(GAME_FILE).size >= MIN_GAME_BYTES ? GAME_FILE : null;
    } catch {
        return null;
    }
}

/** The file the window should load: the downloaded game, else the bundled one. */
function gameStartPage() {
    return installedGame() || BUNDLED_GAME;
}

async function fetchText(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return await response.text();
    } finally {
        clearTimeout(timer);
    }
}

function describeFailure(err) {
    if (err && err.name === 'AbortError') return 'the download timed out';
    return (err && err.message) || String(err);
}

/**
 * Download the published game page and swap it into place.
 *
 * The response is written to a `.part` file and renamed, so an interrupted
 * download can never leave a half-written page that the next launch would
 * happily load.
 */
async function downloadGame({ window: win } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(`${GAME_URL}?t=${Date.now()}`, {
            cache: 'no-store',
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`the game download failed (HTTP ${response.status} ${response.statusText})`);
        }

        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_GAME_BYTES) {
            throw new Error(`the game download is implausibly large (${megabytes(declared)})`);
        }

        const chunks = [];
        let received = 0;
        let reportedAt = 0;

        if (response.body && typeof response.body.getReader === 'function') {
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;

                received += value.byteLength;
                if (received > MAX_GAME_BYTES) {
                    await reader.cancel().catch(() => {});
                    throw new Error('the game download is implausibly large');
                }

                chunks.push(Buffer.from(value));

                if (received - reportedAt >= PROGRESS_STEP_BYTES) {
                    reportedAt = received;
                    send(win, {
                        phase: 'downloading',
                        message: Number.isFinite(declared) && declared > 0
                            ? `Downloading the game... ${megabytes(received)} of ${megabytes(declared)}`
                            : `Downloading the game... ${megabytes(received)}`
                    });
                }
            }
        } else {
            const buffer = Buffer.from(await response.arrayBuffer());
            received = buffer.length;
            chunks.push(buffer);
        }

        const html = Buffer.concat(chunks, received);
        if (html.length < MIN_GAME_BYTES) {
            throw new Error(`the downloaded game was only ${megabytes(html.length)}, so it was not installed`);
        }

        const head = html.subarray(0, 8192).toString('utf8').toLowerCase();
        if (!head.includes('<!doctype html') && !head.includes('<html')) {
            throw new Error('the download was not the game page');
        }

        fs.mkdirSync(GAME_DIR, { recursive: true });
        await fs.promises.writeFile(PARTIAL_FILE, html);
        await fs.promises.rename(PARTIAL_FILE, GAME_FILE);

        return html.length;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Bring the local copy up to date with datastore.
 *
 * Returns `{ updated: true, version, bytes }` when the game was replaced, or
 * `{ updated: false, version }` when the installed copy already matches (or
 * `{ updated: false, error }` when the network failed). Never throws: a failed
 * update leaves the current game playable.
 */
async function updateGame({ window: win, force = false } = {}) {
    if (running) {
        return { updated: false, reason: 'An update is already running.' };
    }
    running = true;

    try {
        let remote = '';
        try {
            remote = (await fetchText(`${VERSION_URL}?t=${Date.now()}`, META_TIMEOUT_MS)).trim();
        } catch (err) {
            const message = describeFailure(err);
            if (installedGame()) {
                // Offline launch: the cached copy is perfectly playable.
                console.warn(`[game] could not check for a new build (${message}); using the installed copy.`);
                send(win, { phase: 'done', message: `Could not check for a new build (${message}).` });
                return { updated: false, version: installedVersion() };
            }
            throw new Error(`could not reach datastore (${message})`);
        }

        const current = installedVersion();
        if (!force && remote && remote === current && installedGame()) {
            console.log(`[game] up to date (${current})`);
            send(win, { phase: 'done', message: `Breakmine ${current} is already up to date.` });
            return { updated: false, version: current };
        }

        send(win, {
            phase: 'downloading',
            message: remote ? `Downloading Breakmine ${remote}...` : 'Downloading the game...'
        });

        const bytes = await downloadGame({ window: win });

        if (remote) {
            fs.mkdirSync(GAME_DIR, { recursive: true });
            fs.writeFileSync(VERSION_FILE, `${remote}\n`);
        }

        const label = remote ? ` Breakmine ${remote}` : ' the game';
        console.log(`[game] downloaded${label} (${megabytes(bytes)}) into ${GAME_FILE}`);
        send(win, { phase: 'done', message: `Downloaded${label} (${megabytes(bytes)}).` });

        return { updated: true, version: remote, bytes };
    } catch (err) {
        const message = describeFailure(err);
        console.error('[game] update failed:', message);
        send(win, { phase: 'error', message });
        return { updated: false, error: message };
    } finally {
        running = false;
    }
}

/**
 * The `game:selfUpdate` handler behind the in-game update screen.
 *
 * Same download as the launch-time refresh, just user initiated. The caller is
 * responsible for reloading the window once `updated` comes back true.
 */
async function runSelfUpdate({ window: win } = {}) {
    const result = await updateGame({ window: win });

    if (result.updated) return { started: true, updated: true, version: result.version };
    if (result.reason) return { started: false, reason: result.reason };
    if (result.error) return { started: false, reason: result.error };
    return { started: true, updated: false, version: result.version };
}

module.exports = {
    GAME_URL,
    VERSION_URL,
    GAME_FILE,
    BUNDLED_GAME,
    gameStartPage,
    installedVersion,
    updateGame,
    runSelfUpdate
};
