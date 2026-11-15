// .jph — a JavaScript PatcH package. It is a JSON document holding metadata and
// one patch script per game file. A patch script runs with `exports` bound to
// that file's live module namespace and may return a cleanup function, which is
// the same contract `patches/<file>.js` uses inside a normal mod folder.
const FORMAT = 'jph';
const CURRENT_VERSION = 1;
const PATCH_DIR = 'patches/';
const SRC_ROOT = 'src/js/';

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE_PATTERN = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.js$/;

export class JphError extends Error {
    constructor(message) {
        super(message);
        this.name = 'JphError';
    }
}

export function normalizeFile(file) {
    if (typeof file !== 'string') {
        throw new JphError('Patch target must be a file path');
    }

    let normalized = file.replace(/\\/g, '/').trim();
    while (normalized.startsWith('./')) normalized = normalized.slice(2);

    if (normalized.startsWith('/')) {
        if (!normalized.startsWith('/' + SRC_ROOT)) {
            throw new JphError(`Invalid patch target '${file}' (expected a path inside ${SRC_ROOT})`);
        }
        normalized = normalized.slice(1);
    }
    if (normalized.startsWith(SRC_ROOT)) normalized = normalized.slice(SRC_ROOT.length);

    if (!FILE_PATTERN.test(normalized)) {
        throw new JphError(`Invalid patch target '${file}' (expected a .js path inside src/js)`);
    }
    return normalized;
}

export function isJphText(text) {
    if (typeof text !== 'string') return false;
    try {
        const data = JSON.parse(text);
        return !!data && data.format === FORMAT;
    } catch (err) {
        return false;
    }
}

export function detectKind(data) {
    if (typeof data === 'string') {
        return isJphText(data) ? 'jph' : 'unknown';
    }

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
    if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';

    return isJphText(new TextDecoder().decode(bytes)) ? 'jph' : 'unknown';
}

export function parse(input) {
    if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
        input = new TextDecoder().decode(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
    }

    // Callers that already parsed a document (installModFromJph keeps the object
    // and passes it to toModFiles) hand one back here. Re-serializing first is not
    // required, and rejecting it made installing an exported .jph always fail with
    // "must be read as text" even though the file itself was fine.
    let data;
    if (typeof input === 'string') {
        try {
            data = JSON.parse(input);
        } catch (err) {
            throw new JphError('Not a .jph file: invalid JSON');
        }
    } else if (input && typeof input === 'object') {
        data = input;
    } else {
        throw new JphError('A .jph file must be read as text');
    }

    if (!data || data.format !== FORMAT) {
        throw new JphError('Not a .jph file');
    }
    if (Number(data.version) !== CURRENT_VERSION) {
        throw new JphError(`Unsupported .jph version ${data.version} (this build reads version ${CURRENT_VERSION})`);
    }

    const id = String(data.id || '').trim().toLowerCase();
    if (!ID_PATTERN.test(id)) {
        throw new JphError("A .jph needs an 'id' of lowercase letters, digits, '-' or '_'");
    }

    const patches = [];
    const seen = new Set();
    for (const raw of Array.isArray(data.patches) ? data.patches : []) {
        if (!raw || typeof raw.source !== 'string' || raw.source.trim() === '') continue;

        const file = normalizeFile(raw.file);
        if (seen.has(file)) {
            throw new JphError(`The patch for '${file}' is included twice`);
        }
        seen.add(file);
        patches.push({ file, source: raw.source });
    }

    if (patches.length === 0) {
        throw new JphError('A .jph must patch at least one file');
    }

    return {
        format: FORMAT,
        version: CURRENT_VERSION,
        id,
        name: String(data.name || id).trim(),
        author: String(data.author || 'Unknown').trim(),
        description: String(data.description || '').trim(),
        modVersion: String(data.modVersion || '1.0.0').trim(),
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
        patches: patches.sort((a, b) => a.file.localeCompare(b.file))
    };
}

export function serialize(mod) {
    const parsed = parse(JSON.stringify({ format: FORMAT, version: CURRENT_VERSION, ...mod }));

    return JSON.stringify({
        format: FORMAT,
        version: CURRENT_VERSION,
        id: parsed.id,
        name: parsed.name,
        author: parsed.author,
        description: parsed.description,
        modVersion: parsed.modVersion,
        createdAt: parsed.createdAt,
        patches: parsed.patches
    }, null, 2) + '\n';
}

// Files for the mods filesystem: the metadata record plus one patch per target.
export function toModFiles(mod) {
    const parsed = parse(mod);

    const files = [{
        path: 'ModData.json',
        content: JSON.stringify({
            ID: parsed.id,
            NAME: parsed.name,
            AUTHOR: parsed.author,
            VERSION: parsed.modVersion,
            DESCRIPTION: parsed.description,
            LICENSE: 'None',
            JPH: parsed.version
        }, null, 2)
    }];

    for (const patch of parsed.patches) {
        files.push({ path: PATCH_DIR + patch.file, content: patch.source });
    }

    return files;
}

export const JphFormat = {
    FORMAT,
    VERSION: CURRENT_VERSION,
    JphError,
    detectKind,
    isJphText,
    normalizeFile,
    parse,
    serialize,
    toModFiles
};

export default JphFormat;
