// Pure helpers shared by the integrated-server controller (main thread) and
// the integrated server worker (integrated.worker.js).

export function serverNameForKey(worldKey) {
    return String(worldKey || 'main').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'main';
}

// Parse the simple `key=value` serverconfig.conf format (mirrors the fields
// the server's own config loader understands, plus `name` metadata).
export function parseServerConfig(content) {
    const conf = {};
    for (const line of String(content || '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        conf[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return conf;
}

export function gamemodeName(value) {
    const gm = String(value == null ? '' : value).toLowerCase();
    if (gm === '0' || gm === 'survival') return 'survival';
    if (gm === '1' || gm === 'creative') return 'creative';
    if (gm === '3' || gm === 'spectator') return 'spectator';
    return 'creative';
}
