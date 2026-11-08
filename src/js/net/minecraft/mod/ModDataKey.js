
export function normalizeModDataKey(key) {
    if (typeof key !== 'string') {
        throw new Error('Mod data key must be a string.');
    }

    const cleaned = key.trim();
    if (!cleaned) {
        throw new Error('Mod data key cannot be empty.');
    }
    if (cleaned === '.' || cleaned === '..' || !/^[A-Za-z0-9._-]{1,64}$/.test(cleaned)) {
        throw new Error(
            `Invalid mod data key '${key}'. Use 1-64 letters, numbers, '.', '_' or '-'.`
        );
    }
    return cleaned;
}

export function modDataPath(modId, key) {
    if (typeof modId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(modId)) {
        throw new Error(`Invalid mod id '${modId}' for mod data.`);
    }
    return `mod_data/${modId}/${normalizeModDataKey(key)}.json`;
}
