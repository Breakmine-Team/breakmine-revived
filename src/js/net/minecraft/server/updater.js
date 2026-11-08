const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app } = require('electron');


const REPO = 'Breakmine-Team/breakmine-revived';
const RAW = `https://raw.githubusercontent.com/${REPO}`;

const INSTALLER_FILES = {
    linux: 'scripts/install.sh',
    win32: 'scripts/install.ps1'
};

const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60000;


let running = false;

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
    if (!/^#!.*\b(bash|sh)\b/m.test(text) && !/\bparam\s*\(/i.test(text)) {
        throw new Error('Downloaded installer did not look like a script.');
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'breakmine-update-'));
    const file = path.join(dir, path.basename(rel));
    fs.writeFileSync(file, text, { mode: 0o755 });
    return file;
}

function buildCommand(installerPath, ref) {
    if (process.platform === 'win32') {
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
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

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

        if (process.platform === 'win32') {
            child.on('error', (err) => {
                running = false;
                console.error('[update] failed to start:', err);
                send(win, { phase: 'error', message: err.message });
            });
            send(win, { phase: 'quitting', message: 'Closing Breakmine to install...' });
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
            try {
                fs.rmSync(path.dirname(installerPath), { recursive: true, force: true });
            } catch {  }

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