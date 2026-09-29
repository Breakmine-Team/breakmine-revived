import { Buffer } from '../../../../../libraries/buffer.js';
import { readLongBE, writeLongBE } from './binary.js';
import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';
import Logger from './logger.js';
import * as worldGen from './WorldGen.js';

const log = Logger;

const MODULE_DIR = new URL('.', import.meta.url).pathname;
const PROJECT_ROOT = path.join(MODULE_DIR, '..', '..', '..', '..', '..');
const WORLDS_DIR = path.join(PROJECT_ROOT, 'worlds');
const DEFAULT_WORLD_DIR = PROJECT_ROOT;
const DEFAULT_WORLD_FILE = path.join(PROJECT_ROOT, 'world_data.bin');
const CURRENT_WORLD_FILE = path.join(PROJECT_ROOT, 'current_world.txt');

// Ensure worlds directory exists
if (!fs.existsSync(WORLDS_DIR)) {
    fs.mkdirSync(WORLDS_DIR, { recursive: true });
}

const worldChanges = new Map();
const blockInventories = new Map();
let currentWorldName = 'main';
let worldTime = 0; // In-game time (0-24000 ticks)

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

// Try to read `data` as a world file in the given format, and report how well
// it fits. Returns null when the file is too short to even hold a header.
//
//   old: numChanges(4) + changes*11 + numInventories(4) + inventories
//   new: worldTime(8) + numChanges(4) + changes*11 + numInventories(4) + inventories
//
// `records` is how many whole 11-byte change records the file can actually
// yield -- a declared count larger than that is treated as a partial write.
// `exact` means the parse consumed the file to its last byte.
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

function initWorld(worldName = 'main') {
    // Clear current world data
    worldChanges.clear();
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

    if (fs.existsSync(worldFile)) {
        log.info('World', `Loading world (${worldName})...`);
        const data = fs.readFileSync(worldFile);
        let offset = 0;

        // Pick the format by actually parsing the file as one, not by
        // arithmetic on its length.
        //
        // Two past attempts were wrong:
        //  - `(data.length - 4) % 11 !== 0` only holds while nothing follows
        //    the changes. Block inventories are appended after them, so any
        //    world holding a chest or a sign failed the test and was read as
        //    new format: it skipped 8 bytes it should not, read the change
        //    count out of the middle of a change record and decoded every
        //    coordinate from a misaligned offset. That produced the
        //    "Expected 35385180304 bytes" warning, coordinates like
        //    -1123845905,191 and unregistered block ids that the client draws
        //    as stone -- a world full of water came back as stone.
        //  - Testing only the declared change count was worse: the high 4
        //    bytes of the world-time field are 0 for any sane world, so a
        //    truncated new-format file looked exactly like an old-format file
        //    declaring "0 changes". It loaded as an EMPTY world, and the very
        //    next save overwrote the player's world with nothing.
        //
        // So read the whole file under both interpretations and keep the one
        // that consumes it cleanly, preferring whichever recovers more whole
        // records. That keeps legacy worlds working, keeps truncated saves
        // recoverable instead of empty, and never turns a non-empty file into
        // an empty world.
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
            // Neither consumed the file end to end (a partial write), so take
            // whichever recovers more records. Ties go to the new format,
            // which is the only one saveWorld ever writes.
            hasWorldTime = asNew.records >= asOld.records;
        }

        if (hasWorldTime && data.length >= 8) {
            // Read world time (new format)
            worldTime = Number(readLongBE(data, offset));
            offset += 8;
        } else {
            // Old format, no world time
            worldTime = 0;
        }

        if (data.length >= offset + 4) {
            let totalChanges = data.readUInt32BE(offset);
            offset += 4;

            // Validate that we have enough data for the declared number of changes
            const expectedDataSize = offset + (totalChanges * 11);
            if (data.length < expectedDataSize) {
                log.warn('World', `World file corrupted or incomplete. Expected ${expectedDataSize} bytes, got ${data.length}`);
                totalChanges = Math.floor((data.length - offset) / 11);
            }

            for (let i = 0; i < totalChanges; i++) {
                if (offset + 11 > data.length) {
                    log.warn('World', `Unexpected end of world file while reading changes`);
                    break;
                }
                const x = data.readInt32BE(offset);
                const y = data.readUInt8(offset + 4);
                const z = data.readInt32BE(offset + 5);
                let blockState = data.readUInt16BE(offset + 9);

                // Convert old format (blockId only) to new format (blockState)
                if (!hasWorldTime) {
                    // Old format stored just blockId, convert to blockState (blockId << 4)
                    blockState = (blockState & 0xFF) << 4;
                }

                worldChanges.set(`${x},${y},${z}`, blockState);
                offset += 11;
            }
        }

        // Read block inventories from binary file (if present)
        if (offset + 4 <= data.length) {
            const numInventories = data.readUInt32BE(offset);
            offset += 4;

            for (let i = 0; i < numInventories; i++) {
                if (offset + 2 > data.length) break;
                const keyLength = data.readUInt16BE(offset);
                offset += 2;

                if (offset + keyLength + 4 > data.length) break;
                const key = data.toString('utf8', offset, offset + keyLength);
                offset += keyLength;

                const stateLength = data.readUInt32BE(offset);
                offset += 4;

                if (offset + stateLength > data.length) break;
                const stateStr = data.toString('utf8', offset, offset + stateLength);
                offset += stateLength;

                try {
                    const state = JSON.parse(stateStr);
                    blockInventories.set(key, state);
                } catch (e) {
                    log.warn('World', `Failed to parse inventory state for ${key}: ${e.message}`);
                }
            }
        }

        log.info('World', `Finished loading world (${worldName})`);
    } else {
        log.info('World', `Creating new world (${worldName})...`);
        worldTime = 0; // Reset time for new world
    }
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

    // Calculate total buffer size
    let totalSize = 8 + 4 + (worldChanges.size * 11) + 4; // header + changes + numInventories
    for (const entry of inventoryEntries) {
        totalSize += 2 + entry.keyBuffer.length + 4 + entry.stateBuffer.length;
    }

    const buffer = Buffer.alloc(totalSize);
    let offset = 0;

    // Write world time
    writeLongBE(worldTime, buffer, offset);
    offset += 8;

    // Write number of block changes
    buffer.writeUInt32BE(worldChanges.size, offset);
    offset += 4;

    // Write block changes
    for (const [coords, blockState] of worldChanges.entries()) {
        const [x, y, z] = coords.split(',').map(Number);
        const clampedY = Math.max(0, Math.min(255, y));
        buffer.writeInt32BE(x, offset);
        buffer.writeUInt8(clampedY, offset + 4);
        buffer.writeInt32BE(z, offset + 5);
        buffer.writeUInt16BE(blockState, offset + 9);
        offset += 11;
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
    // The world file stores y as a single unsigned byte and chunk generation
    // only covers y 0-255. Clamp so a block placed/teleported outside that
    // range can never make saveWorld() throw ERR_OUT_OF_RANGE. X/Z are stored
    // as int32, so clamp those too to survive super-far /tp coordinates.
    const clampedY = Math.max(0, Math.min(255, y));
    const clampedX = Math.max(-2147483648, Math.min(2147483647, x));
    const clampedZ = Math.max(-2147483648, Math.min(2147483647, z));
    const blockState = (blockId << 4) | (metadata & 0xF);
    worldChanges.set(`${clampedX},${clampedY},${clampedZ}`, blockState);
}

function getWorldChanges() {
    return worldChanges;
}

function getBlockAt(x, y, z) {
    const key = `${x},${y},${z}`;
    const blockState = worldChanges.get(key);
    return blockState !== undefined ? (blockState >> 4) : worldGen.getBaseBlockAt(x, y, z);
}

function getBlockMetadata(x, y, z) {
    const key = `${x},${y},${z}`;
    const blockState = worldChanges.get(key);
    return blockState !== undefined ? (blockState & 0xF) : 0;
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

function generateFlatChunkColumn(chunkX, chunkZ, worldChanges) {
    return worldGen.generateChunkColumn(chunkX, chunkZ, worldChanges);
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