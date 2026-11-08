const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const RPC = require('discord-rpc');
const { registerDeepLinks } = require('./deeplink.js');
const { runSelfUpdate } = require('./updater.js');

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
app.commandLine.appendSwitch('disable-pointer-lock-options');











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

function resolveModPath(relPath) {
    if (typeof relPath !== 'string') {
        throw new Error('Invalid path');
    }
    if (relPath.includes('\0')) {
        throw new Error('Invalid path');
    }

    let normalized = relPath.replace(/\\/g, '/').replace(/^\.?\//, '');

    const segments = normalized.split('/').filter((s) => s !== '' && s !== '.');
    if (segments.some((s) => s === '..')) {
        throw new Error('Path traversal is not allowed');
    }

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

function listModFiles(dirAbs = MODS_DIR, prefix = '') {
    let entries;
    try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
        return [];
    }

    const out = [];
    for (const entry of entries) {
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


let cachedGameState = { state: 'menu', singleplayer: false, username: '', world: null };

function registerModHandlers() {
    ensureModsDir();

    ipcMain.handle('mods:loadFile', (_event, filename) => {
        try {
            return fs.readFileSync(resolveModPath(filename), 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
            throw err;
        }
    });

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

    ipcMain.handle('game:selfUpdate', async (event, options) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const requested = options && typeof options.ref === 'string' ? options.ref.trim() : '';
        const ref = /^[A-Za-z0-9._/-]{1,120}$/.test(requested) ? requested : 'main';
        return runSelfUpdate({ window: win, ref });
    });

    ipcMain.handle('mods:getFileSize', (_event, filename) => {
        try {
            const stats = fs.statSync(resolveModPath(filename));
            return stats.size;
        } catch (err) {
            if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
            throw err;
        }
    });

    ipcMain.handle('mods:openFolder', () => {
        const { shell } = require('electron');
        shell.openPath(MODS_DIR);
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


const rpc = new RPC.Client({ transport: 'ipc' });



function text(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}




let presenceStartedAt = Date.now();
let lastPresenceKey = null;
let lastWorld = null;

function describeGameState(gs) {
  const inGame = gs.state === 'ingame' || gs.state === 'paused' || gs.state === 'gui';
  const session = gs.singleplayer ? 'Singleplayer' : 'Multiplayer';

  if (!inGame) {
    if (gs.state === 'loading') {
      return { details: 'Loading world', state: undefined, buttons: [] };
    }
    return { details: 'Main Menu', state: undefined, buttons: [] };
  }

  return {
    details: gs.paused ? `Paused - ${session}` : session,
    state: text(gs.username) ? `Playing as ${gs.username}` : undefined,
    buttons: gs.singleplayer ? [] : [{ label: 'Join Server', url: 'https://breakmine.com' }]
  };
}

function updateDiscordRPC(gs) {
  const presence = describeGameState(gs);
  const key = JSON.stringify(presence);

  if (key === lastPresenceKey) return;
  lastPresenceKey = key;

  rpc.setActivity({
    details: presence.details,
    state: presence.state,
    startTimestamp: presenceStartedAt,
    largeImageKey: 'favicon',
    largeImageText: 'Breakmine',
    buttons: presence.buttons.length > 0 ? presence.buttons : undefined
  });
}

rpc.on('ready', () => {
  console.log('Discord RPC Connected Successfully!');
  lastPresenceKey = null;
  updateDiscordRPC(cachedGameState);
});

rpc.on('error', (err) => {
  console.error('Discord RPC error:', err);
});


ipcMain.on('discord:gameState', (_event, data) => {
  if (!data || typeof data.state !== 'string') return;

  cachedGameState = {
    state: data.state,
    singleplayer: data.singleplayer === true,
    username: typeof data.username === 'string' ? data.username : '',
    world: typeof data.world === 'string' ? data.world : null,
    paused: data.paused === true
  };

  if (cachedGameState.world !== lastWorld) {
    lastWorld = cachedGameState.world;
    presenceStartedAt = Date.now();
    lastPresenceKey = null;
  }

  updateDiscordRPC(cachedGameState);
});




const gotInstanceLock = app.requestSingleInstanceLock();

if (!gotInstanceLock) {
  app.quit();
} else {
  let deeplinks = null;
  let deferredInstanceArgv = null;

  app.on('second-instance', (_event, argv) => {
    if (deeplinks) {
      deeplinks.handleSecondInstance(argv);
    } else {
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

    rpc.login({ clientId: '1532728832660996116' }).catch((err) => {
      console.error("Discord RPC failed to connect:", err);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    rpc.destroy().catch(() => {});
    if (process.platform !== 'darwin') app.quit();
  });
}
