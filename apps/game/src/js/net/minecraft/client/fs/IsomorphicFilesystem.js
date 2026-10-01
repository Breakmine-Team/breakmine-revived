import { Buffer } from '../../../../../../libraries/buffer.js';
import BrowserFS from './Filesystem.js';
import { inflate } from '../../lib/pako.js';

// Node.js detection that stays false inside a Web Worker even if the bundle
// polyfills a global `process` (real Node always exposes process.versions.node).
const isNode =
    typeof process !== 'undefined' &&
    !!process.versions &&
    !!process.versions.node;

let nodeFs = null;
let nodeFsSync = null;
let nodePath = null;
if (isNode) {
    try {
        if (typeof process.getBuiltinModule === 'function') {
            nodeFs = process.getBuiltinModule('node:fs/promises');
            nodeFsSync = process.getBuiltinModule('node:fs');
            nodePath = process.getBuiltinModule('node:path');
        }
    } catch {
        nodeFs = null;
        nodeFsSync = null;
        nodePath = null;
    }
}

function nodeFsUnavailable(methodName) {
    return new Error(`IsomorphicFilesystem.${methodName} is only supported in Node.js mode`);
}

// Normalize a browser-side path into a flat store key. Leading/trailing
// slashes are stripped so '/worlds/main/world_data.bin' and
// 'worlds/main/world_data.bin' address the same file, and '' / '.' both mean
// the virtual root.
function normalizeKey(filePath) {
    return String(filePath == null || filePath === '' ? '' : filePath)
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

export class IsomorphicFilesystem {
    #browserFS = null;
    #cache = new Map();      // key -> { kind: 'file', data: Uint8Array } | { kind: 'dir' }
    #readyPromise = null;

    constructor(dbName = 'BrowserFileStoreDB', storeName = 'text_files') {
        if (!isNode) {
            this.#browserFS = new BrowserFS(dbName, storeName);
        }
    }

    // In Node.js mode every relative path is resolved against the project root
    // ('.'), matching how the in-browser virtual filesystem treats its keys.
    // Absolute paths are passed through unchanged.
    #resolvePath(filePath) {
        if (isNode && nodePath) {
            const p = filePath == null || filePath === '' ? '.' : String(filePath);
            return nodePath.isAbsolute(p) ? p : nodePath.join('.', p);
        }
        return filePath;
    }

    async #getNodeFs() {
        if (isNode && !nodeFs) {
            try {
                nodeFs = await import('node:fs/promises');
            } catch {
                nodeFs = null;
            }
        }
        return nodeFs;
    }

    // Browser backend: hydrate the in-memory cache from the persisted store.
    // Only needed before the first server init; import-time sync reads run
    // against an empty cache and fall back to defaults until ready() resolves.
    async ready() {
        if (isNode || !this.#browserFS) {
            return;
        }
        if (this.#readyPromise) {
            return this.#readyPromise;
        }
        this.#readyPromise = this.#initBrowser();
        return this.#readyPromise;
    }

    // Re-hydrate the in-memory cache from the persisted store. Used when files
    // may have been written by another filesystem instance (e.g. the main
    // thread imports/exports worlds while the integrated server runs in a
    // worker, or a freshly stopped worker must re-read main-thread changes).
    async refresh() {
        if (isNode || !this.#browserFS) return;
        if (this.#readyPromise) {
            try {
                await this.#readyPromise;
            } catch (e) {
                // Ignore a failed initial load; retry below.
            }
        }
        this.#cache.clear();
        await this.#initBrowser();
    }

    async #initBrowser() {
        try {
            const keys = await this.#browserFS.listDir('');
            for (const key of keys) {
                try {
                    const raw = await this.#browserFS.loadBinaryFile(key);
                    if (raw === null || raw.length === 0) continue;
                    // saveFile() stores deflate(text); saveBinaryFile() stores
                    // the raw bytes. Inflate what we can, keep the rest.
                    let bytes = raw;
                    try {
                        bytes = inflate(raw);
                    } catch {
                        bytes = raw;
                    }
                    this.#cache.set(normalizeKey(key), { kind: 'file', data: bytes });
                } catch {
                    // Skip unreadable entries.
                }
            }
        } catch {
            // No store available; start with an empty cache.
        }
        this.#cache.set('worlds', { kind: 'dir' });
    }

    // Lazily persist a cache entry to the async store (fire-and-forget).
    #persist(key, entry) {
        if (isNode || !this.#browserFS || entry.kind !== 'file') return;
        // saveFile() deflates the text and the loader inflates it back on the
        // next session, which is only lossless for real UTF-8. World files are
        // opaque binary (BMW3 header plus deflate streams); routing them through
        // the text path replaced every non-UTF-8 byte with U+FFFD and corrupted
        // the save the next time it was read. A strict UTF-8 decode distinguishes
        // the two: only genuine text goes through saveFile(), everything else is
        // written raw via saveBinaryFile().
        let text = null;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(entry.data);
        } catch {
            // Not valid UTF-8 -> opaque binary; store the raw bytes.
        }
        try {
            if (text !== null) {
                this.#browserFS.saveFile(text, key).catch(() => {});
            } else {
                this.#browserFS.saveBinaryFile(entry.data, key).catch(() => {});
            }
        } catch {
            // Ignore persistence failures; the in-memory copy still works.
        }
    }

    #setFile(key, data) {
        const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(String(data));
        this.#cache.set(key, { kind: 'file', data: bytes });
        this.#persist(key, this.#cache.get(key));
    }

    #ensureParentDirs(key) {
        const parts = key.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
            cur = cur ? cur + '/' + parts[i] : parts[i];
            if (!this.#cache.has(cur)) {
                this.#cache.set(cur, { kind: 'dir' });
            }
        }
    }

    #readSync(filePath, encoding) {
        const key = normalizeKey(filePath);
        const entry = this.#cache.get(key);
        if (!entry || entry.kind !== 'file') {
            throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        }
        if (encoding === 'utf8' || encoding === 'utf-8') {
            return new TextDecoder().decode(entry.data);
        }
        return Buffer.from(entry.data);
    }

    async readFile(filePath, encoding = 'utf-8') {
        const nfs = await this.#getNodeFs();
        if (nfs) {
            return await nfs.readFile(this.#resolvePath(filePath), encoding);
        }
        return this.#readSync(filePath, encoding === 'binary' || encoding === null ? null : encoding);
    }

    async writeFile(filePath, data) {
        const nfs = await this.#getNodeFs();
        if (nfs) {
            return await nfs.writeFile(this.#resolvePath(filePath), data);
        }
        this.#setFile(normalizeKey(filePath), data);
    }

    async unlink(filePath) {
        const nfs = await this.#getNodeFs();
        if (nfs) {
            return await nfs.unlink(this.#resolvePath(filePath));
        }
        this.#cache.delete(normalizeKey(filePath));
        if (this.#browserFS) {
            this.#browserFS.deleteFile(normalizeKey(filePath)).catch(() => {});
        }
    }

    async exists(filePath) {
        const nfs = await this.#getNodeFs();
        if (nfs) {
            try {
                await nfs.access(this.#resolvePath(filePath));
                return true;
            } catch {
                return false;
            }
        }
        return this.#cache.has(normalizeKey(filePath));
    }

    async stat(filePath) {
        const nfs = await this.#getNodeFs();
        if (nfs) {
            const stats = await nfs.stat(this.#resolvePath(filePath));
            return {
                size: stats.size,
                isFile: () => stats.isFile(),
                isDirectory: () => stats.isDirectory()
            };
        }
        const entry = this.#cache.get(normalizeKey(filePath));
        if (!entry) {
            throw new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
        }
        return {
            size: entry.kind === 'file' ? entry.data.length : 0,
            isFile: () => entry.kind === 'file',
            isDirectory: () => entry.kind === 'dir'
        };
    }

    async readdir(dirPath = '') {
        const nfs = await this.#getNodeFs();
        if (nfs) {
            return await nfs.readdir(this.#resolvePath(dirPath));
        }
        return this.readdirSync(dirPath);
    }

    existsSync(filePath) {
        if (isNode && nodeFsSync) {
            return nodeFsSync.existsSync(this.#resolvePath(filePath));
        }
        const key = normalizeKey(filePath);
        if (key === '') {
            return true;
        }
        if (this.#cache.has(key)) {
            return true;
        }
        // A path is "present" if it is an ancestor of a stored key.
        const prefix = key + '/';
        for (const stored of this.#cache.keys()) {
            if (stored.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    readFileSync(filePath, encoding) {
        if (isNode && nodeFsSync) {
            return nodeFsSync.readFileSync(this.#resolvePath(filePath), encoding);
        }
        return this.#readSync(filePath, encoding);
    }

    writeFileSync(filePath, data, options) {
        if (isNode && nodeFsSync) {
            return nodeFsSync.writeFileSync(this.#resolvePath(filePath), data, options);
        }
        this.#setFile(normalizeKey(filePath), data);
    }

    mkdirSync(dirPath, options) {
        if (isNode && nodeFsSync) {
            return nodeFsSync.mkdirSync(this.#resolvePath(dirPath), options);
        }
        this.#ensureParentDirs(normalizeKey(dirPath));
        this.#cache.set(normalizeKey(dirPath), { kind: 'dir' });
    }

    readdirSync(dirPath = '', options) {
        if (isNode && nodeFsSync) {
            return nodeFsSync.readdirSync(this.#resolvePath(dirPath), options);
        }
        const key = normalizeKey(dirPath);
        const prefix = key === '' ? '' : key + '/';
        const names = [];
        for (const stored of this.#cache.keys()) {
            if (!stored.startsWith(prefix) || stored === key) continue;
            const rest = stored.slice(prefix.length);
            if (rest.includes('/')) continue; // only direct children
            const entry = this.#cache.get(stored);
            if (options && options.withFileTypes) {
                names.push({
                    name: rest,
                    isDirectory: () => entry.kind === 'dir',
                    isFile: () => entry.kind === 'file',
                    isSymbolicLink: () => false
                });
            } else {
                names.push(rest);
            }
        }
        return names;
    }

    unlinkSync(filePath) {
        if (isNode && nodeFsSync) {
            return nodeFsSync.unlinkSync(this.#resolvePath(filePath));
        }
        this.#cache.delete(normalizeKey(filePath));
        if (this.#browserFS) {
            this.#browserFS.deleteFile(normalizeKey(filePath)).catch(() => {});
        }
    }

    renameSync(oldPath, newPath) {
        if (isNode && nodeFsSync) {
            return nodeFsSync.renameSync(this.#resolvePath(oldPath), this.#resolvePath(newPath));
        }
        const oldKey = normalizeKey(oldPath);
        const newKey = normalizeKey(newPath);
        const entry = this.#cache.get(oldKey);
        if (entry) {
            this.#cache.delete(oldKey);
            this.#cache.set(newKey, entry);
            this.#persist(newKey, entry);
            if (this.#browserFS) {
                this.#browserFS.deleteFile(oldKey).catch(() => {});
            }
        }
    }
}

export default IsomorphicFilesystem;
