const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const RPC = require('discord-rpc'); // [1] Moved up for clarity
const { registerDeepLinks } = require('./deeplink.js');
const { runSelfUpdate } = require('./updater.js');

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
app.commandLine.appendSwitch('disable-pointer-lock-options');

/* ------------------------------------------------------------------ *
 *  Mods bridge — physical `mods/` folder access for the renderer
 *
 *  Mods can live as plain folders in `mods/` next to the game instead of
 *  only as .zip files uploaded into IndexedDB. The renderer is sandboxed
 *  (contextIsolation: true, nodeIntegration: false) so it reaches these
 *  files through the preload `modsBridge` -> these handlers.
 *
 *  Every handler takes a path relative to the `mods/` folder and refuses
 *  anything that escapes it, so a mod (or the renderer) cannot read or
 *  write arbitrary files on disk.
 * ------------------------------------------------------------------ */

// Root of the physical mods folder.
//
// In development that is the project root, so `mods/` sits next to index.html.
// A packaged build cannot use the same place: an AppImage is a read-only
// squashfs mounted under /tmp/.mount_*, and an installed Windows app lives in
// Program Files — neither is writable, and AppImage contents vanish on exit.
// Packaged builds therefore keep mods/ under the per-user data directory,
// which survives updates and uninstalling without needing write access to the
// install location.
const MODS_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'mods')
  : path.join(app.getAppPath(), 'mods');

function ensureModsDir() {
    try {
        fs.mkdirSync(MODS_DIR, { recursive: true });
    } catch (err) {
        console.error('[mods] Could not create mods directory:', err.message);
    }
}

/**
 * Resolve a renderer-supplied path to an absolute path inside MODS_DIR.
 * Throws on traversal attempts, NUL bytes, absolute paths and anything
 * that does not live under the mods root.
 */
function resolveModPath(relPath) {
    if (typeof relPath !== 'string' || relPath.length === 0) {
        throw new Error('Invalid path');
    }
    if (relPath.includes('\0')) {
        throw new Error('Invalid path');
    }

    // Normalise separators and strip './' or leading slashes so that
    // 'mods/a/b', '/mods/a/b' and './mods/a/b' all mean the same thing.
    let normalized = relPath.replace(/\\/g, '/').replace(/^\.?\//, '');

    // Collapse '.' segments and reject '..' outright rather than trying to
    // resolve them — a mods file never legitimately needs to go up.
    const segments = normalized.split('/').filter((s) => s !== '' && s !== '.');
    if (segments.some((s) => s === '..')) {
        throw new Error('Path traversal is not allowed');
    }

    // The renderer addresses files by their virtual path, which is rooted
    // at 'mods/' (e.g. 'mods/my_mod/ModData.json'). MODS_DIR already *is*
    // that folder, so drop the leading segment when present. Accepting a
    // bare 'my_mod/...' too keeps the handler usable on its own.
    if (segments[0] === 'mods') {
        segments.shift();
    }

    const abs = path.resolve(MODS_DIR, ...segments);
    const rootWithSep = MODS_DIR.endsWith(path.sep) ? MODS_DIR : MODS_DIR + path.sep;
    if (abs !== MODS_DIR && !abs.startsWith(rootWithSep)) {
        throw new Error('Path escapes the mods directory');
    }
    return abs;
}

/**
 * Recursively list every file under the mods folder as a POSIX-style path
 * relative to it (e.g. 'my_mod/blocks/BlockFoo.js').
 */
function listModFiles(dirAbs = MODS_DIR, prefix = '') {
    let entries;
    try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
        return [];
    }

    const out = [];
    for (const entry of entries) {
        // Skip symlinks and anything that would leave the mods root, so a
        // link planted in mods/ cannot be used to read the rest of the disk.
        if (entry.isSymbolicLink()) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...listModFiles(path.join(dirAbs, entry.name), rel));
        } else if (entry.isFile()) {
            out.push(rel);
        }
    }
    return out;
}

function toBase64(data) {
    if (typeof data === 'string') return data;
    return Buffer.from(data).toString('base64');
}

function fromBase64(text) {
    return Buffer.from(text, 'base64');
}

function registerModHandlers() {
    ensureModsDir();

    // Read a file as UTF-8 text. Missing files resolve to null so callers
    // can treat "not there" the same way the IndexedDB filesystem does.
    ipcMain.handle('mods:loadFile', (_event, filename) => {
        try {
            return fs.readFileSync(resolveModPath(filename), 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
            throw err;
        }
    });

    // Read a file as raw bytes. The renderer wraps the result in a
    // Uint8Array; PNG/OGG payloads go over IPC untouched rather than
    // being base64-encoded first.
    ipcMain.handle('mods:loadBinaryFile', (_event, filename) => {
        try {
            const buf = fs.readFileSync(resolveModPath(filename));
            return new Uint8Array(buf);
        } catch (err) {
            if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
            throw err;
        }
    });

    ipcMain.handle('mods:saveFile', (_event, text, filename) => {
        const abs = resolveModPath(filename);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(text), 'utf8');
    });

    ipcMain.handle('mods:saveBinaryFile', (_event, data, filename) => {
        const abs = resolveModPath(filename);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, fromBase64(toBase64(data)));
    });

    ipcMain.handle('mods:deleteFile', (_event, filename) => {
        try {
            fs.unlinkSync(resolveModPath(filename));
        } catch (err) {
            if (err.code === 'ENOENT') return;
            throw err;
        }
    });

    // Recursive listing of everything under the mods folder. The renderer
    // translates these into its own virtual layout.
    ipcMain.handle('mods:listDir', (_event, dir) => {
        const abs = resolveModPath(dir || '');
        const rel = path.relative(MODS_DIR, abs).split(path.sep).join('/');
        const files = listModFiles(abs);
        if (rel === '' || rel === '.') return files;
        return files.map((f) => `${rel}/${f}`);
    });

    ipcMain.handle('mods:fileExists', (_event, filename) => {
        try {
            return fs.existsSync(resolveModPath(filename));
        } catch {
            return false;
        }
    });

    // Re-downloads, rebuilds and reinstalls the game, then quits. Only the
    // main process can do this: it needs to spawn the installer and replace
    // the files the renderer is running from.
    ipcMain.handle('game:selfUpdate', async (event, options) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const requested = options && typeof options.ref === 'string' ? options.ref.trim() : '';
        // Only accept a plain ref; this string ends up in a shell-free argv
        // (no shell is involved) but still should not be arbitrary junk.
        const ref = /^[A-Za-z0-9._/-]{1,120}$/.test(requested) ? requested : 'main';
        return runSelfUpdate({ window: win, ref });
    });

    ipcMain.handle('mods:getFileSize', (_event, filename) => {
        try {
            return fs.statSync(resolveModPath(filename)).size;
        } catch {
            return null;
        }
    });
}

function createWindow() {
  const iconFileName = process.platform === 'linux' ? 'favicon.png' : 'favicon.png';
  const iconPath = path.join(__dirname, '..', '..', '..', '..', '..', 'src/resources', iconFileName);

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F12') {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
      if (input.key === 'F11') {
        win.setFullScreen(!win.isFullScreen());
        event.preventDefault();
      }
      if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
        if (input.shift) {
          win.webContents.reloadIgnoringCache();
        } else {
          win.webContents.reload();
        }
        event.preventDefault();
      }
    }
  });

  win.setMenu(null);

  if (isDev) {
    win.loadURL('http://localhost:8000');
  } else {
    win.loadFile(path.join(__dirname, '..', '..', '..', '..', '..', 'dist/index.html'));
  }
}

// Initialize RPC client
const rpc = new RPC.Client({ transport: 'ipc' });

rpc.on('ready', () => {
  console.log("Discord RPC Connected Successfully!");
  rpc.setActivity({
    details: 'Playing Breakmine',
    state: 'Join at breakmine.com!', // [2] Changed from empty string '' (Discord often rejects empty strings)
    startTimestamp: new Date(),
    largeImageKey: 'favicon',
    instance: false,
  });
});

// A breakmine-game:// link is delivered to whichever process registered as
// the protocol handler. Without a single-instance lock a link would start a
// second copy of the whole game instead of reaching the one already running.
const gotInstanceLock = app.requestSingleInstanceLock();

if (!gotInstanceLock) {
  app.quit();
} else {
  let deeplinks = null;
  let deferredInstanceArgv = null;

  // Another launch (i.e. a deep link click) hands us its argv and we forward
  // the link to the running instance.
  app.on('second-instance', (_event, argv) => {
    if (deeplinks) {
      deeplinks.handleSecondInstance(argv);
    } else {
      // Arrived before whenReady — replay it once the handler exists.
      deferredInstanceArgv = argv;
    }
  });

  app.whenReady().then(() => {
    createWindow();
    registerModHandlers();
    deeplinks = registerDeepLinks({
      modsDir: MODS_DIR,
      getWindow: () => BrowserWindow.getAllWindows()[0] || null
    });

    if (deferredInstanceArgv) {
      const argv = deferredInstanceArgv;
      deferredInstanceArgv = null;
      deeplinks.handleSecondInstance(argv);
    }

    // [3] Log in to Discord right as Electron finishes readying up
    rpc.login({ clientId: '1532728832660996116' }).catch((err) => {
      console.error("Discord RPC failed to connect:", err);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // [4] Clean up Discord connection on close
    rpc.destroy().catch(() => {});
    if (process.platform !== 'darwin') app.quit();
  });
}
