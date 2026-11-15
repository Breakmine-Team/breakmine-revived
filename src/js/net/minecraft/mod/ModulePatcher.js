// Every file under src/js is registered here, so a mod can patch any of them.
// Vite turns the glob into lazy loaders; a raw (non-bundled) deployment leaves
// the registry empty and patching reports itself as unavailable.
// Called directly, not behind a `typeof` guard: Vite replaces the call at build
// time, but the guard would survive into the browser (where import.meta.glob does
// not exist) and leave the patch layer with no files at all.
let sourceLoaders = {};
try {
    sourceLoaders = import.meta.glob('/src/js/**/*.js');
} catch (err) {
    sourceLoaders = {};
}

const SRC_ROOT = 'src/js/';

function normalizeFile(file) {
    if (typeof file !== 'string') {
        throw new Error('A game file path is required');
    }

    let normalized = file.replace(/\\/g, '/').trim();
    while (normalized.startsWith('./')) normalized = normalized.slice(2);
    if (normalized.startsWith('/')) normalized = normalized.slice(1);
    if (normalized.startsWith(SRC_ROOT)) normalized = normalized.slice(SRC_ROOT.length);

    if (!normalized || normalized.startsWith('..') || normalized.includes('/../')) {
        throw new Error(`Invalid game file path '${file}'`);
    }
    return normalized;
}

const loaders = new Map();
for (const [file, loader] of Object.entries(sourceLoaders)) {
    loaders.set(normalizeFile(file), loader);
}

export default class ModulePatcher {

    static #modules = new Map();
    static #exports = new Map();
    static #patches = new Map();
    static #order = 0;

    static isAvailable() {
        return loaders.size > 0;
    }

    static listFiles() {
        return [...loaders.keys()].sort();
    }

    // Live namespace of a game file. Files already in the page's module graph
    // are not evaluated twice: the import resolves to the same module object,
    // which is what makes patching an already-loaded class work.
    static async loadModule(file) {
        const key = normalizeFile(file);
        const loader = loaders.get(key);
        if (!loader) {
            throw new Error(`Unknown game file '${file}'`);
        }

        if (!this.#modules.has(key)) {
            const promise = Promise.resolve(loader()).then((exports) => {
                this.#exports.set(key, exports);
                return exports;
            });
            this.#modules.set(key, promise);
        }

        return this.#modules.get(key);
    }

    // Applies one patch. `fn` receives the file's live exports object and may
    // return a cleanup function that puts the file back the way it was.
    static async patch(modId, file, fn) {
        if (typeof fn !== 'function') {
            throw new Error('A patch function is required');
        }

        const key = normalizeFile(file);
        const exports = await this.loadModule(key);

        const handle = {
            modId,
            file: key,
            fn,
            order: ++this.#order,
            cleanup: null
        };

        handle.cleanup = this.#apply(handle, exports);

        if (!this.#patches.has(modId)) this.#patches.set(modId, []);
        this.#patches.get(modId).push(handle);

        return handle;
    }

    // Evaluates a mod's patch source. The source is plain JavaScript (no
    // import/export) that runs with `exports` bound to the target file's live
    // module namespace and may return a cleanup function.
    static async applySource(modId, file, source) {
        const run = new Function('exports', 'api', '"use strict";\n' + source);
        return this.patch(modId, file, (exports, api) => run(exports, api));
    }

    static patchesOf(modId) {
        return this.#patches.get(modId) || [];
    }

    static patchedFiles() {
        const files = new Set();
        for (const handles of this.#patches.values()) {
            for (const handle of handles) files.add(handle.file);
        }
        return [...files].sort();
    }

    // Removes every patch a mod applied. Files that other mods still patch are
    // unwound completely and then patched again in their original order, so two
    // mods touching the same file can never leave it half-patched.
    static revert(modId) {
        const handles = this.#patches.get(modId);
        if (!handles) return 0;

        this.#patches.delete(modId);
        const files = new Set(handles.map(handle => handle.file));

        for (const file of files) {
            const doomed = handles
                .filter(handle => handle.file === file)
                .sort((a, b) => a.order - b.order);
            const survivors = this.#handlesForFile(file);

            const all = [...survivors, ...doomed].sort((a, b) => a.order - b.order);
            for (let i = all.length - 1; i >= 0; i--) {
                this.#runCleanup(all[i]);
            }
            for (const survivor of survivors) {
                this.#reapply(survivor);
            }
        }

        return handles.length;
    }

    static revertAll() {
        let reverted = 0;
        for (const modId of [...this.#patches.keys()]) {
            reverted += this.revert(modId);
        }
        return reverted;
    }

    static #handlesForFile(file) {
        const handles = [];
        for (const list of this.#patches.values()) {
            for (const handle of list) {
                if (handle.file === file) handles.push(handle);
            }
        }
        return handles.sort((a, b) => a.order - b.order);
    }

    static #apiFor(handle) {
        return {
            modId: handle.modId,
            file: handle.file,
            log: (...args) => console.log(`[Patchwork] [${handle.modId}]`, ...args),
            warn: (...args) => console.warn(`[Patchwork] [${handle.modId}]`, ...args)
        };
    }

    static #apply(handle, exports) {
        let result;
        try {
            result = handle.fn(exports, this.#apiFor(handle));
        } catch (err) {
            console.error(`[Patchwork] Patch on '${handle.file}' from mod '${handle.modId}' failed:`, err);
            return null;
        }

        if (result && typeof result.then === 'function') {
            result
                .then(cleanup => {
                    handle.cleanup = typeof cleanup === 'function' ? cleanup : null;
                })
                .catch(err => {
                    console.error(`[Patchwork] Patch on '${handle.file}' from mod '${handle.modId}' failed:`, err);
                });
            return null;
        }

        return typeof result === 'function' ? result : null;
    }

    static #reapply(handle) {
        const exports = this.#exports.get(handle.file);
        if (!exports) return;
        handle.cleanup = this.#apply(handle, exports);
    }

    static #runCleanup(handle) {
        const cleanup = handle.cleanup;
        handle.cleanup = null;
        if (!cleanup) return;

        try {
            cleanup();
        } catch (err) {
            console.error(`[Patchwork] Failed to revert patch on '${handle.file}' from mod '${handle.modId}':`, err);
        }
    }
}
