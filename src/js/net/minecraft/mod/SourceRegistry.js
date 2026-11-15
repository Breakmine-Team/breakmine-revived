// Read-only access to the game's own source text, for the in-game IDE. Vite
// bundles each file raw, so the IDE works in packaged builds too.
//
// The glob is called directly. Vite replaces the call itself at build time, but a
// `typeof import.meta.glob === 'function'` guard survives into the browser, where
// import.meta.glob is undefined - which silently emptied the source tree in dev
// while still looking fine under server-side rendering. try/catch covers the
// environments Vite never transforms.
//
// server/ is excluded on purpose: it is Node-only code that nothing in the game
// can patch, and its HTML templates contain <script> tags that would close the
// inline <script> of a single-file build once the raw text is inlined.
let rawLoaders = {};
try {
    rawLoaders = import.meta.glob([
        '/src/js/*.js',
        '/src/js/net/minecraft/client/**/*.js',
        '/src/js/net/minecraft/mod/**/*.js',
        '/src/js/net/minecraft/util/**/*.js',
        '/src/js/net/minecraft/nbt/**/*.js',
        '/src/js/net/minecraft/lib/**/*.js'
    ], { query: '?raw', import: 'default' });
} catch (err) {
    rawLoaders = {};
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
for (const [file, loader] of Object.entries(rawLoaders)) {
    loaders.set(normalizeFile(file), loader);
}

export default class SourceRegistry {

    static #sources = new Map();

    static isAvailable() {
        return loaders.size > 0;
    }

    static list() {
        return [...loaders.keys()].sort();
    }

    static search(query, limit = 200) {
        const files = this.list();
        const needle = String(query || '').trim().toLowerCase();
        const matched = needle ? files.filter(file => file.toLowerCase().includes(needle)) : files;
        return Number.isFinite(limit) ? matched.slice(0, limit) : matched;
    }

    static has(file) {
        return loaders.has(normalizeFile(file));
    }

    static async read(file) {
        const key = normalizeFile(file);
        const loader = loaders.get(key);
        if (!loader) {
            throw new Error(`Unknown game file '${file}'`);
        }

        if (!this.#sources.has(key)) {
            this.#sources.set(key, Promise.resolve(loader()));
        }
        return this.#sources.get(key);
    }

    static async lines(file) {
        const source = await this.read(file);
        return String(source).split('\n').length;
    }
}
