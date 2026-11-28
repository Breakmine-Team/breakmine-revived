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

function storeContraption(id, payload, restored = false, owner = null) {
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

    // Which client currently simulates the body. Only that client can move it,
    // so a helm on another client has its keys relayed there.
    if (owner !== null && owner !== undefined) {
        state.owner = owner;
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

// A moving contraption reports only its pose between full updates. The stored
// state follows along so a player joining mid-drive finds it where it is, and
// the pose is relayed so every other client moves the body smoothly and can
// carry a player standing on it.
function storeContraptionPose(id, payload) {
    const state = typeof id === 'string' ? contraptions.get(id) : undefined;
    if (!state || !payload || typeof payload !== 'object') {
        return null;
    }

    const pos = sanitizeVector(payload.pos);
    const quat = sanitizeQuaternion(payload.quat);
    if (pos === null || quat === null) {
        return null;
    }

    state.pos = pos;
    state.quat = quat;
    state.asleep = false;

    const vel = sanitizeVector(payload.vel);
    if (vel !== null) {
        state.vel = vel;
    }

    const angVel = sanitizeVector(payload.angVel);
    if (angVel !== null) {
        state.angVel = angVel;
    }

    return {type: 'contraption:pose', id: id, pos: pos, quat: quat};
}

// The pose of a body, reported by the client that simulates it. The cells are
// shared between everybody building on the hull, so a full report only moves the
// body: rewriting the cells from one client's copy is what made a block another
// player placed disappear as soon as the owner moved the boat.
function updateContraptionPose(id, payload) {
    const state = typeof id === 'string' ? contraptions.get(id) : undefined;
    if (!state || !payload || typeof payload !== 'object') {
        return null;
    }

    const pos = sanitizeVector(payload.pos);
    const quat = sanitizeQuaternion(payload.quat);
    if (pos === null || quat === null) {
        return null;
    }

    const center = sanitizeVector(payload.center);
    if (center !== null) {
        state.center = center;
    }

    state.pos = pos;
    state.quat = quat;
    state.asleep = payload.asleep !== false;

    const vel = sanitizeVector(payload.vel);
    if (vel !== null) {
        state.vel = vel;
    }

    const angVel = sanitizeVector(payload.angVel);
    if (angVel !== null) {
        state.angVel = angVel;
    }

    return state;
}

// A block placed on or broken out of a hull. The edit is the only thing that
// changes the cells, so edits from several players add up instead of the last
// whole-group report wiping the others out. Returns the message to relay, which
// is the removal once the last cell is gone.
function applyCellEdits(id, add, remove) {
    const state = typeof id === 'string' ? contraptions.get(id) : undefined;
    if (!state) {
        return null;
    }

    const removed = [];
    if (Array.isArray(remove)) {
        for (const cell of remove.slice(0, MAX_CELLS)) {
            const x = Math.trunc(Number(cell && cell.x));
            const y = Math.trunc(Number(cell && cell.y));
            const z = Math.trunc(Number(cell && cell.z));
            if (![x, y, z].every((value) => Number.isInteger(value))) continue;

            const index = state.cells.findIndex((existing) =>
                existing.x === x && existing.y === y && existing.z === z);
            if (index === -1) continue;

            state.cells.splice(index, 1);
            removed.push({x: x, y: y, z: z});
        }
    }

    const cells = Array.isArray(add) && add.length > 0 ? sanitizeCells(add) : [];
    if (cells === null) {
        return null;
    }

    const added = [];
    for (const cell of cells) {
        const index = state.cells.findIndex((existing) =>
            existing.x === cell.x && existing.y === cell.y && existing.z === cell.z);

        if (index === -1) {
            if (state.cells.length >= MAX_CELLS) continue;

            state.cells.push(cell);
            added.push(cell);
            continue;
        }

        if (state.cells[index].id !== cell.id || state.cells[index].data !== cell.data) {
            state.cells[index] = cell;
            added.push(cell);
        }
    }

    if (added.length === 0 && removed.length === 0) {
        return null;
    }

    if (state.cells.length === 0) {
        contraptions.delete(id);
        return {type: 'contraption:remove', id: id};
    }

    return {type: 'contraption:cell', id: id, add: added, remove: removed};
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

// Which client simulates the body. A restored contraption has no owner yet; the
// first client to ask for it gets it, so exactly one client runs its physics.
function setContraptionOwner(id, owner) {
    const state = typeof id === 'string' ? contraptions.get(id) : undefined;
    if (!state) {
        return null;
    }

    if (owner === null || owner === undefined) {
        delete state.owner;
    } else {
        state.owner = owner;
    }

    return state;
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
            // Session ids mean nothing after a restart; the next client to
            // report the body becomes its owner again.
            delete entry.owner;
            return entry;
        });

        fs.writeFileSync(getContraptionFile(worldDir), JSON.stringify(saved), 'utf8');
    } catch (error) {
        console.error('[Contraptions] Failed to save contraptions:', error && error.message);
    }
}

export {
    storeContraption,
    storeContraptionPose,
    updateContraptionPose,
    applyCellEdits,
    storeSavedState,
    getContraption,
    setContraptionOwner,
    listContraptions,
    removeContraption,
    clearContraptions,
    loadContraptions,
    saveContraptions
};
