import { Buffer } from '../../../../../libraries/buffer.js';
import config from './config.js';
import WorldGenerator from '../client/world/generator/WorldGenerator.js';
import HellWorldGenerator from '../client/world/generator/HellWorldGenerator.js';
import Primer from '../client/world/generator/Primer.js';
import Random from '../util/Random.js';
import Long from '../../../../../libraries/long.js';

let WorldGeneratorClass = WorldGenerator;
let HellWorldGeneratorClass = HellWorldGenerator;
let PrimerClass = Primer;
let RandomClass = Random;

const VALID_TYPES = ['flat', 'normal', 'amplified', 'hellish'];

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

function createGenerator(world, seedLong, worldType) {
    if (worldType === 'hellish' && HellWorldGeneratorClass) {
        return new HellWorldGeneratorClass(world, seedLong);
    }
    return new WorldGeneratorClass(world, seedLong, worldType);
}

let cachedGenerator = null;
let cachedGeneratorKey = null;

function getGeneratorKey(worldType = getWorldType()) {
    return worldType + ':' + seedToLong(config.seed).toString();
}

function getGenerator(worldType = getWorldType()) {
    if (!WorldGeneratorClass) return null;

    const seedLong = seedToLong(config.seed);
    const key = worldType + ':' + seedLong.toString();

    if (cachedGenerator && cachedGeneratorKey === key) {
        return cachedGenerator;
    }

    const world = { seed: seedLong, getBlockAt: () => 0 };
    cachedGenerator = createGenerator(world, seedLong, worldType);
    cachedGeneratorKey = key;
    return cachedGenerator;
}




class ServerChunk {
    constructor() {
        this.blocks = new Uint16Array(16 * 256 * 16);
    }

    getBlockAt(x, y, z) {
        return this.blocks[(y << 8) | (z << 4) | x];
    }

    setBlockAt(x, y, z, typeId) {
        this.blocks[(y << 8) | (z << 4) | x] = typeId;
    }
}

function generateBaseBlocks(chunkX, chunkZ, worldType = getWorldType()) {
    const generator = getGenerator(worldType);
    if (!generator || !PrimerClass) return null;

    const chunk = new ServerChunk();
    const primer = new PrimerClass(chunk);

    generator.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);
    generator.generateInChunk(chunkX, chunkZ, primer);

    return chunk.blocks;
}




const baseCache = new Map();
const BASE_CACHE_MAX = 256;

function getBaseBlocks(chunkX, chunkZ, worldType = getWorldType()) {
    const key = getGeneratorKey(worldType) + ':' + chunkX + ',' + chunkZ;
    let blocks = baseCache.get(key);
    if (blocks) return blocks;

    blocks = generateBaseBlocks(chunkX, chunkZ, worldType);
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
        this.blocks = null;  
        this.targetX = 0;    
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

function getPopulateGenerator(worldType = getWorldType()) {
    if (!WorldGeneratorClass) return null;

    const seedLong = seedToLong(config.seed);
    const key = worldType + ':' + seedLong.toString();

    if (cachedPopulateGenerator && cachedPopulateGeneratorKey === key) {
        return cachedPopulateGenerator;
    }

    const world = { seed: seedLong, getBlockAt: () => 0 };
    cachedPopulateGenerator = createGenerator(world, seedLong, worldType);
    cachedPopulateGeneratorKey = key;
    return cachedPopulateGenerator;
}

const populateStub = new PopulateWorldStub();

function generateBlocks(chunkX, chunkZ, worldType = getWorldType()) {
    const base = getBaseBlocks(chunkX, chunkZ, worldType);
    if (!base) return null;

    const blocks = new Uint16Array(base);

    const populateGenerator = getPopulateGenerator(worldType);
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

function getColumnBlocks(chunkX, chunkZ, worldType = getWorldType()) {
    if (worldType === 'flat') return null;

    const key = getGeneratorKey(worldType) + ':' + chunkX + ',' + chunkZ;
    let blocks = blockCache.get(key);
    if (blocks) return blocks;

    blocks = generateBlocks(chunkX, chunkZ, worldType);
    if (!blocks) return null;

    blockCache.set(key, blocks);
    if (blockCache.size > BLOCK_CACHE_MAX) {
        const oldestKey = blockCache.keys().next().value;
        blockCache.delete(oldestKey);
    }
    return blocks;
}



function flatBlockId(worldY) {
    if (worldY === 0) return 7;              
    if (worldY >= 1 && worldY <= 7) return 1; 
    if (worldY === 8) return 3;              
    if (worldY === 9) return 2;              
    return 0;                                
}








function generateChunkColumn(chunkX, chunkZ, subChunks, worldType = getWorldType()) {
    const buffer = Buffer.alloc(SECTION_SIZE * SECTION_COUNT + 256);
    const column = getColumnBlocks(chunkX, chunkZ, worldType);

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




function getBaseBlockAt(x, y, z, worldType = getWorldType()) {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const blocks = getColumnBlocks(cx, cz, worldType);
    if (!blocks) {
        return flatBlockId(y);
    }
    return blocks[((y & 255) << 8) | ((z & 15) << 4) | (x & 15)];
}




function getGeneratedColumn(chunkX, chunkZ, worldType = getWorldType()) {
    return getColumnBlocks(chunkX, chunkZ, worldType);
}

function getFlatBlockId(worldY) {
    return flatBlockId(worldY);
}



const NON_SURFACE_IDS = new Set([17, 18]); 



const LIQUID_IDS = new Set([9, 55]); 



const SPAWN_SEARCH_RADII = [16, 32, 64, 96];


function getSurfaceTop(x, z, blocks, worldType = getWorldType()) {
    const lx = x & 15;
    const lz = z & 15;

    const topY = worldType === 'hellish' && HellWorldGeneratorClass
        ? HellWorldGeneratorClass.SPAWN_SCAN_TOP
        : 255;

    for (let y = topY; y >= 0; y--) {
        const id = blocks[(y << 8) | (lz << 4) | lx];
        if (id !== 0 && !NON_SURFACE_IDS.has(id)) return y;
    }
    return 0;
}

function getColumnBlock(blocks, x, y, z) {
    return blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
}



function getSpawnTop(blocks, x, z, requireDry = true, worldType = getWorldType()) {
    const top = getSurfaceTop(x, z, blocks, worldType);
    if (top <= 1 || top + 2 >= 256) return -1;

    const surface = getColumnBlock(blocks, x, top, z);
    if (requireDry && LIQUID_IDS.has(surface)) return -1;

    if (getColumnBlock(blocks, x, top + 1, z) !== 0) return -1;
    if (getColumnBlock(blocks, x, top + 2, z) !== 0) return -1;

    return top;
}






function findSpawnInRadius(radius, getBlocks, requireDry, worldType = getWorldType()) {
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

                    const top = getSpawnTop(blocks, dx, dz, requireDry, worldType);
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





const probeCache = new Map();
const PROBE_CACHE_MAX = 256;

function getProbeBlocks(chunkX, chunkZ, worldType = getWorldType()) {
    if (worldType === 'flat') return null;

    const generator = getGenerator(worldType);
    if (!generator || !PrimerClass) return null;

    const key = getGeneratorKey(worldType) + ':' + chunkX + ',' + chunkZ;
    const cached = probeCache.get(key);
    if (cached) return cached;

    const chunk = new ServerChunk();
    const primer = new PrimerClass(chunk);

    generator.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);
    generator.generateTerrain(chunkX, chunkZ, primer);

    if (worldType !== 'hellish') {
        generator.naturalize(chunkX, chunkZ, primer);
    }

    probeCache.set(key, chunk.blocks);
    if (probeCache.size > PROBE_CACHE_MAX) {
        probeCache.delete(probeCache.keys().next().value);
    }

    return chunk.blocks;
}




function confirmSpawn(candidate, worldType = getWorldType()) {
    const chunkX = Math.floor(candidate.x / 16);
    const chunkZ = Math.floor(candidate.z / 16);
    const blocks = getColumnBlocks(chunkX, chunkZ, worldType);
    if (!blocks) return null;

    let best = null;
    for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
            const x = chunkX * 16 + lx;
            const z = chunkZ * 16 + lz;
            const top = getSpawnTop(blocks, x, z, true, worldType);
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

const altSpawnCache = new Map();

function getSpawnPositionFor(worldType) {
    if (worldType === 'flat') {
        return { x: 0, y: 10, z: 0 };
    }

    const cached = altSpawnCache.get(worldType);
    if (cached) return cached;

    for (const radius of [16, 32, 64, 96]) {
        const candidate = findSpawnInRadius(radius, (cx, cz) => getProbeBlocks(cx, cz, worldType), true, worldType);
        if (candidate) {
            const spawn = confirmSpawn(candidate, worldType) || { x: candidate.x, y: candidate.y, z: candidate.z };
            altSpawnCache.set(worldType, spawn);
            return spawn;
        }
    }

    const fallback = findSpawnInRadius(96, (cx, cz) => getColumnBlocks(cx, cz, worldType), false, worldType);
    const spawn = fallback ? { x: fallback.x, y: fallback.y, z: fallback.z } : { x: 0, y: 64, z: 0 };
    altSpawnCache.set(worldType, spawn);
    return spawn;
}

function getSpawnPosition(worldType = getWorldType()) {
    if (worldType !== getWorldType()) {
        return getSpawnPositionFor(worldType);
    }
    if (getWorldType() === 'flat') {
        return { x: 0, y: 10, z: 0 };
    }

    const key = getGeneratorKey();
    if (cachedSpawn !== null && cachedSpawnKey === key) {
        return { ...cachedSpawn };
    }

    let spawn = null;
    for (const radius of SPAWN_SEARCH_RADII) {
        const candidate = findSpawnInRadius(radius, getProbeBlocks, true);
        if (!candidate) continue;

        spawn = confirmSpawn(candidate) || { x: candidate.x, y: candidate.y, z: candidate.z };
        break;
    }

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
