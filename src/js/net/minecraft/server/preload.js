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
   * False when running from a dev checkout, true inside a packaged AppImage /
   * NSIS install. The renderer needs this to know that reloading the window
   * re-runs the frozen bundle instead of picking up an update.
   */
  isPackaged: !process.defaultApp,

  /**
   * Re-download, rebuild and reinstall the game, then quit.
   *
   * A packaged install cannot update itself by reloading, because the game
   * files are frozen inside the installed app. This hands the job to the
   * repo's own installer, which is the only updater available while the
   * project publishes no release artifacts.
   *
   * @param {{ref?: string}} [options]
   * @returns {Promise<{started: boolean, reason?: string}>}
   */
  selfUpdate: (options) => ipcRenderer.invoke('game:selfUpdate', options || {}),

  /**
   * Progress from the running installer: { phase, message }.
   * @param {(status: {phase: string, message: string}) => void} callback
   * @returns {() => void} unsubscribe
   */
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('game:updateStatus', listener);
    return () => ipcRenderer.removeListener('game:updateStatus', listener);
  },

  /**
   * Read a text file from the virtual filesystem.
   * @param {string} filename  e.g. 'mods/cooldeco/ModData.json'
   * @returns {Promise<string|null>}
   */
  loadFile: (filename) => ipcRenderer.invoke('mods:loadFile', filename),

  /**
   * Report game state to the main process for the Discord Rich Presence.
   *
   * The renderer has to push this: the window is context-isolated, so this
   * preload cannot read `window.GAMESTATE` or `window.app` itself. Minecraft's
   * updateGameState() calls this whenever the state actually changes.
   *
   * @param {{state: string, singleplayer: boolean, username: string, world: string|null}} state
   */
  reportGameState: (state) => ipcRenderer.send('discord:gameState', state),

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

  /**
   * Open the mods folder in the system file explorer.
   * @returns {Promise<void>}
   */
  openFolder: () => ipcRenderer.invoke('mods:openFolder'),
});