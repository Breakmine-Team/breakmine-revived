import { Buffer } from '../../../../../libraries/buffer.js';
import { readLongBE, writeLongBE } from './binary.js';
import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';
import Logger from './logger.js';
import * as worldGen from './WorldGen.js';
import { SubChunkStore, SECTION_DATA_BYTES } from './SubChunkStore.js';

const log = Logger;

const MODULE_DIR = new URL('.', import.meta.url).pathname;
const PROJECT_ROOT = path.join(MODULE_DIR, '..', '..', '..', '..', '..');
const WORLDS_DIR = path.join(PROJECT_ROOT, 'worlds');
const DEFAULT_WORLD_DIR = PROJECT_ROOT;
const DEFAULT_WORLD_FILE = path.join(PROJECT_ROOT, 'world_data.bin');
const CURRENT_WORLD_FILE = path.join(PROJECT_ROOT, 'current_world.txt');

// World file magic + version. v3 stores whole modified subchunks, DEFLATE
// compressed. Files without the magic are the legacy per-block "change list"
// layout, which is still read and transparently upgraded on the next save.
const WORLD_MAGIC = 'BMW3';
const WORLD_VERSION = 3;

const subChunks = new SubChunkStore();
const blockInventories = new Map();
let currentWorldName = 'main';
let worldTime = 0; // In-game time (0-24000 ticks)

// Ensure worlds directory exists
if (!fs.existsSync(WORLDS_DIR)) {
    fs.mkdirSync(WORLDS_DIR, { recursive: true });
}

// Every server owns a self-contained directory. The main server lives in the
// project root (world_data.bin), additional servers live in worlds/<name>/
// and each holds its own world_data.bin plus an optional serverconfig.conf.
function getWorldDir(worldName) {
    if (worldName === 'main') {
        return DEFAULT_WORLD_DIR;
    }
    const sanitized = worldName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return path.join(WORLDS_DIR, sanitized);
}

function getWorldFile(worldName) {
    return path.join(getWorldDir(worldName), 'world_data.bin');
}

function migrateOldWorld(worldName) {
    const worldFile = getWorldFile(worldName);
    if (fs.existsSync(worldFile)) return false;

    // Old flat-file layout: worlds/<name>.bin or worlds/<name>_data.bin. Both
    // are folded into worlds/<name>/world_data.bin so existing worlds survive.
    let oldBin = worldName === 'main'
        ? path.join(PROJECT_ROOT, 'world.bin')
        : path.join(WORLDS_DIR, `${worldName}.bin`);
    if (worldName !== 'main' && !fs.existsSync(oldBin)) {
        const legacyData = path.join(WORLDS_DIR, `${worldName}_data.bin`);
        if (fs.existsSync(legacyData)) {
            oldBin = legacyData;
        }
    }

    if (fs.existsSync(oldBin)) {
        const worldDir = getWorldDir(worldName);
        if (!fs.existsSync(worldDir)) {
            fs.mkdirSync(worldDir, { recursive: true });
        }
        log.info('World', `Migrating ${oldBin} to ${worldFile}`);
        fs.renameSync(oldBin, worldFile);

        const oldChests = oldBin.replace(/\.bin$/, '.chests.json');
        if (fs.existsSync(oldChests)) {
            const chestsData = JSON.parse(fs.readFileSync(oldChests, 'utf8'));
            if (Array.isArray(chestsData)) {
                blockInventories.clear();
                for (const entry of chestsData) {
                    if (entry && entry.key) {
                        blockInventories.set(entry.key, entry.state || entry.inventory || null);
                    }
                }
            }
            fs.unlinkSync(oldChests);
        }
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
//  Legacy format support
//
//  v1/v2 stored a flat list of individual block changes:
//     old: numChanges(4) + changes*11 + numInventories(4) + inventories
//     new: worldTime(8) + numChanges(4) + changes*11 + numInventories(4) + inventories
//  Each change is x(int32) + y(uint8) + z(int32) + blockState(uint16).
//  These are read once and folded into subchunks so the rest of the server only
//  ever deals with one representation.
// ---------------------------------------------------------------------------

function readLayout(data, hasWorldTime) {
    // The change count sits before the records, so the records begin at
    // offset 4 (old) or 12 (new).
    let offset = hasWorldTime ? 8 : 0;
    if (offset + 4 > data.length) return null;

    const declared = data.readUInt32BE(offset);
    offset += 4;

    const available = Math.floor((data.length - offset) / 11);
    const records = Math.min(declared, available);
    offset += records * 11;

    const layout = { declared, records, exact: false };
    if (offset + 4 > data.length) return layout;

    const numInventories = data.readUInt32BE(offset);
    offset += 4;

    for (let i = 0; i < numInventories; i++) {
        if (offset + 2 > data.length) return layout;
        const keyLength = data.readUInt16BE(offset);
        offset += 2;

        if (offset + keyLength + 4 > data.length) return layout;
        offset += keyLength;

        const stateLength = data.readUInt32BE(offset);
        offset += 4;

        if (offset + stateLength > data.length) return layout;
        offset += stateLength;
    }

    layout.exact = offset === data.length;
    return layout;
}

function readInventories(data, offset) {
    let cursor = offset;
    if (cursor + 4 > data.length) return cursor;

    const numInventories = data.readUInt32BE(cursor);
    cursor += 4;

    for (let i = 0; i < numInventories; i++) {
        if (cursor + 2 > data.length) break;
        const keyLength = data.readUInt16BE(cursor);
        cursor += 2;

        if (cursor + keyLength + 4 > data.length) break;
        const key = data.toString('utf8', cursor, cursor + keyLength);
        cursor += keyLength;

        const stateLength = data.readUInt32BE(cursor);
        cursor += 4;

        if (cursor + stateLength > data.length) break;
        const stateStr = data.toString('utf8', cursor, cursor + stateLength);
        cursor += stateLength;

        try {
            blockInventories.set(key, JSON.parse(stateStr));
        } catch (e) {
            log.warn('World', `Failed to parse inventory state for ${key}: ${e.message}`);
        }
    }
    return cursor;
}

/**
 * Loads a legacy change list into the subchunk store. Pick the interpretation
 * that consumes the file cleanly, preferring whichever recovers more records,
 * so a partially written old save still yields the changes it did contain
 * instead of being read as an empty world.
 */
function loadLegacyWorld(data) {
    const asNew = readLayout(data, true);
    const asOld = readLayout(data, false);

    let hasWorldTime;
    if (!asOld) {
        hasWorldTime = true;
    } else if (!asNew) {
        hasWorldTime = false;
    } else if (asNew.exact && !asOld.exact) {
        hasWorldTime = true;
    } else if (asOld.exact && !asNew.exact) {
        hasWorldTime = false;
    } else {
        hasWorldTime = asNew.records >= asOld.records;
    }

    let offset = 0;
    if (hasWorldTime && data.length >= 8) {
        worldTime = Number(readLongBE(data, offset));
        offset += 8;
    } else {
        worldTime = 0;
    }

    if (offset + 4 <= data.length) {
        let totalChanges = data.readUInt32BE(offset);
        offset += 4;

        const expectedDataSize = offset + (totalChanges * 11);
        if (data.length < expectedDataSize) {
            log.warn('World', `World file truncated. Expected ${expectedDataSize} bytes, got ${data.length}`);
            totalChanges = Math.floor((data.length - offset) / 11);
        }

        let applied = 0;
        for (let i = 0; i < totalChanges; i++) {
            if (offset + 11 > data.length) break;
            const x = data.readInt32BE(offset);
            const y = data.readUInt8(offset + 4);
            const z = data.readInt32BE(offset + 5);
            let blockState = data.readUInt16BE(offset + 9);

            // The oldest format stored just blockId, not a blockState.
            if (!hasWorldTime) {
                blockState = (blockState & 0xFF) << 4;
            }

            if (subChunks.writeBlockState(x, y, z, blockState)) applied++;
            offset += 11;
        }
        log.info('World', `Upgraded legacy save: ${applied} block changes folded into ${subChunks.size} subchunks`);
    }

    readInventories(data, offset);
}

// ---------------------------------------------------------------------------
//  v3 format
// ---------------------------------------------------------------------------

function loadV3World(data) {
    let offset = 0;
    const magic = data.toString('ascii', offset, offset + 4);
    offset += 4;
    const version = data.readUInt8(offset);
    offset += 1;
    if (magic !== WORLD_MAGIC) {
        throw new Error('Not a v3 world file');
    }

    worldTime = Number(readLongBE(data, offset));
    offset += 8;

    const numSubChunks = data.readUInt32BE(offset);
    offset += 4;

    let loaded = 0;
    let skipped = 0;
    for (let i = 0; i < numSubChunks; i++) {
        if (offset + 14 > data.length) {
            log.warn('World', `World file truncated after ${loaded}/${numSubChunks} subchunks`);
            break;
        }
        const cx = data.readInt32BE(offset);
        const cz = data.readInt32BE(offset + 4);
        const sy = data.readUInt8(offset + 8);
        const dataLength = data.readUInt32BE(offset + 10);
        offset += 14;

        if (offset + dataLength > data.length) {
            log.warn('World', `Subchunk ${i} payload is truncated, stopping`);
            break;
        }

        const payload = new Uint8Array(data.buffer, data.byteOffset + offset, dataLength);
        if (subChunks.loadSection(cx, cz, sy, payload)) {
            loaded++;
        } else {
            // One corrupt entry must not cost the player the rest of the world.
            skipped++;
        }
        offset += dataLength;
    }

    if (skipped > 0) {
        log.warn('World', `Skipped ${skipped} unreadable subchunk(s)`);
    }
    log.info('World', `Loaded ${loaded} subchunks`);

    readInventories(data, offset);
}

function initWorld(worldName = 'main') {
    subChunks.clear();
    blockInventories.clear();
    currentWorldName = worldName;

    // Save current world name to file
    fs.writeFileSync(CURRENT_WORLD_FILE, worldName);

    const worldDir = getWorldDir(worldName);
    if (!fs.existsSync(worldDir)) {
        fs.mkdirSync(worldDir, { recursive: true });
    }

    const worldFile = getWorldFile(worldName);

    migrateOldWorld(worldName);

    if (!fs.existsSync(worldFile)) {
        log.info('World', `Creating new world (${worldName})...`);
        worldTime = 0;
        return;
    }

    log.info('World', `Loading world (${worldName})...`);
    const data = fs.readFileSync(worldFile);

    const isV3 = data.length >= 5 && data.toString('ascii', 0, 4) === WORLD_MAGIC;
    try {
        if (isV3) {
            loadV3World(data);
        } else {
            loadLegacyWorld(data);
        }
    } catch (e) {
        // A world that cannot be read must not be silently treated as empty:
        // the next save would then overwrite it with a blank one. Report loudly
        // and leave whatever was recovered in place.
        log.error('World', `Failed to load world (${worldName}): ${e.message}`);
    }

    log.info('World', `Finished loading world (${worldName})`);
}

function loadCurrentWorld() {
    if (fs.existsSync(CURRENT_WORLD_FILE)) {
        try {
            const worldName = fs.readFileSync(CURRENT_WORLD_FILE, 'utf8').trim();
            if (worldName) {
                return worldName;
            }
        } catch (e) {
            log.warn('World', `Failed to load current world: ${e.message}`);
        }
    }
    return 'main';
}

function saveWorld() {
    const worldDir = getWorldDir(currentWorldName);
    if (!fs.existsSync(worldDir)) {
        fs.mkdirSync(worldDir, { recursive: true });
    }
    const worldFile = getWorldFile(currentWorldName);

    // Serialize block inventories
    const inventoryEntries = [];
    for (const [key, state] of blockInventories.entries()) {
        const stateBuffer = Buffer.from(JSON.stringify(state), 'utf8');
        const keyBuffer = Buffer.from(key, 'utf8');
        inventoryEntries.push({ keyBuffer, stateBuffer });
    }

    // Every modified subchunk, DEFLATE compressed. Compressing the section
    // itself (rather than a list of edits) is what keeps this cheap: terrain is
    // extremely repetitive, so a section with a handful of edited blocks
    // compresses to a fraction of its 8 KB raw size.
    const sections = subChunks.serializeSections();

    // magic + version + worldTime + numSubChunks
    let totalSize = 4 + 1 + 8 + 4;
    for (const section of sections) {
        totalSize += 14 + section.data.length;
    }
    totalSize += 4; // numInventories
    for (const entry of inventoryEntries) {
        totalSize += 2 + entry.keyBuffer.length + 4 + entry.stateBuffer.length;
    }

    const buffer = Buffer.alloc(totalSize);
    let offset = 0;

    buffer.write(WORLD_MAGIC, offset, 'ascii');
    offset += 4;
    buffer.writeUInt8(WORLD_VERSION, offset);
    offset += 1;

    writeLongBE(worldTime, buffer, offset);
    offset += 8;

    buffer.writeUInt32BE(sections.length, offset);
    offset += 4;

    for (const section of sections) {
        buffer.writeInt32BE(section.cx, offset);
        buffer.writeInt32BE(section.cz, offset + 4);
        buffer.writeUInt8(section.sy, offset + 8);
        buffer.writeUInt8(0, offset + 9); // reserved / flags
        buffer.writeUInt32BE(section.data.length, offset + 10);
        offset += 14;
        buffer.set(section.data, offset);
        offset += section.data.length;
    }

    // Write block inventories
    buffer.writeUInt32BE(inventoryEntries.length, offset);
    offset += 4;

    for (const entry of inventoryEntries) {
        buffer.writeUInt16BE(entry.keyBuffer.length, offset);
        offset += 2;
        entry.keyBuffer.copy(buffer, offset);
        offset += entry.keyBuffer.length;
        buffer.writeUInt32BE(entry.stateBuffer.length, offset);
        offset += 4;
        entry.stateBuffer.copy(buffer, offset);
        offset += entry.stateBuffer.length;
    }

    // Write to a sibling temp file and rename it into place. A rename within
    // the same directory is atomic, so an interrupted save (tab closed, disk
    // full, browser tab killed) can only ever leave the previous world intact
    // -- writing straight to world_data.bin could truncate a good world to a
    // partial file, which is exactly how a save becomes unrecoverable.
    const tempFile = worldFile + '.tmp';
    try {
        fs.writeFileSync(tempFile, buffer);
        fs.renameSync(tempFile, worldFile);
    } catch (e) {
        try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (cleanupError) {
            // Nothing more we can do; the original world is still intact.
        }
        throw e;
    }
    //log.info('World', `World saved (${currentWorldName})`);
}

function addWorldChange(x, y, z, blockId, metadata = 0) {
    // The world only stores y 0-255. Clamp so a block placed/teleported outside
    // that range can never throw. X/Z become int32 chunk coordinates, so clamp
    // those too to survive super-far /tp coordinates.
    const clampedY = Math.max(0, Math.min(255, y));
    const clampedX = Math.max(-2147483648, Math.min(2147483647, x));
    const clampedZ = Math.max(-2147483648, Math.min(2147483647, z));
    const blockState = (blockId << 4) | (metadata & 0xF);
    return subChunks.writeBlockState(clampedX, clampedY, clampedZ, blockState);
}

function getWorldChanges() {
    return subChunks;
}

function getSubChunkStore() {
    return subChunks;
}

function getBlockAt(x, y, z) {
    const blockState = subChunks.readBlockState(x, y, z);
    return blockState !== null ? (blockState >> 4) : worldGen.getBaseBlockAt(x, y, z);
}

function getBlockMetadata(x, y, z) {
    const blockState = subChunks.readBlockState(x, y, z);
    return blockState !== null ? (blockState & 0xF) : 0;
}

function getBlockInventories() {
    return blockInventories;
}

function setBlockInventory(key, state) {
    const existing = blockInventories.get(key);
    if (existing && typeof existing === 'object' && existing.items !== undefined) {
        existing.size = state.size || existing.size;
        if (Array.isArray(state.items)) {
            existing.items = state.items;
        }
        blockInventories.set(key, existing);
    } else {
        blockInventories.set(key, state);
    }
}

function getBlockInventory(key) {
    return blockInventories.get(key);
}

function getAllBlockInventoriesState() {
    return Array.from(blockInventories.entries()).map(([key, state]) => ({ key, state }));
}

function getCurrentWorldName() {
    return currentWorldName;
}

function listWorlds() {
    const worlds = ['main']; // Always include main

    if (fs.existsSync(WORLDS_DIR)) {
        // New layout: worlds/<name>/ holding world_data.bin and/or serverconfig.conf
        const entries = fs.readdirSync(WORLDS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || !/^[a-z0-9_]+$/.test(entry.name)) continue;
            const dir = path.join(WORLDS_DIR, entry.name);
            if (fs.existsSync(path.join(dir, 'world_data.bin')) || fs.existsSync(path.join(dir, 'serverconfig.conf'))) {
                worlds.push(entry.name);
            }
        }

        // Legacy layout: worlds/<name>_data.bin flat files, listed so they can
        // still be entered (which migrates them into the new layout).
        const files = fs.readdirSync(WORLDS_DIR);
        files.forEach(file => {
            if (file.endsWith('_data.bin')) {
                const worldName = file.replace('_data.bin', '');
                if (worldName && !worlds.includes(worldName)) {
                    worlds.push(worldName);
                }
            }
        });
    }

    return worlds;
}

function getWorldTime() {
    return worldTime;
}

function setWorldTime(time) {
    worldTime = time;
}

function deleteBlockInventory(key) {
    blockInventories.delete(key);
}

function tickWorldTime() {
    worldTime = (worldTime + 1) % 24000;
}

function generateFlatChunkColumn(chunkX, chunkZ) {
    return worldGen.generateChunkColumn(chunkX, chunkZ, subChunks);
}

// The configured world type ('flat', 'normal' or 'amplified').
function getWorldType() {
    return worldGen.getWorldType();
}

// Safe spawn position for the configured world type (on the surface, never
// inside a cave opening).
function getSpawnPosition() {
    return worldGen.getSpawnPosition();
}

export {
    initWorld,
    saveWorld,
    addWorldChange,
    getWorldChanges,
    getSubChunkStore,
    getWorldDir,
    getBlockInventories,
    setBlockInventory,
    getBlockInventory,
    getAllBlockInventoriesState,
    getBlockAt,
    getBlockMetadata,
    generateFlatChunkColumn,
    getWorldType,
    getSpawnPosition,
    getCurrentWorldName,
    listWorlds,
    getWorldTime,
    setWorldTime,
    tickWorldTime,
    loadCurrentWorld,
    deleteBlockInventory
};