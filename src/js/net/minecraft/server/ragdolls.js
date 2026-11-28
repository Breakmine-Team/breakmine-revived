import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';

// Ragdolls are simulated by one of the clients and only reported to the server.
// The server keeps the latest pose, hands it out to players who join later and
// writes it next to the world so bodies survive a restart. It never runs the
// physics itself.
const MAX_RAGDOLL_BONES = 24;
const MAX_RAGDOLL_HEALTH = 1000;
const SAVE_FILE = 'ragdolls.json';

const ragdolls = new Map();

function sanitizeBones(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RAGDOLL_BONES) {
        return null;
    }

    const bones = [];
    for (const bone of value) {
        if (!bone || typeof bone !== 'object') return null;

        const fields = [bone.x, bone.y, bone.z, bone.qx, bone.qy, bone.qz, bone.qw];
        if (!fields.every((field) => typeof field === 'number' && Number.isFinite(field))) {
            return null;
        }

        bones.push({
            x: bone.x, y: bone.y, z: bone.z,
            qx: bone.qx, qy: bone.qy, qz: bone.qz, qw: bone.qw
        });
    }

    return bones;
}

function sanitizeLoot(value) {
    if (!Array.isArray(value)) {
        return null;
    }

    const loot = [];
    for (const entry of value.slice(0, 64)) {
        if (!entry || typeof entry !== 'object') continue;

        const id = Math.trunc(entry.id);
        const count = Math.trunc(entry.count);
        if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(count) || count <= 0) continue;

        loot.push({id: id, count: Math.min(count, 64)});
    }

    return loot;
}

function storeRagdoll(id, payload, owner = null) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
        return null;
    }
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const bones = sanitizeBones(payload.bones);
    if (bones === null) {
        return null;
    }

    const state = {
        type: 'ragdoll:state',
        id: id,
        owner: Number.isFinite(owner) ? owner : null,
        asleep: payload.asleep === true,
        bones: bones
    };

    if (Number.isFinite(payload.health)) {
        state.health = Math.max(0, Math.min(MAX_RAGDOLL_HEALTH, payload.health));
    }

    // Dead-player corpses keep the name and the items they hold, so somebody
    // who was not the one that died can still loot them.
    if (typeof payload.name === 'string' && payload.name.length > 0) {
        state.name = payload.name.slice(0, 32);
    }

    const loot = sanitizeLoot(payload.loot);
    if (loot !== null && loot.length > 0) {
        state.loot = loot;
    }

    ragdolls.set(id, state);
    return state;
}

// Restore a body from a world save. Saved bodies have no live owner: whoever
// touches one takes the simulation over.
function storeSavedState(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    // A restored body has nobody simulating it yet, so it starts frozen in its
    // saved pose and wakes up when a player kicks or hits it.
    return storeRagdoll(value.id, {...value, asleep: true}, null);
}

function getRagdoll(id) {
    return ragdolls.get(id) || null;
}

function listRagdolls() {
    return [...ragdolls.values()];
}

function removeRagdoll(id) {
    return ragdolls.delete(id);
}

function setRagdollOwner(id, owner) {
    const state = ragdolls.get(id);
    if (!state) {
        return null;
    }

    state.owner = Number.isFinite(owner) ? owner : null;
    return state;
}

function clearRagdolls() {
    ragdolls.clear();
}

function getRagdollFile(worldDir) {
    return path.join(worldDir, SAVE_FILE);
}

function loadRagdolls(worldDir) {
    clearRagdolls();

    try {
        const file = getRagdollFile(worldDir);
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
        console.error('[Ragdolls] Failed to load saved ragdolls:', error && error.message);
    }
}

function saveRagdolls(worldDir) {
    try {
        if (!fs.existsSync(worldDir)) {
            fs.mkdirSync(worldDir, { recursive: true });
        }

        // Owners are only meaningful while their client is connected.
        const saved = listRagdolls().map((state) => ({...state, owner: null}));
        fs.writeFileSync(getRagdollFile(worldDir), JSON.stringify(saved), 'utf8');
    } catch (error) {
        console.error('[Ragdolls] Failed to save ragdolls:', error && error.message);
    }
}

export {
    storeRagdoll,
    storeSavedState,
    getRagdoll,
    listRagdolls,
    removeRagdoll,
    setRagdollOwner,
    clearRagdolls,
    loadRagdolls,
    saveRagdolls
};
