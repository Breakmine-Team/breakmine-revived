/*
 * Deterministic overworld column generator shared by the server and the client.
 *
 * The server still needs blocks for physics, spawn checks and block edits, but
 * it no longer has to build the chunks it sends to players: with clientWorldGen
 * it sends a terrain descriptor (type + seed) and every client regenerates the
 * same columns with this module. Both sides must produce identical terrain, so
 * there is exactly one implementation of it here.
 *
 * Generation mirrors the server's original algorithm: a base pass
 * (generateInChunk) followed by the population pass of the eight neighbours,
 * with writes that land outside the target column discarded.
 */
import Primer from "./Primer.js";
import WorldGenerator from "./WorldGenerator.js";
import HellWorldGenerator from "./HellWorldGenerator.js";
import BobWorldGenerator from "./BobWorldGenerator.js";
import IslandsWorldGenerator from "./IslandsWorldGenerator.js";
import Random from "../../../util/Random.js";
import Long from "../../../../../../../libraries/long.js";

export const COLUMN_BLOCK_COUNT = 16 * 256 * 16;

export function seedTextToLong(seedText) {
    const seed = String(seedText ?? "");
    if (seed.length === 0) {
        return new Random().nextLong();
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

export function flatBlockId(worldY) {
    if (worldY === 0) return 7;              // bedrock
    if (worldY >= 1 && worldY <= 7) return 1; // stone
    if (worldY === 8) return 3;              // dirt
    if (worldY === 9) return 2;              // grass
    return 0;
}

function createGenerator(world, seedLong, worldType) {
    if (worldType === "hellish") {
        return new HellWorldGenerator(world, seedLong);
    }
    if (worldType === "bob") {
        return new BobWorldGenerator(world, seedLong, "bob");
    }
    if (worldType === "islands") {
        return new IslandsWorldGenerator(world, seedLong);
    }
    return new WorldGenerator(world, seedLong, worldType);
}

class ColumnChunk {
    constructor() {
        this.blocks = new Uint16Array(COLUMN_BLOCK_COUNT);
    }

    getBlockAt(x, y, z) {
        return this.blocks[(y << 8) | (z << 4) | x];
    }

    setBlockAt(x, y, z, typeId) {
        this.blocks[(y << 8) | (z << 4) | x] = typeId;
    }
}

class PopulateWorldStub {
    constructor() {
        this.blocks = null;
        this.targetX = 0;
        this.targetZ = 0;
        this.worldType = "normal";
        this.seedLong = null;
    }

    // Neighbouring columns are the unpopulated base terrain, exactly like the
    // server's stub, so trees and structures land on the same ground.
    baseBlocks(x, z) {
        return getBaseColumn(this.worldType, this.seedLong, x >> 4, z >> 4);
    }

    getBlockAt(x, y, z) {
        if (y < 0 || y >= 256) return 0;
        const blocks = this.baseBlocks(x, z);
        if (!blocks) return 0;
        return blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
    }

    setBlockAt(x, y, z, typeId) {
        if (y < 0 || y >= 256) return;
        if ((x >> 4) !== this.targetX || (z >> 4) !== this.targetZ) return;
        this.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] = typeId;
    }

    getHeightAt(x, z) {
        const blocks = this.baseBlocks(x, z);
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

// Base columns are reused while a chunk and its neighbours are populated, and
// again when a player walks back over ground they have already seen.
const baseColumns = new Map();
const BASE_CACHE_MAX = 256;
const populateStub = new PopulateWorldStub();

const generatorCache = new Map();

function getGenerator(worldType, seedLong, forPopulate) {
    const key = `${worldType}:${seedLong.toString()}:${forPopulate ? "p" : "b"}`;
    let generator = generatorCache.get(key);
    if (generator === undefined) {
        const world = { seed: seedLong, getBlockAt: () => 0 };
        generator = createGenerator(world, seedLong, worldType);
        generatorCache.set(key, generator);
    }
    return generator;
}

function generateBaseColumn(worldType, seedLong, chunkX, chunkZ) {
    const generator = getGenerator(worldType, seedLong, false);
    const chunk = new ColumnChunk();
    const primer = new Primer(chunk);

    generator.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);
    generator.generateInChunk(chunkX, chunkZ, primer);

    return chunk.blocks;
}

function getBaseColumn(worldType, seedLong, chunkX, chunkZ) {
    const key = `${worldType}:${seedLong.toString()}:${chunkX},${chunkZ}`;
    let blocks = baseColumns.get(key);
    if (blocks !== undefined) {
        return blocks;
    }

    blocks = generateBaseColumn(worldType, seedLong, chunkX, chunkZ);
    baseColumns.set(key, blocks);
    if (baseColumns.size > BASE_CACHE_MAX) {
        const oldest = baseColumns.keys().next().value;
        baseColumns.delete(oldest);
    }
    return blocks;
}

export function generateBaseBlocks(worldType, seedText, chunkX, chunkZ) {
    return getBaseColumn(worldType, seedTextToLong(seedText), chunkX, chunkZ);
}

export function generateColumnBlocks(worldType, seedText, chunkX, chunkZ) {
    const seedLong = seedTextToLong(seedText);
    const blocks = new Uint16Array(getBaseColumn(worldType, seedLong, chunkX, chunkZ));

    const populateGenerator = getGenerator(worldType, seedLong, true);
    populateStub.blocks = blocks;
    populateStub.targetX = chunkX;
    populateStub.targetZ = chunkZ;
    populateStub.worldType = worldType;
    populateStub.seedLong = seedLong;
    populateGenerator.world = populateStub;

    for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
            populateGenerator.populateChunk(chunkX + dx, chunkZ + dz);
        }
    }

    return blocks;
}
