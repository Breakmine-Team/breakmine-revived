const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app } = require('electron');

/* ------------------------------------------------------------------ *
 *  Self-update
 *
 *  A packaged install cannot pick up a new version by reloading: the game
 *  files live inside the AppImage / install directory, so `location.reload()`
 *  just re-runs the frozen bundle that is already there.
 *
 *  There is nothing to download either — this repo publishes no release
 *  assets. So the update is done the only way that actually works: run the
 *  repository's own installer, which re-downloads the source, rebuilds and
 *  reinstalls, then quit once it finishes.
 *
 *  The installer is fetched fresh rather than shipped inside the app, so a
 *  build made before a fix still gets the fixed installer.
 * ------------------------------------------------------------------ */

const REPO = 'Breakmine-Team/breakmine-revived';
const RAW = `https://raw.githubusercontent.com/${REPO}`;

const INSTALLER_FILES = {
    linux: 'scripts/install.sh',
    win32: 'scripts/install.ps1'
};

const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60000;

// One update at a time; a second click while one is running is a no-op.
let running = false;

/** Download one of the installer scripts to a temp dir. */
async function fetchInstaller(ref) {
    const rel = INSTALLER_FILES[process.platform];
    if (!rel) {
        throw new Error(`Self-update is not supported on ${process.platform}.`);
    }

    const url = `${RAW}/${ref}/${rel}?t=${Date.now()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let text;
    try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        text = await response.text();
    } finally {
        clearTimeout(timer);
    }

    if (text.length > MAX_SCRIPT_BYTES) {
        throw new Error('Installer script is implausibly large; refusing to run it.');
    }
    // A proxy or captive portal answering with HTML is the realistic failure
    // here, so check we got a shell script rather than discovering it later
    // with a confusing syntax error.
    if (!/^#!.*\b(bash|sh)\b/m.test(text) && !/\bparam\s*\(/i.test(text)) {
        throw new Error('Downloaded installer did not look like a script.');
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'breakmine-update-'));
    const file = path.join(dir, path.basename(rel));
    fs.writeFileSync(file, text, { mode: 0o755 });
    return file;
}

/**
 * Build the command that runs the installer.
 *
 * `--yes` is not optional: the installer prompts by reading /dev/tty (or
 * Read-Host), and a process spawned by the app has no console. Without it the
 * prompt fails closed and the installer exits without doing anything, which
 * looks exactly like a successful update.
 */
function buildCommand(installerPath, ref) {
    if (process.platform === 'win32') {
        // NSIS cannot overwrite the .exe that is currently running, so the
        // installer has to wait for this process to exit first — otherwise the
        // update fails with a sharing violation the moment it is applied.
        // PowerShell single-quoted strings are literal, so only a literal
        // quote needs escaping.
        const ps = (value) => `'${String(value).replace(/'/g, "''")}'`;
        return {
            file: 'powershell.exe',
            args: [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command',
                `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue; `
                + `& ${ps(installerPath)} -Ref ${ps(ref)} -Force -Yes`
            ]
        };
    }
    return {
        file: '/bin/bash',
        args: [installerPath, '--ref', ref, '--force', '--yes']
    };
}

function send(win, status) {
    if (win && !win.isDestroyed()) {
        win.webContents.send('game:updateStatus', status);
    }
}

/**
 * Re-download, rebuild and reinstall the game, then quit.
 *
 * @param {object} opts
 * @param {Electron.BrowserWindow|null} opts.window
 * @param {string} [opts.ref]  branch/tag/commit to install
 * @returns {Promise<{started: boolean, reason?: string}>}
 */
async function runSelfUpdate({ window: win, ref = 'main' } = {}) {
    if (running) {
        return { started: false, reason: 'An update is already running.' };
    }
    running = true;

    try {
        send(win, { phase: 'downloading', message: 'Downloading the installer...' });

        const installerPath = await fetchInstaller(ref);
        const { file, args } = buildCommand(installerPath, ref);

        console.log(`[update] running: ${file} ${args.join(' ')}`);

        const child = spawn(file, args, {
            // Detached on every platform: on Windows the app quits while the
            // installer is still going, and a non-detached child would be torn
            // down with us.
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Surface the installer's own progress in the update screen.
        const relay = (stream) => {
            stream.setEncoding('utf8');
            stream.on('data', (chunk) => {
                for (const line of chunk.split('\n')) {
                    const text = line.trim();
                    if (text) send(win, { phase: 'running', message: text });
                }
            });
        };
        relay(child.stdout);
        relay(child.stderr);

        // Windows cannot replace a running .exe, so the installer has to wait
        // for this process to exit first. Everywhere else the AppImage mount
        // stays valid while it is being replaced, and quitting afterwards
        // leaves the user with the freshly installed build already in place.
        if (process.platform === 'win32') {
            child.on('error', (err) => {
                running = false;
                console.error('[update] failed to start:', err);
                send(win, { phase: 'error', message: err.message });
            });
            send(win, { phase: 'quitting', message: 'Closing Breakmine to install...' });
            // Give the child a moment to attach before the window goes away.
            setTimeout(() => app.quit(), 750);
            return { started: true };
        }

        child.on('error', (err) => {
            running = false;
            console.error('[update] failed to start:', err);
            send(win, { phase: 'error', message: err.message });
        });

        child.on('exit', (code, signal) => {
            running = false;
            // The installer wipes its own temp dir, so clean up if it died early.
            try {
                fs.rmSync(path.dirname(installerPath), { recursive: true, force: true });
            } catch { /* nothing useful to do */ }

            if (code === 0) {
                console.log('[update] install finished; quitting.');
                send(win, { phase: 'done', message: 'Update installed. Closing...' });
                setTimeout(() => app.quit(), 1200);
            } else {
                const how = signal ? `signal ${signal}` : `exit code ${code}`;
                console.error(`[update] installer failed (${how})`);
                send(win, {
                    phase: 'error',
                    message: `The installer failed (${how}). Try running scripts/install.sh manually.`
                });
            }
        });

        return { started: true };
    } catch (err) {
        running = false;
        console.error('[update] self-update failed:', err);
        send(win, { phase: 'error', message: err.message });
        return { started: false, reason: err.message };
    }
}

module.exports = { runSelfUpdate, REPO };