const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron preload script for the Breakmine mods bridge.
 *
 * Exposes a `window.modsBridge` API that the sandboxed renderer can use to
 * read/write the physical `mods/` folder at the project root. Every method
 * delegates to an IPC handler in the main process (`main.js`).
 *
 * The bridge is backed by the physical `mods/` folder at the app root. The
 * renderer is responsible for translating between that on-disk layout and the
 * virtual layout the mod loader expects; see `fs/BridgeFilesystem.js`.
 */
contextBridge.exposeInMainWorld('modsBridge', {
  /**
   * Read a text file from the virtual filesystem.
   * @param {string} filename  e.g. 'mods/cooldeco/ModData.json'
   * @returns {Promise<string|null>}
   */
  loadFile: (filename) => ipcRenderer.invoke('mods:loadFile', filename),

  /**
   * Read a binary file from the virtual filesystem.
   * @param {string} filename  e.g. 'mods/cooldeco/textures/checker.png.b64'
   * @returns {Promise<Uint8Array|null>}
   */
  loadBinaryFile: (filename) => ipcRenderer.invoke('mods:loadBinaryFile', filename).then(b => b ? new Uint8Array(b) : null),

  /**
   * Write a text file to the virtual filesystem.
   * @param {string} text
   * @param {string} filename
   */
  saveFile: (text, filename) => ipcRenderer.invoke('mods:saveFile', text, filename),

  /**
   * Write a binary file to the virtual filesystem.
   * @param {Uint8Array|string} data  — raw bytes or base64 string
   * @param {string} filename
   */
  saveBinaryFile: (data, filename) => ipcRenderer.invoke('mods:saveBinaryFile', data, filename),

  /**
   * Delete a file from the virtual filesystem.
   * @param {string} filename
   */
  deleteFile: (filename) => ipcRenderer.invoke('mods:deleteFile', filename),

  /**
   * Recursively list every file under a directory.
   * @param {string} dir  e.g. '' (the whole mods folder) or 'mods/'
   * @returns {Promise<string[]>} paths relative to the mods folder,
   *                             e.g. ['cooldeco/ModData.js', 'cooldeco/blocks/BlockFoo.js']
   */
  listDir: (dir) => ipcRenderer.invoke('mods:listDir', dir),

  /**
   * Check if a file exists.
   * @param {string} filename
   * @returns {Promise<boolean>}
   */
  fileExists: (filename) => ipcRenderer.invoke('mods:fileExists', filename),

  /**
   * Get the size of a file in bytes.
   * @param {string} filename
   * @returns {Promise<number|null>}
   */
  getFileSize: (filename) => ipcRenderer.invoke('mods:getFileSize', filename),
});
