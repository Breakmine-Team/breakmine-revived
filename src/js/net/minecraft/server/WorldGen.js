import { Buffer } from '../../../../../libraries/buffer.js';
import config from './config.js';
import WorldGenerator from '../client/world/generator/WorldGenerator.js';
import Primer from '../client/world/generator/Primer.js';
import Random from '../util/Random.js';
import Long from '../../../../../libraries/long.js';

let WorldGeneratorClass = WorldGenerator;
let PrimerClass = Primer;
let RandomClass = Random;

const VALID_TYPES = ['flat', 'normal', 'amplified'];

const SECTION_COUNT = 16;
const BLOCK_STATE_SIZE = 4096 * 2;
const NIBBLE_SIZE = 2048;
const SECTION_SIZE = BLOCK_STATE_SIZE + NIBBLE_SIZE + NIBBLE_SIZE;

function normalizeWorldType(worldType) {
    const wt = String(worldType || 'flat').toLowerCase().trim();
    return VALID_TYPES.includes(wt) ? wt : 'flat';
}

function getWorldType() {
    return normalizeWorldType(config.worldType);
}

function seedToLong(seedText) {
    const seed = String(seedText);
    if (seed.length === 0) {
        return new RandomClass().nextLong();
    }
    if (isNaN(seed)) {
        let h = 0;
        for (let i = 0; i < seed.length; i++) {
            h = 31 * h + seed.charCodeAt(i);
        }
        return Long.fromNumber(h);
    }
    return Long.fromString(seed);
}

let cachedGenerator = null;
let cachedGeneratorKey = null;

function getGeneratorKey() {
    return getWorldType() + ':' + seedToLong(config.seed).toString();
}

function getGenerator() {
    if (!WorldGeneratorClass) return null;

    const worldType = getWorldType();
    const seedLong = seedToLong(config.seed);
    const key = worldType + ':' + seedLong.toString();

    if (cachedGenerator && cachedGeneratorKey === key) {
        return cachedGenerator;
    }

    // The generator only uses the world for population (trees/houses) which the
    // server does not run; a stub is enough for terrain generation.
    const world = { seed: seedLong, getBlockAt: () => 0 };
    cachedGenerator = new WorldGeneratorClass(world, seedLong, worldType);
    cachedGeneratorKey = key;
    return cachedGenerator;
}

class ServerChunk {
    constructor() {
        this.blocks = new Uint8Array(16 * 256 * 16);
    }

    getBlockAt(x, y, z) {
        return this.blocks[(y << 8) | (z << 4) | x];
    }

    setBlockAt(x, y, z, typeId) {
        this.blocks[(y << 8) | (z << 4) | x] = typeId;
    }
}

function generateBaseBlocks(chunkX, chunkZ) {
    const generator = getGenerator();
    if (!generator || !PrimerClass) return null;

    const chunk = new ServerChunk();
    const primer = new PrimerClass(chunk);

    // Same per-chunk seed used by the client's newChunk() so both sides
    // produce byte-identical terrain.
    generator.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);
    generator.generateInChunk(chunkX, chunkZ, primer);

    return chunk.blocks;
}

// Cache of pure base terrain. Tree/house placement must read this (never the
// final blocks) so it is deterministic, and reading from cache avoids hitting
// the shared terrain generator mid-population.
const baseCache = new Map();
const BASE_CACHE_MAX = 256;

function getBaseBlocks(chunkX, chunkZ) {
    const key = getGeneratorKey() + ':' + chunkX + ',' + chunkZ;
    let blocks = baseCache.get(key);
    if (blocks) return blocks;

    blocks = generateBaseBlocks(chunkX, chunkZ);
    if (!blocks) return null;

    baseCache.set(key, blocks);
    if (baseCache.size > BASE_CACHE_MAX) {
        const oldestKey = baseCache.keys().next().value;
        baseCache.delete(oldestKey);
    }
    return blocks;
}

class PopulateWorldStub {
    constructor() {
        this.blocks = null;  // final blocks of the chunk being built
        this.targetX = 0;    // chunk we write into
        this.targetZ = 0;
    }

    getBlockAt(x, y, z) {
        if (y < 0 || y >= 256) return 0;
        const blocks = getBaseBlocks(x >> 4, z >> 4);
        if (!blocks) return 0;
        return blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
    }

    setBlockAt(x, y, z, typeId) {
        if (y < 0 || y >= 256) return;
        if ((x >> 4) !== this.targetX || (z >> 4) !== this.targetZ) return;
        this.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] = typeId;
    }

    getHeightAt(x, z) {
        const blocks = getBaseBlocks(x >> 4, z >> 4);
        if (!blocks) return 0;
        const lx = x & 15;
        const lz = z & 15;
        for (let y = 255; y >= 0; y--) {
            if (blocks[(y << 8) | (lz << 4) | lx] !== 0) return y + 1;
        }
        return 0;
    }

    getHighestBlockAt(x, z) {
        return this.getHeightAt(x, z) - 1;
    }
}

let cachedPopulateGenerator = null;
let cachedPopulateGeneratorKey = null;

function getPopulateGenerator() {
    if (!WorldGeneratorClass) return null;

    const worldType = getWorldType();
    const seedLong = seedToLong(config.seed);
    const key = worldType + ':' + seedLong.toString();

    if (cachedPopulateGenerator && cachedPopulateGeneratorKey === key) {
        return cachedPopulateGenerator;
    }

    const world = { seed: seedLong, getBlockAt: () => 0 };
    cachedPopulateGenerator = new WorldGeneratorClass(world, seedLong, worldType);
    cachedPopulateGeneratorKey = key;
    return cachedPopulateGenerator;
}

const populateStub = new PopulateWorldStub();

function generateBlocks(chunkX, chunkZ) {
    const base = getBaseBlocks(chunkX, chunkZ);
    if (!base) return null;

    // Copy the base terrain before population writes into it: the base cache
    // must stay pure so re-running a neighbor's population (for cross-chunk
    // tree spill) always sees the same terrain, regardless of generation order.
    const blocks = new Uint8Array(base);

    const populateGenerator = getPopulateGenerator();
    if (!populateGenerator) return blocks;

    populateStub.blocks = blocks;
    populateStub.targetX = chunkX;
    populateStub.targetZ = chunkZ;
    populateGenerator.world = populateStub;

    for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
            populateGenerator.populateChunk(chunkX + dx, chunkZ + dz);
        }
    }

    return blocks;
}

const blockCache = new Map();
const BLOCK_CACHE_MAX = 64;

function getColumnBlocks(chunkX, chunkZ) {
    if (getWorldType() === 'flat') return null;

    const key = getGeneratorKey() + ':' + chunkX + ',' + chunkZ;
    let blocks = blockCache.get(key);
    if (blocks) return blocks;

    blocks = generateBlocks(chunkX, chunkZ);
    if (!blocks) return null;

    blockCache.set(key, blocks);
    if (blockCache.size > BLOCK_CACHE_MAX) {
        const oldestKey = blockCache.keys().next().value;
        blockCache.delete(oldestKey);
    }
    return blocks;
}

// Flat-world block id for a given height (kept identical to the old server
// flat generator so existing flat worlds stay byte-for-byte unchanged).
function flatBlockId(worldY) {
    if (worldY === 0) return 7;              // Bedrock
    if (worldY >= 1 && worldY <= 7) return 1; // Stone
    if (worldY === 8) return 3;              // Dirt
    if (worldY === 9) return 2;              // Grass
    return 0;                                // Air
}

// Build the full chunk data buffer (same format the server always sent for
// flat worlds) for the configured world type and seed.
//
// `subChunks` is the SubChunkStore holding every modified subchunk. A stored
// section is copied straight into the packet, so what the client receives is
// byte-for-byte what was written to disk. Only sections the player never
// touched are regenerated.
function generateChunkColumn(chunkX, chunkZ, subChunks) {
    const buffer = Buffer.alloc(SECTION_SIZE * SECTION_COUNT + 256);
    const column = getColumnBlocks(chunkX, chunkZ);

    for (let sectionIndexY = 0; sectionIndexY < SECTION_COUNT; sectionIndexY++) {
        const sectionOffset = sectionIndexY * SECTION_SIZE;
        const stored = subChunks ? subChunks.get(chunkX, chunkZ, sectionIndexY) : null;

        if (stored) {
            stored.copy(buffer, sectionOffset, 0, BLOCK_STATE_SIZE);
        } else {
            const baseY = sectionIndexY * 16;
            for (let y = 0; y < 16; y++) {
                const worldY = baseY + y;
                const yBase = worldY << 8;
                for (let z = 0; z < 16; z++) {
                    const zBase = (z << 4);
                    for (let x = 0; x < 16; x++) {
                        // blockIndex indexes the generated column (global y);
                        // localIndex is the position inside this section, which
                        // is where the value has to be written.
                        const blockIndex = yBase | zBase | x;
                        const localIndex = (y << 8) | zBase | x;
                        const id = column ? column[blockIndex] : flatBlockId(worldY);
                        buffer.writeUInt16LE(id << 4, sectionOffset + localIndex * 2);
                    }
                }
            }
        }

        const lightOffset = sectionOffset + BLOCK_STATE_SIZE;
        buffer.fill(0xFF, lightOffset, lightOffset + NIBBLE_SIZE);
        buffer.fill(0xFF, lightOffset + NIBBLE_SIZE, lightOffset + NIBBLE_SIZE * 2);
    }

    buffer.fill(1, SECTION_SIZE * SECTION_COUNT);

    return buffer;
}

// Base block id for unmodified positions, backed by generated terrain so the
// server's block logic (bluestone simulation, neighbor ticks) sees the same
// world the clients do.
function getBaseBlockAt(x, y, z) {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const blocks = getColumnBlocks(cx, cz);
    if (!blocks) {
        return flatBlockId(y);
    }
    return blocks[((y & 255) << 8) | ((z & 15) << 4) | (x & 15)];
}

// Raw generated terrain for a chunk column, or null for flat worlds where the
// column is a pure function of y. The subchunk store uses this to materialize a
// section the first time a block inside it is modified.
function getGeneratedColumn(chunkX, chunkZ) {
    return getColumnBlocks(chunkX, chunkZ);
}

function getFlatBlockId(worldY) {
    return flatBlockId(worldY);
}

// Block ids that are structures rather than terrain: logs and leaves must not
// count as "surface" or spawn would land on top of a tree canopy.
const NON_SURFACE_IDS = new Set([17, 18]); // LOG, LEAVE

// Liquids are never valid ground: the highest column near the origin is often
// the sea floor, and spawning there puts the player straight into the water.
const LIQUID_IDS = new Set([9, 55]); // WATER, LAVA

// How far from the origin to look for dry land. Most worlds find a spot in the
// first radius; the wider ones only matter when the origin sits in an ocean.
const SPAWN_SEARCH_RADII = [16, 32, 64, 96];

// Highest non-air, non-tree block in a generated column at world (x, z).
function getSurfaceTop(x, z, blocks) {
    const lx = x & 15;
    const lz = z & 15;
    for (let y = 255; y >= 0; y--) {
        const id = blocks[(y << 8) | (lz << 4) | lx];
        if (id !== 0 && !NON_SURFACE_IDS.has(id)) return y;
    }
    return 0;
}

function getColumnBlock(blocks, x, y, z) {
    return blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
}

// Top of a column the player can spawn on, or -1 when it cannot: a liquid
// surface, no ground at all, or no room to stand (a trunk or bush overhead).
function getSpawnTop(blocks, x, z, requireDry = true) {
    const top = getSurfaceTop(x, z, blocks);
    if (top <= 1 || top + 2 >= 256) return -1;

    const surface = getColumnBlock(blocks, x, top, z);
    if (requireDry && LIQUID_IDS.has(surface)) return -1;

    if (getColumnBlock(blocks, x, top + 1, z) !== 0) return -1;
    if (getColumnBlock(blocks, x, top + 2, z) !== 0) return -1;

    return top;
}

// Highest usable column within `radius`, or null when there is none.
//
// Chunks are visited one at a time, each fully evaluated before moving on: the
// block caches only hold a few dozen chunks, so walking the block grid row by
// row would evict and regenerate the same chunks over and over.
function findSpawnInRadius(radius, getBlocks, requireDry) {
    let best = null;
    const minChunk = Math.floor(-radius / 16);
    const maxChunk = Math.floor(radius / 16);

    for (let chunkZ = minChunk; chunkZ <= maxChunk; chunkZ++) {
        for (let chunkX = minChunk; chunkX <= maxChunk; chunkX++) {
            const blocks = getBlocks(chunkX, chunkZ);
            if (!blocks) continue;

            for (let lz = 0; lz < 16; lz++) {
                const dz = chunkZ * 16 + lz;
                if (dz < -radius || dz > radius) continue;

                for (let lx = 0; lx < 16; lx++) {
                    const dx = chunkX * 16 + lx;
                    if (dx < -radius || dx > radius) continue;

                    const top = getSpawnTop(blocks, dx, dz, requireDry);
                    if (top < 0) continue;

                    const dist = Math.abs(dx) + Math.abs(dz);
                    if (best === null || top > best.top || (top === best.top && dist < best.dist)) {
                        best = { x: dx, y: top + 1, z: dz, top, dist };
                    }
                }
            }
        }
    }

    return best;
}

// Base terrain only: no caves, ores, trees or plants. Wet or dry is decided by
// the terrain alone (water is filled in below the sea level), and skipping the
// rest keeps the search cheap — population alone runs nine neighbouring chunks
// per chunk.
const probeCache = new Map();
const PROBE_CACHE_MAX = 256;

function getProbeBlocks(chunkX, chunkZ) {
    if (getWorldType() === 'flat') return null;

    const generator = getGenerator();
    if (!generator || !PrimerClass) return null;

    const key = getGeneratorKey() + ':' + chunkX + ',' + chunkZ;
    const cached = probeCache.get(key);
    if (cached) return cached;

    const chunk = new ServerChunk();
    const primer = new PrimerClass(chunk);

    // Same per-chunk seed the full generator uses.
    generator.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);
    generator.generateTerrain(chunkX, chunkZ, primer);
    generator.naturalize(chunkX, chunkZ, primer);

    probeCache.set(key, chunk.blocks);
    if (probeCache.size > PROBE_CACHE_MAX) {
        probeCache.delete(probeCache.keys().next().value);
    }

    return chunk.blocks;
}

// Population adds trees and plants that base terrain does not have, so the
// chosen chunk is checked again with the real blocks and the best free column
// near the candidate is used.
function confirmSpawn(candidate) {
    const chunkX = Math.floor(candidate.x / 16);
    const chunkZ = Math.floor(candidate.z / 16);
    const blocks = getColumnBlocks(chunkX, chunkZ);
    if (!blocks) return null;

    let best = null;
    for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
            const x = chunkX * 16 + lx;
            const z = chunkZ * 16 + lz;
            const top = getSpawnTop(blocks, x, z);
            if (top < 0) continue;

            const dist = Math.abs(x - candidate.x) + Math.abs(z - candidate.z);
            if (best === null || dist < best.dist) {
                best = { x, y: top + 1, z, dist };
            }
        }
    }

    return best === null ? null : { x: best.x, y: best.y, z: best.z };
}

let cachedSpawn = null;
let cachedSpawnKey = null;

function getSpawnPosition() {
    if (getWorldType() === 'flat') {
        return { x: 0, y: 10, z: 0 };
    }

    // The search covers a lot of terrain and only depends on the seed, so
    // remember the answer instead of repeating it for every player that joins.
    const key = getGeneratorKey();
    if (cachedSpawn !== null && cachedSpawnKey === key) {
        return { ...cachedSpawn };
    }

    // Widen the search when the origin is all ocean: a single 16 block radius
    // can only ever answer with the sea floor there.
    let spawn = null;
    for (const radius of SPAWN_SEARCH_RADII) {
        const candidate = findSpawnInRadius(radius, getProbeBlocks, true);
        if (!candidate) continue;

        spawn = confirmSpawn(candidate) || { x: candidate.x, y: candidate.y, z: candidate.z };
        break;
    }

    // Nothing dry anywhere near: fall back to the highest real column, water or
    // not, so the player at least starts at the surface.
    if (!spawn) {
        const fallback = findSpawnInRadius(SPAWN_SEARCH_RADII[0], getColumnBlocks, false);
        spawn = fallback ? { x: fallback.x, y: fallback.y, z: fallback.z } : { x: 0, y: 10, z: 0 };
    }

    cachedSpawn = spawn;
    cachedSpawnKey = key;
    return { ...spawn };
}

export {
    normalizeWorldType,
    getWorldType,
    generateChunkColumn,
    getBaseBlockAt,
    getSpawnPosition,
    getGeneratedColumn,
    getFlatBlockId
};
