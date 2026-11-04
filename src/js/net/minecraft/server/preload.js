const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron preload script for the Breakmine mods bridge.
 *
 * Exposes a `window.modsBridge` API that the sandboxed renderer can use to
 * read/write the physical `mods/` folder at the project root. Every method
 * delegates to an IPC handler in the main process (`main.js`).
 *
 * The bridge mirrors the layout translation of NodeFilesystem:
 *   - ModData.js on disk → ModData.json (parsed) in the virtual layout
 *   - .png / .ogg → .png.b64 / .ogg.b64 in the virtual layout
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
   * List all files in a directory (virtual layout).
   * @param {string} dir  e.g. 'mods/' or 'mods/cooldeco/'
   * @returns {Promise<string[]>}
   */
  listDir: (dir) => ipcRenderer.invoke('mods:listDir', dir),

  /**
   * Check if a file exists in the virtual filesystem.
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

  /**
   * Get the JSZip library from the main process (already a dependency).
   * @returns {Promise<object>}
   */
  getJSZip: () => ipcRenderer.invoke('mods:getJSZip'),
});
