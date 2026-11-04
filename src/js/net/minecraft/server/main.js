const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const RPC = require('discord-rpc'); // [1] Moved up for clarity

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
app.commandLine.appendSwitch('disable-pointer-lock-options');

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

app.whenReady().then(() => {
  createWindow();

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
