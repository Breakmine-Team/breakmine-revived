const SEP = '/';

function isAbsolute(p) {
    return typeof p === 'string' && p.startsWith('/');
}

function normalize(p) {
    if (typeof p !== 'string') return '.';
    const absolute = isAbsolute(p);
    const trailing = p.length > 1 && p.endsWith('/');
    const parts = p.split('/');
    const stack = [];
    for (const part of parts) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
            else if (!absolute) stack.push('..');
            continue;
        }
        stack.push(part);
    }
    let out = stack.join('/');
    if (absolute) out = '/' + out;
    if (out === '') out = absolute ? '/' : '.';
    if (trailing && out !== '/') out += '/';
    return out;
}

function join(...parts) {
    if (parts.length === 0) return '.';
    const filtered = parts.filter((p) => typeof p === 'string' && p.length > 0);
    if (filtered.length === 0) return '.';
    if (isAbsolute(filtered[0])) return normalize(filtered.join('/'));
    return normalize(filtered.join('/'));
}

function resolve(...parts) {
    const filtered = parts.filter((p) => typeof p === 'string' && p.length > 0);
    let base = '/';
    for (const part of filtered) {
        if (isAbsolute(part)) {
            base = part;
        } else {
            base = base.endsWith('/') ? base + part : base + '/' + part;
        }
    }
    return normalize(base);
}

function dirname(p) {
    if (typeof p !== 'string' || p === '') return '.';
    const normalized = normalize(p);
    if (normalized === '/') return '/';
    const idx = normalized.lastIndexOf('/');
    if (idx === -1) return '.';
    if (idx === 0) return '/';
    return normalized.slice(0, idx);
}

function basename(p, ext) {
    if (typeof p !== 'string' || p === '') return '';
    const normalized = normalize(p);
    const name = normalized.split('/').pop();
    if (ext && typeof ext === 'string' && name.endsWith(ext) && name.length > ext.length) {
        return name.slice(0, name.length - ext.length);
    }
    return name;
}

function extname(p) {
    if (typeof p !== 'string' || p === '') return '';
    const name = basename(p);
    const idx = name.lastIndexOf('.');
    if (idx <= 0) return '';
    return name.slice(idx);
}

/**
 * The directory of the module that calls this, as an absolute path.
 *
 * `new URL('.', import.meta.url)` is the obvious way to write that, but it
 * throws `TypeError: Failed to construct 'URL': Invalid URL` when the module
 * URL cannot act as a base for a relative reference. A worker that was inlined
 * into a build (a single-file build runs its workers from a `blob:` URL) has
 * exactly that kind of URL, so the throw used to kill the worker at startup.
 * The paths derived from this value are only ever used as browser-virtual
 * filesystem keys in that environment, so the root is a usable answer instead
 * of a crash.
 */
function moduleDir() {
    try {
        return new URL('.', import.meta.url).pathname;
    } catch (e) {
        return SEP;
    }
}

export default {
    sep: SEP,
    posix: null,
    join,
    normalize,
    resolve,
    isAbsolute,
    dirname,
    basename,
    extname,
    moduleDir
};
