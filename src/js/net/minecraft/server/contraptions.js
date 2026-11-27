import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';

// Contraptions are simulated by the clients and only reported to the server.
// The server keeps the latest reported cells and pose, hands them out to players
// who join later and writes them next to the world so an assembled contraption
// is still there after a restart. It never runs the physics itself.
const MAX_CELLS = 256;
const MAX_COORDINATE = 1000000;
const SAVE_FILE = 'contraptions.json';

const contraptions = new Map();

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeCells(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CELLS) {
        return null;
    }

    const cells = [];
    for (const cell of value) {
        if (!cell || typeof cell !== 'object') return null;

        const x = Math.trunc(cell.x);
        const y = Math.trunc(cell.y);
        const z = Math.trunc(cell.z);
        const id = Math.trunc(cell.id);
        const rawData = Math.trunc(Number(cell.data));

        if (![x, y, z, id].every((value) => Number.isInteger(value))) return null;
        if (id <= 0 || id > 4096) return null;
        if (Math.abs(x) > MAX_COORDINATE || Math.abs(y) > MAX_COORDINATE
            || Math.abs(z) > MAX_COORDINATE) {
            return null;
        }

        cells.push({
            x: x,
            y: y,
            z: z,
            id: id,
            data: Number.isInteger(rawData) ? Math.max(0, Math.min(15, rawData)) : 0
        });
    }

    return cells;
}

function sanitizeVector(value) {
    if (!value || typeof value !== 'object') return null;
    if (![value.x, value.y, value.z].every(isFiniteNumber)) return null;

    return {x: value.x, y: value.y, z: value.z};
}

function sanitizeQuaternion(value) {
    if (!value || typeof value !== 'object') return null;
    if (![value.x, value.y, value.z, value.w].every(isFiniteNumber)) return null;

    const length = Math.hypot(value.x, value.y, value.z, value.w);
    if (!Number.isFinite(length) || length < 1e-8) return null;

    return {
        x: value.x / length,
        y: value.y / length,
        z: value.z / length,
        w: value.w / length
    };
}

function storeContraption(id, payload, restored = false) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
        return null;
    }
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const cells = sanitizeCells(payload.cells);
    const center = sanitizeVector(payload.center);
    const pos = sanitizeVector(payload.pos);

    if (cells === null || center === null || pos === null) {
        return null;
    }

    const state = {
        type: 'contraption:state',
        id: id,
        // A body saved mid-flight keeps its velocity and keeps falling when it
        // comes back; a resting one stays where it was.
        asleep: payload.asleep !== false,
        cells: cells,
        center: center,
        pos: pos,
        quat: sanitizeQuaternion(payload.quat) || {x: 0.0, y: 0.0, z: 0.0, w: 1.0}
    };

    // A saved body has no client simulating it yet. Whoever edits it takes over.
    if (restored) {
        state.restored = true;
    }

    const vel = sanitizeVector(payload.vel);
    if (vel !== null) {
        state.vel = vel;
    }

    const angVel = sanitizeVector(payload.angVel);
    if (angVel !== null) {
        state.angVel = angVel;
    }

    contraptions.set(id, state);
    return state;
}

// Restore a contraption from a world save so it can be handed to a client.
function storeSavedState(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    return storeContraption(value.id, value, true);
}

function getContraption(id) {
    return contraptions.get(id) || null;
}

function listContraptions() {
    return [...contraptions.values()];
}

function removeContraption(id) {
    return contraptions.delete(id);
}

function clearContraptions() {
    contraptions.clear();
}

function getContraptionFile(worldDir) {
    return path.join(worldDir, SAVE_FILE);
}

function loadContraptions(worldDir) {
    clearContraptions();

    try {
        const file = getContraptionFile(worldDir);
        if (!fs.existsSync(file)) {
            return;
        }

        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(saved)) {
            return;
        }

        for (const entry of saved) {
            storeSavedState(entry);
        }
    } catch (error) {
        console.error('[Contraptions] Failed to load saved contraptions:', error && error.message);
    }
}

function saveContraptions(worldDir) {
    try {
        if (!fs.existsSync(worldDir)) {
            fs.mkdirSync(worldDir, { recursive: true });
        }

        const saved = listContraptions().map((state) => {
            const entry = {...state};
            delete entry.restored;
            return entry;
        });

        fs.writeFileSync(getContraptionFile(worldDir), JSON.stringify(saved), 'utf8');
    } catch (error) {
        console.error('[Contraptions] Failed to save contraptions:', error && error.message);
    }
}

export {
    storeContraption,
    storeSavedState,
    getContraption,
    listContraptions,
    removeContraption,
    clearContraptions,
    loadContraptions,
    saveContraptions
};
