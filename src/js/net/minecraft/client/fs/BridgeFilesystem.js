

function toVirtualEntry(relPath) {
    const normalized = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalized.split('/');
    const filename = segments[segments.length - 1];

    if (filename === 'ModData.js' && segments.length === 2) {
        return { path: 'mods/' + segments[0] + '/ModData.json', kind: 'moddata' };
    }
    if (filename === 'ModData.json' && segments.length === 2) {
        return { path: 'mods/' + segments[0] + '/ModData.json', kind: 'json' };
    }

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
    
    static INSTALL_MARKER = '.from-wiki';

    #bridge;
    #parseModDataSource;
    #index = null;
    #indexPromise = null;

    
    constructor({ bridge, modDataParser = null } = {}) {
        this.#bridge = bridge;
        this.#parseModDataSource = modDataParser;
    }

    static isAvailable() {
        return typeof window !== 'undefined' && !!window.modsBridge;
    }

    
    async #ensureIndex() {
        if (this.#index) return this.#index;
        if (this.#indexPromise) return this.#indexPromise;

        this.#indexPromise = (async () => {
            const relPaths = await this.#bridge.listDir('') || [];
            const index = new Map();
            for (const rel of relPaths) {
                const entry = toVirtualEntry(rel);
                if (index.has(entry.path) && entry.kind !== 'json') continue;
                index.set(entry.path, { rel: String(rel).replace(/\\/g, '/'), kind: entry.kind });
            }
            this.#index = index;
            return index;
        })();

        return this.#indexPromise;
    }

    
    async refresh() {
        this.#index = null;
        this.#indexPromise = null;
        return this.#ensureIndex();
    }

    
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