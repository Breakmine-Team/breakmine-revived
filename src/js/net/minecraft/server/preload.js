const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('modsBridge', {
  
  isPackaged: !process.defaultApp,

  
  selfUpdate: (options) => ipcRenderer.invoke('game:selfUpdate', options || {}),

  
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('game:updateStatus', listener);
    return () => ipcRenderer.removeListener('game:updateStatus', listener);
  },

  
  loadFile: (filename) => ipcRenderer.invoke('mods:loadFile', filename),

  
  reportGameState: (state) => ipcRenderer.send('discord:gameState', state),

  
  loadBinaryFile: (filename) => ipcRenderer.invoke('mods:loadBinaryFile', filename).then(b => b ? new Uint8Array(b) : null),

  
  saveFile: (text, filename) => ipcRenderer.invoke('mods:saveFile', text, filename),

  
  saveBinaryFile: (data, filename) => ipcRenderer.invoke('mods:saveBinaryFile', data, filename),

  
  deleteFile: (filename) => ipcRenderer.invoke('mods:deleteFile', filename),

  
  listDir: (dir) => ipcRenderer.invoke('mods:listDir', dir),

  
  fileExists: (filename) => ipcRenderer.invoke('mods:fileExists', filename),

  
  getFileSize: (filename) => ipcRenderer.invoke('mods:getFileSize', filename),

  
  openFolder: () => ipcRenderer.invoke('mods:openFolder'),
});