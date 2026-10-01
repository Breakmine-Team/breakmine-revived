/**
 * BridgeFilesystem — reads mods straight from the physical `mods/` folder.
 *
 * In the Electron build the renderer is sandboxed, so the `mods/` folder on
 * disk is reached through the preload `modsBridge` (see server/preload.js and
 * the `mods:*` IPC handlers in server/main.js). This class adapts that bridge
 * to the small read-only contract the mod loading pipeline expects from a
 * filesystem — the same one MemoryFilesystem provides for dev mods:
 *
 *   loadFile(path)        → Promise<string|null>
 *   loadBinaryFile(path)  → Promise<Uint8Array|null>
 *   listDir(dir)          → Promise<string[]>
 *
 * Two layouts are involved. On disk a mod is an ordinary folder using the
 * names its author sees; the mod loader instead works in the virtual layout
 * produced by ZIP installation (ModData.json, textures stored as .png.b64).
 * This class translates between them so `_loadMod()` needs no changes:
 *
 *   on disk                          virtual
 *   ------------------------------   ---------------------------
 *   ModData.js                       ModData.json   (parsed to JSON)
 *   textures/foo.png                 textures/foo.png.b64
 *   gui_textures/foo.png             gui_textures/foo.png.b64
 *   sounds/foo.ogg                   sounds/foo.ogg.b64
 *   blocks/BlockFoo.js               blocks/BlockFoo.js
 *
 * Binary files are handed over as raw bytes rather than base64: the virtual
 * `.b64` suffix is only a naming convention of the IndexedDB store, and the
 * consumers (loadModTexture, Sound) just need the decoded file contents.
 *
 * Mods are loaded read-only. Writing into `mods/` is the user's job; this
 * deliberately implements no save/delete methods so nothing can mutate the
 * folder from inside the game.
 */

/**
 * Translate one path relative to the mods folder into its virtual form.
 * @param {string} relPath e.g. 'my_mod/textures/foo.png'
 * @returns {{ path: string, kind: 'text'|'binary'|'json'|'moddata' }}
 */
function toVirtualEntry(relPath) {
    const normalized = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalized.split('/');
    const filename = segments[segments.length - 1];

    // ModData.js at the mod root is a class with static fields; it stands in
    // for the ModData.json that ZIP installation writes.
    if (filename === 'ModData.js' && segments.length === 2) {
        return { path: 'mods/' + segments[0] + '/ModData.json', kind: 'moddata' };
    }
    if (filename === 'ModData.json' && segments.length === 2) {
        return { path: 'mods/' + segments[0] + '/ModData.json', kind: 'json' };
    }

    // Textures and sounds keep their virtual .b64 name so the existing
    // discovery filters in _loadMod() match them unchanged.
    if (/\.(png|ogg)$/i.test(filename)) {
        const dir = segments.slice(0, -1).join('/');
        return {
            path: `mods/${dir}/${filename}.b64`,
            kind: 'binary'
        };
    }

    return { path: `mods/${normalized}`, kind: 'text' };
}

export class BridgeFilesystem {
    /**
     * Marker file the wiki installer drops in a folder it created. Kept in
     * sync with INSTALL_MARKER in server/deeplink.js.
     */
    static INSTALL_MARKER = '.from-wiki';

    #bridge;
    #parseModDataSource;
    // virtual path → { rel, kind }
    #index = null;
    #indexPromise = null;

    /**
     * @param {object} options
     * @param {object} options.bridge  window.modsBridge
     * @param {(source: string) => object} [options.modDataParser]
     *        Turns ModData.js source into { NAME, ID, AUTHOR, VERSION }.
     *        Injected by ModLoader so the parsing rules live in one place.
     */
    constructor({ bridge, modDataParser = null } = {}) {
        this.#bridge = bridge;
        this.#parseModDataSource = modDataParser;
    }

    static isAvailable() {
        return typeof window !== 'undefined' && !!window.modsBridge;
    }

    /**
     * Build (or reuse) the virtual index from a single recursive scan of the
     * mods folder. Scanning once keeps the per-file reads during mod loading
     * local instead of an IPC round-trip each.
     */
    async #ensureIndex() {
        if (this.#index) return this.#index;
        if (this.#indexPromise) return this.#indexPromise;

        this.#indexPromise = (async () => {
            const relPaths = await this.#bridge.listDir('') || [];
            const index = new Map();
            for (const rel of relPaths) {
                const entry = toVirtualEntry(rel);
                // A physical ModData.json is explicit metadata, so let it win
                // over a ModData.js that maps onto the same virtual path.
                if (index.has(entry.path) && entry.kind !== 'json') continue;
                index.set(entry.path, { rel: String(rel).replace(/\\/g, '/'), kind: entry.kind });
            }
            this.#index = index;
            return index;
        })();

        return this.#indexPromise;
    }

    /**
     * Drop the cached index so the next access re-scans the folder. Call this
     * after files are added to or removed from `mods/` while the game runs.
     */
    async refresh() {
        this.#index = null;
        this.#indexPromise = null;
        return this.#ensureIndex();
    }

    /**
     * IDs of every mod folder that carries metadata.
     * @returns {Promise<string[]>}
     */
    async getModIds() {
        const index = await this.#ensureIndex();
        const ids = new Set();
        for (const [virtualPath, entry] of index) {
            if (entry.kind === 'json' || entry.kind === 'moddata') {
                ids.add(virtualPath.slice('mods/'.length).split('/')[0]);
            }
        }
        return [...ids];
    }

    /**
     * True when the mod folder was created by the wiki installer rather than
     * written by hand. ModLoader uses this to enable freshly installed mods
     * without silently re-enabling hand-made ones the user turned off.
     * @param {string} modId
     * @returns {Promise<boolean>}
     */
    async isWikiInstalled(modId) {
        const index = await this.#ensureIndex();
        return index.has(`mods/${modId}/${BridgeFilesystem.INSTALL_MARKER}`);
    }

    async loadFile(filename) {
        const index = await this.#ensureIndex();
        const entry = index.get(filename);
        if (!entry) return null;

        if (entry.kind === 'json') {
            return this.#bridge.loadFile(entry.rel);
        }

        if (entry.kind === 'moddata') {
            const source = await this.#bridge.loadFile(entry.rel);
            if (source === null) return null;
            if (typeof this.#parseModDataSource !== 'function') {
                throw new Error(
                    `Cannot read '${entry.rel}': no ModData parser was provided.`
                );
            }
            return JSON.stringify(this.#parseModDataSource(source));
        }

        if (entry.kind === 'binary') return null;
        return this.#bridge.loadFile(entry.rel);
    }

    async loadBinaryFile(filename) {
        const index = await this.#ensureIndex();
        const entry = index.get(filename);
        if (!entry || entry.kind !== 'binary') return null;
        return this.#bridge.loadBinaryFile(entry.rel);
    }

    async listDir(dir = '') {
        const index = await this.#ensureIndex();
        let prefix = String(dir).trim();
        if (prefix.length > 0 && !prefix.endsWith('/')) prefix += '/';

        const result = [];
        for (const virtualPath of index.keys()) {
            if (virtualPath.startsWith(prefix)) result.push(virtualPath);
        }
        return result;
    }
}

export default BridgeFilesystem;