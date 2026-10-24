// Server-authoritative state for the off-grid block renderer.
//
// The client used to own the whole system: /offgridrenderer summoned blocks
// into a local OffGridBlockField and ghost blocks into OffGridBlockRenderer.
// In multiplayer that meant nobody else could see the result. This module is
// the shared owner of that state: every fill/move/rotate/clear and every
// summoned-cell edit goes through here, is validated once, and is broadcast
// with the off-grid packets (see packets.js).
//
// Rendering still happens exclusively on clients. This module only stores the
// render-free parts: cells (local grid coordinates), pose (rotation + offset +
// pivot) and the ghost-block list.
import Block from '../client/world/block/Block.js';
import { BlockRegistry } from '../client/world/block/BlockRegistry.js';
import { OFF_GRID_MAX_CELLS, OFF_GRID_MAX_DIM, OFF_GRID_MAX_GHOSTS, OFF_GRID_PROTOCOL_VERSION, OFF_GRID_UPDATE_SET_CELL, OFF_GRID_WORLD_HEIGHT } from '../util/OffGridConstants.js';
import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';
import Logger from './logger.js';
import { registerWorldLifecycle } from './world.js';
import { getPlayers } from './players.js';
import { createOffGridStatePacket, createOffGridUpdatePacket } from './packets.js';

const log = Logger;

const OFF_GRID_FILE = 'offgrid.json';

function emptyField() {
    return {
        cells: new Map(),
        rotation: { x: 0, y: 0, z: 0 },
        offset: { x: 0, y: 0, z: 0 },
        pivot: null
    };
}

const field = emptyField();
let ghosts = [];
let dirty = false;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function cellKey(x, y, z) {
    return x + ',' + y + ',' + z;
}

function normalizePivot(pivot) {
    if (!pivot || typeof pivot !== 'object') return null;
    if (!isFiniteNumber(pivot.x) || !isFiniteNumber(pivot.y) || !isFiniteNumber(pivot.z)) {
        return null;
    }
    return { x: pivot.x, y: pivot.y, z: pivot.z };
}

function normalizeRotation(rotation) {
    return {
        x: rotation && isFiniteNumber(rotation.x) ? rotation.x : 0,
        y: rotation && isFiniteNumber(rotation.y) ? rotation.y : 0,
        z: rotation && isFiniteNumber(rotation.z) ? rotation.z : 0
    };
}

function normalizeOffset(offset) {
    return {
        x: offset && isFiniteNumber(offset.x) ? offset.x : 0,
        y: offset && isFiniteNumber(offset.y) ? offset.y : 0,
        z: offset && isFiniteNumber(offset.z) ? offset.z : 0
    };
}

/** Inclusive axis-aligned bounds of the summoned cells, or null. */
function getBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const cell of field.cells.values()) {
        if (cell.x < minX) minX = cell.x;
        if (cell.y < minY) minY = cell.y;
        if (cell.z < minZ) minZ = cell.z;
        if (cell.x > maxX) maxX = cell.x;
        if (cell.y > maxY) maxY = cell.y;
        if (cell.z > maxZ) maxZ = cell.z;
    }

    return minX > maxX ? null : { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Freeze the rotation pivot the same way OffGridBlockField.getPivot() does:
 * the first time a pose is needed, centred on the current summoned bounds.
 * Holding it afterwards keeps a structure from re-centring when a cell is
 * added or broken, which would shift every cell under the pose.
 */
function ensurePivot() {
    if (field.pivot !== null) return field.pivot;
    const bounds = getBounds();
    if (!bounds) return null;
    field.pivot = {
        x: (bounds.minX + bounds.maxX + 1) / 2,
        y: (bounds.minY + bounds.maxY + 1) / 2,
        z: (bounds.minZ + bounds.maxZ + 1) / 2
    };
    return field.pivot;
}

function isValidBlockId(typeId) {
    if (!Number.isInteger(typeId) || typeId <= 0) return false;
    const block = Block.getById(typeId) || BlockRegistry.get(typeId);
    if (!block) return false;
    return typeof block.isItem !== 'function' || !block.isItem();
}

function hasNeighborCell(x, y, z) {
    return field.cells.has(cellKey(x + 1, y, z)) ||
        field.cells.has(cellKey(x - 1, y, z)) ||
        field.cells.has(cellKey(x, y + 1, z)) ||
        field.cells.has(cellKey(x, y - 1, z)) ||
        field.cells.has(cellKey(x, y, z + 1)) ||
        field.cells.has(cellKey(x, y, z - 1));
}

function getCellCount() {
    return field.cells.size;
}

/** Render-free snapshot broadcast to clients (both on demand and after edits). */
function getSnapshot() {
    ensurePivot();

    const cells = [];
    for (const cell of field.cells.values()) {
        cells.push({ x: cell.x, y: cell.y, z: cell.z, typeId: cell.typeId, data: cell.data });
    }

    return {
        version: OFF_GRID_PROTOCOL_VERSION,
        cells,
        rotation: { ...field.rotation },
        offset: { ...field.offset },
        pivot: field.pivot ? { ...field.pivot } : null,
        ghosts: ghosts.map((ghost) => ({ ...ghost }))
    };
}

/**
 * Summon a volume of one block type. This mirrors OffGridBlockField.fill():
 * existing cells inside the volume are overwritten, missing ones are added.
 * Validation (limits, world bounds) belongs to the command handler.
 */
function applyFill(minXRaw, minYRaw, minZRaw, sizeX, sizeY, sizeZ, typeId, data = 0) {
    if (!Number.isInteger(typeId) || typeId <= 0) return 0;
    if (!Number.isInteger(sizeX) || !Number.isInteger(sizeY) || !Number.isInteger(sizeZ)) return 0;
    if (sizeX < 1 || sizeY < 1 || sizeZ < 1) return 0;
    if (sizeX > OFF_GRID_MAX_DIM || sizeY > OFF_GRID_MAX_DIM || sizeZ > OFF_GRID_MAX_DIM) return 0;

    const minX = Math.floor(minXRaw);
    const minY = Math.floor(minYRaw);
    const minZ = Math.floor(minZRaw);
    if (minY < 0 || minY + sizeY > OFF_GRID_WORLD_HEIGHT) return 0;

    const metadata = Math.floor(data) & 0xF;
    let count = 0;

    for (let x = minX; x < minX + sizeX; x++) {
        for (let y = minY; y < minY + sizeY; y++) {
            for (let z = minZ; z < minZ + sizeZ; z++) {
                const key = cellKey(x, y, z);
                const existing = field.cells.get(key);
                if (existing && existing.typeId === typeId && existing.data === metadata) {
                    continue;
                }
                if (!existing && field.cells.size >= OFF_GRID_MAX_CELLS) {
                    continue;
                }
                field.cells.set(key, { x, y, z, typeId, data: metadata });
                count++;
            }
        }
    }

    if (count > 0) {
        ensurePivot();
        dirty = true;
    }
    return count;
}

/**
 * Mirror one cell write. Used for interactive edits coming from clients:
 * breaking an existing cell removes it, placing/replacing one requires a
 * valid block and (for new cells) a face-adjacent existing cell.
 *
 * @returns {{valid: boolean, changed: boolean}}
 */
function applyCellEdit(xRaw, yRaw, zRaw, typeId, data = 0) {
    const x = Math.trunc(xRaw);
    const y = Math.trunc(yRaw);
    const z = Math.trunc(zRaw);
    const metadata = Math.trunc(data) & 0xF;

    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
        return { valid: false, changed: false };
    }
    if (y < 0 || y >= OFF_GRID_WORLD_HEIGHT) {
        return { valid: false, changed: false };
    }
    if (!Number.isInteger(typeId) || typeId < 0 || !Number.isInteger(data) || data < 0 || data > 15) {
        return { valid: false, changed: false };
    }

    const key = cellKey(x, y, z);
    const existing = field.cells.get(key);

    if (typeId === 0) {
        if (!existing) return { valid: true, changed: false };
        field.cells.delete(key);
        dirty = true;
        return { valid: true, changed: true };
    }

    if (!isValidBlockId(typeId)) {
        return { valid: false, changed: false };
    }
    if (existing && existing.typeId === typeId && existing.data === metadata) {
        return { valid: true, changed: false };
    }
    if (!existing) {
        if (field.cells.size >= OFF_GRID_MAX_CELLS) {
            return { valid: false, changed: false };
        }
        if (!hasNeighborCell(x, y, z)) {
            return { valid: false, changed: false };
        }
    }

    field.cells.set(key, { x, y, z, typeId, data: metadata });
    ensurePivot();
    dirty = true;
    return { valid: true, changed: true };
}

/**
 * Move the whole structure by a (possibly fractional) delta. Whole blocks
 * re-anchor the cells onto the grid; the fractional remainder stays on the
 * pose offset. Out-of-world axes stay purely visual, like the client field.
 *
 * Server-side there is no per-client chunk stream to consult, so a whole
 * block shift always happens when the destination height is valid; clients
 * receive the resulting cells in a snapshot rather than replaying the move.
 */
function applyMove(dx, dy, dz) {
    if (!isFiniteNumber(dx) || !isFiniteNumber(dy) || !isFiniteNumber(dz)) {
        return { shifted: false };
    }
    const bounds = getBounds();
    if (!bounds) return { shifted: false };

    const deltas = { x: dx, y: dy, z: dz };
    let shifted = false;

    for (const axis of ['x', 'y', 'z']) {
        const amount = Math.round(deltas[axis]);
        if (amount === 0) continue;

        const minY = bounds.minY + (axis === 'y' ? amount : 0);
        const maxY = bounds.maxY + (axis === 'y' ? amount : 0);
        if (minY < 0 || maxY >= OFF_GRID_WORLD_HEIGHT) {
            continue;
        }

        const next = new Map();
        for (const cell of field.cells.values()) {
            const nx = cell.x + (axis === 'x' ? amount : 0);
            const ny = cell.y + (axis === 'y' ? amount : 0);
            const nz = cell.z + (axis === 'z' ? amount : 0);
            next.set(cellKey(nx, ny, nz), { x: nx, y: ny, z: nz, typeId: cell.typeId, data: cell.data });
        }
        field.cells = next;

        if (field.pivot !== null) field.pivot[axis] += amount;
        field.offset[axis] -= amount;
        shifted = true;

        // Later axes must use the already-shifted bounds.
        if (axis === 'x') {
            bounds.minX += amount;
            bounds.maxX += amount;
        } else if (axis === 'y') {
            bounds.minY += amount;
            bounds.maxY += amount;
        } else {
            bounds.minZ += amount;
            bounds.maxZ += amount;
        }
    }

    field.offset.x += dx;
    field.offset.y += dy;
    field.offset.z += dz;

    dirty = true;
    return { shifted };
}

/** Accumulate a rotation around one axis of the structure's own centre. */
function applyRotate(degrees, axis) {
    if (!isFiniteNumber(degrees)) return;
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') return;
    field.rotation[axis] += degrees;
    ensurePivot();
    dirty = true;
}

/** Add one ghost-block render for every client. */
function addGhost(x, y, z, typeId, data = 0) {
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return false;
    if (!isValidBlockId(typeId)) return false;
    if (ghosts.length >= OFF_GRID_MAX_GHOSTS) return false;

    const metadata = Math.trunc(data) & 0xF;
    const duplicate = ghosts.some((ghost) =>
        ghost.x === x && ghost.y === y && ghost.z === z &&
        ghost.typeId === typeId && ghost.data === metadata);
    if (duplicate) return true;

    ghosts.push({ x, y, z, typeId, data: metadata });
    dirty = true;
    return true;
}

/** Remove every summoned cell and the pose, leaving ghost renders alone. */
function applyClearField() {
    field.cells = new Map();
    field.rotation = { x: 0, y: 0, z: 0 };
    field.offset = { x: 0, y: 0, z: 0 };
    field.pivot = null;
    dirty = true;
}

/** Remove every summoned cell, every ghost render and the pose. */
function applyClear() {
    applyClearField();
    ghosts = [];
    dirty = true;
}

// ---------------------------------------------------------------------------
// Packet broadcast helpers
// ---------------------------------------------------------------------------

function sendState(player) {
    if (!player || !player.ws || player.ws.readyState !== 1) return;
    player.ws.send(createOffGridStatePacket(getSnapshot()));
}

function broadcastState() {
    const packet = createOffGridStatePacket(getSnapshot());
    for (const player of getPlayers().values()) {
        if (player.ws && player.ws.readyState === 1) {
            player.ws.send(packet);
        }
    }
}

function broadcastUpdate(update) {
    const packet = createOffGridUpdatePacket(update);
    for (const player of getPlayers().values()) {
        if (player.ws && player.ws.readyState === 1) {
            player.ws.send(packet);
        }
    }
}

/**
 * Broadcast a single interactive cell edit. Callers can also use this for the
 * origin player: applying the same update locally is a cheap no-op when the
 * client's prediction already matches.
 */
function broadcastCellEdit(x, y, z, typeId, data) {
    broadcastUpdate({
        action: OFF_GRID_UPDATE_SET_CELL,
        x, y, z, typeId, data
    });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function readStateFile(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || data.version !== OFF_GRID_PROTOCOL_VERSION) {
        return null;
    }
    return data;
}

/**
 * Reset and load the state for a world. The hook runs from initWorld(), which
 * may execute before BlockRegistry.create(), so saved block ids are kept as
 * numbers and only validated when a command or edit uses them.
 */
function loadFromWorld(worldDir) {
    field.cells = new Map();
    field.rotation = { x: 0, y: 0, z: 0 };
    field.offset = { x: 0, y: 0, z: 0 };
    field.pivot = null;
    ghosts = [];
    dirty = false;

    const file = path.join(worldDir, OFF_GRID_FILE);
    if (!fs.existsSync(file)) return;

    try {
        const data = readStateFile(file);
        if (!data) {
            log.warn('OffGrid', `Ignoring incompatible off-grid state in ${file}`);
            return;
        }

        const cells = Array.isArray(data.cells) ? data.cells : [];
        for (const entry of cells) {
            const cell = Array.isArray(entry)
                ? { x: entry[0], y: entry[1], z: entry[2], typeId: entry[3], data: entry[4] }
                : entry;
            if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !Number.isInteger(cell.z)) continue;
            if (cell.y < 0 || cell.y >= OFF_GRID_WORLD_HEIGHT) continue;
            if (!Number.isInteger(cell.typeId) || cell.typeId <= 0) continue;
            const metadata = Number.isInteger(cell.data) ? (cell.data & 0xF) : 0;
            if (field.cells.size >= OFF_GRID_MAX_CELLS) break;
            field.cells.set(cellKey(cell.x, cell.y, cell.z), {
                x: cell.x, y: cell.y, z: cell.z, typeId: cell.typeId, data: metadata
            });
        }

        field.rotation = normalizeRotation(data.rotation);
        field.offset = normalizeOffset(data.offset);
        field.pivot = normalizePivot(data.pivot);
        ensurePivot();

        const loadedGhosts = Array.isArray(data.ghosts) ? data.ghosts : [];
        for (const entry of loadedGhosts) {
            const ghost = Array.isArray(entry)
                ? { x: entry[0], y: entry[1], z: entry[2], typeId: entry[3], data: entry[4] }
                : entry;
            if (!ghost || !isFiniteNumber(ghost.x) || !isFiniteNumber(ghost.y) || !isFiniteNumber(ghost.z)) continue;
            if (!Number.isInteger(ghost.typeId) || ghost.typeId <= 0) continue;
            if (ghosts.length >= OFF_GRID_MAX_GHOSTS) break;
            ghosts.push({
                x: ghost.x, y: ghost.y, z: ghost.z,
                typeId: ghost.typeId,
                data: Number.isInteger(ghost.data) ? (ghost.data & 0xF) : 0
            });
        }

        log.info('OffGrid', `Loaded ${field.cells.size} cell(s) and ${ghosts.length} ghost render(s)`);
    } catch (e) {
        log.warn('OffGrid', `Failed to load ${file}: ${e.message}`);
        field.cells = new Map();
        field.rotation = { x: 0, y: 0, z: 0 };
        field.offset = { x: 0, y: 0, z: 0 };
        field.pivot = null;
        ghosts = [];
    }
}

/** Write the current state if anything changed since the last save. */
function saveToWorld(worldDir) {
    if (!dirty) return;

    const file = path.join(worldDir, OFF_GRID_FILE);
    const tempFile = file + '.tmp';
    const payload = {
        version: OFF_GRID_PROTOCOL_VERSION,
        cells: Array.from(field.cells.values(), (cell) => [cell.x, cell.y, cell.z, cell.typeId, cell.data]),
        rotation: { ...field.rotation },
        offset: { ...field.offset },
        pivot: field.pivot ? { ...field.pivot } : null,
        ghosts: ghosts.map((ghost) => [ghost.x, ghost.y, ghost.z, ghost.typeId, ghost.data])
    };

    try {
        fs.writeFileSync(tempFile, JSON.stringify(payload));
        fs.renameSync(tempFile, file);
        dirty = false;
    } catch (e) {
        try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (cleanupError) {
            // The previous state file is still intact.
        }
        log.error('OffGrid', `Failed to save ${file}: ${e.message}`);
    }
}

registerWorldLifecycle({
    onLoad: (worldName, worldDir) => loadFromWorld(worldDir),
    onSave: (worldName, worldDir) => saveToWorld(worldDir)
});

export {
    getSnapshot,
    getCellCount,
    applyFill,
    applyCellEdit,
    applyMove,
    applyRotate,
    addGhost,
    applyClearField,
    applyClear,
    sendState,
    broadcastState,
    broadcastCellEdit,
    loadFromWorld,
    saveToWorld
};
