import Random from "../../../util/Random.js";
import Long from "../../../../../../../libraries/long.js";
import WorldGenerator from "../generator/WorldGenerator.js";
import FlatWorldGenerator from "../generator/FlatWorldGenerator.js";
import {BlockRegistry} from "../block/BlockRegistry.js";

const WORLD_TOTAL_HEIGHT = 256;
const SECTION_SIZE = 16;

class BlockStub {
    constructor(id, opts = {}) {
        this.id = id;
        this._opacity = opts.opacity ?? 1.0;
        this._lightValue = opts.lightValue ?? 0;
        this._solid = opts.solid ?? true;
    }
    getId() { return this.id; }
    getOpacity() { return this._opacity; }
    getLightValue() { return this._lightValue; }
    isSolid() { return this._solid; }
    isTranslucent() { return false; }
}

const BLOCK_STUBS = {
    0: null,
    1: new BlockStub(1),                           // STONE
    2: new BlockStub(2),                           // GRASS
    3: new BlockStub(3),                           // DIRT
    7: new BlockStub(7),                           // BEDROCK
    9: new BlockStub(9, { opacity: 0.01, solid: false }), // WATER
    12: new BlockStub(12),                         // SAND
    13: new BlockStub(13),                         // GRAVEL
    17: new BlockStub(17),                         // LOG
    18: new BlockStub(18),                         // LEAVE
    20: new BlockStub(20, { opacity: 0 }),         // GLASS
    21: new BlockStub(21),                         // GOLD_ORE
    22: new BlockStub(22),                         // DIAMOND_ORE
    23: new BlockStub(23),                         // COAL_ORE
    24: new BlockStub(24),                         // IRON_ORE
    30: new BlockStub(30),                         // EMERALD_ORE
    55: new BlockStub(55, { opacity: 0.01, lightValue: 15, solid: false }), // LAVA
};

const _defaultBlock = new BlockStub(0);
const Block = {
    getById(id) { return BLOCK_STUBS[id] || (id !== 0 ? _defaultBlock : null); },
    sounds: {},
};

const EnumSkyBlock = { SKY: 0, BLOCK: 1 };

if (!BlockRegistry.init) {
    BlockRegistry.create();
}

class ChunkSectionStub {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.blocks = [];
        this.blocksData = [];
        this.blockLight = [];
        this.skyLight = [];
        this.empty = true;
    }

    getBlockAt(x, y, z) {
        const index = y << 8 | z << 4 | x;
        return !this.empty && index in this.blocks ? this.blocks[index] : 0;
    }

    setBlockAt(x, y, z, typeId) {
        const index = y << 8 | z << 4 | x;
        this.blocks[index] = typeId;
        if (this.empty && typeId !== 0) this.empty = false;
    }

    setBlockDataAt(x, y, z, data) {
        this.blocksData[y << 8 | z << 4 | x] = data;
    }

    setLightAt(sourceType, x, y, z, lightLevel) {
        const index = y << 8 | z << 4 | x;
        if (sourceType === EnumSkyBlock.SKY) this.skyLight[index] = lightLevel;
        if (sourceType === EnumSkyBlock.BLOCK) this.blockLight[index] = lightLevel;
    }

    getLightAt(sourceType, x, y, z) {
        const index = y << 8 | z << 4 | x;
        if (sourceType === EnumSkyBlock.SKY) {
            return index in this.skyLight ? this.skyLight[index] : (this.empty ? 15 : 14);
        }
        if (sourceType === EnumSkyBlock.BLOCK) {
            return index in this.blockLight ? this.blockLight[index] : 0;
        }
        return 0;
    }

    isEmpty() { return this.empty; }
}

class ChunkStub {
    constructor(world, x, z) {
        this.x = x;
        this.z = z;
        this.loaded = false;
        this.isTerrainPopulated = false;

        this.sections = [];
        for (let y = 0; y < WORLD_TOTAL_HEIGHT / SECTION_SIZE; y++) {
            this.sections[y] = new ChunkSectionStub(x, y, z);
        }

        this.heightMap = [];
    }

    getSection(y) {
        if (y < 0 || y >= this.sections.length) return null;
        return this.sections[y];
    }

    getBlockAt(x, y, z) {
        return this.getSection(y >> 4).getBlockAt(x, y & 15, z);
    }

    setBlockAt(x, y, z, typeId) {
        if (y < 0 || y >= WORLD_TOTAL_HEIGHT) return;
        this.getSection(y >> 4).setBlockAt(x, y & 15, z, typeId);
    }

    setLightAt(sourceType, x, y, z, level) {
        this.getSection(y >> 4).setLightAt(sourceType, x, y & 15, z, level);
    }

    setHeightAt(x, z, height) {
        this.heightMap[z << 4 | x] = height;
    }

    getHeightAt(x, z) {
        return this.heightMap[z << 4 | x];
    }

    getHighestBlockAt(x, z) {
        return this.getHeightAt(x, z) - 1;
    }

    calculateHeightAt(x, z, startY) {
        let y = startY;
        let iterations = 0;
        while (y > 0 && iterations < 256) {
            const typeId = this.getBlockAt(x, y - 1, z);
            const block = Block.getById(typeId);
            const opacity = typeId === 0 || block === null ? 0 : block.getOpacity();
            if (opacity !== 0) break;
            y--;
            iterations++;
        }
        return y;
    }

    generateSkylightMap() {
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                this.setHeightAt(x, z, 0);
                this.updateHeightMap(x, WORLD_TOTAL_HEIGHT, z);
            }
        }
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                this.notifyNeighbors(x, z);
            }
        }
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                const height = this.getHeightAt(x, z);
                for (let y = height; y < WORLD_TOTAL_HEIGHT; y++) {
                    this.setLightAt(EnumSkyBlock.SKY, x, y, z, 15);
                }
            }
        }
        this.setModifiedAllSections();
    }

    generateBlockLightMap() {
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                for (let y = 0; y < WORLD_TOTAL_HEIGHT; y++) {
                    const section = this.getSection(y >> 4);
                    const typeId = section.getBlockAt(x, y & 15, z);
                    const block = Block.getById(typeId);
                    const blockLight = typeId === 0 ? 0 : block.getLightValue(null, 0, 0, 0);
                    if (blockLight > 0) {
                        section.setLightAt(EnumSkyBlock.BLOCK, x, y & 15, z, blockLight);
                    }
                }
            }
        }
        this.setModifiedAllSections();
    }

    updateHeightMap(relX, y, relZ) {
        let currentHighestY = this.getHeightAt(relX, relZ);
        let highestY = y > currentHighestY ? y : currentHighestY;
        highestY = this.calculateHeightAt(relX, relZ, highestY);
        if (highestY === currentHighestY) return;
        this.setHeightAt(relX, relZ, highestY);

        if (highestY < currentHighestY) {
            for (let hy = highestY; hy < currentHighestY; hy++) {
                this.setLightAt(EnumSkyBlock.SKY, relX, hy, relZ, 15);
            }
        } else {
            for (let hy = currentHighestY; hy < highestY; hy++) {
                this.setLightAt(EnumSkyBlock.SKY, relX, hy, relZ, 0);
            }
        }

        let lightLevel = 15;
        let h = highestY;
        let iterations = 0;
        while (h > 0 && lightLevel > 0 && iterations < 256) {
            h--;
            const typeId = this.getBlockAt(relX, h, relZ);
            const block = Block.getById(typeId);
            let opacity = Math.floor(typeId === 0 ? 0 : block.getOpacity() * 255);
            if (opacity === 0) opacity = 1;
            lightLevel -= opacity;
            if (lightLevel < 0) lightLevel = 0;
            this.setLightAt(EnumSkyBlock.SKY, relX, h, relZ, lightLevel);
            iterations++;
        }

        const calculated = this.calculateHeightAt(relX, relZ, highestY);
        if (calculated !== highestY) {
            this.setHeightAt(relX, relZ, calculated);
        }
        this.setModifiedAllSections();
    }

    notifyNeighbors(x, z) {
        const height = this.getHeightAt(x, z);
        const totalX = this.x * 16 + x;
        const totalZ = this.z * 16 + z;
        this.updateSkyLight(totalX - 1, totalZ, height);
        this.updateSkyLight(totalX + 1, totalZ, height);
        this.updateSkyLight(totalX, totalZ - 1, height);
        this.updateSkyLight(totalX, totalZ + 1, height);
    }

    updateSkyLight(worldX, worldZ, y) {
        const localX = worldX & 15;
        const localZ = worldZ & 15;
        const height = this.getHeightAt(localX, localZ);
        if (height > y) {
            for (let hy = y; hy < height; hy++) {
                const section = this.getSection(hy >> 4);
                if (section) section.setLightAt(EnumSkyBlock.SKY, localX, hy & 15, localZ, 15);
            }
        } else if (height < y) {
            for (let hy = height; hy < y; hy++) {
                const section = this.getSection(hy >> 4);
                if (section) section.setLightAt(EnumSkyBlock.SKY, localX, hy & 15, localZ, 0);
            }
        }
        this.setModifiedAllSections();
    }

    setModifiedAllSections() {
        for (let y = 0; y < this.sections.length; y++) {
            this.sections[y].isModified = true;
        }
    }

    getLightAt(sourceType, x, y, z) {
        return this.getSection(y >> 4).getLightAt(sourceType, x, y & 15, z);
    }

    getTotalLightAt(x, y, z) {
        const section = this.getSection(y >> 4);
        const skyLight = (section.getLightAt(EnumSkyBlock.SKY, x, y & 15, z)) - 0;
        const blockLight = section.getLightAt(EnumSkyBlock.BLOCK, x, y & 15, z);
        return blockLight > skyLight ? blockLight : skyLight;
    }

    isHighestBlock(x, y, z) {
        return y >= this.getHighestBlockAt(x, z);
    }

    isAboveGround(x, y, z) {
        return y >= this.getHeightAt(x, z);
    }

    isLoaded() { return this.loaded; }
    isEmpty() { return true; }
}

class WorldStub {
    constructor() {
        this.chunks = new Map();
        this.skylightSubtracted = 0;
    }

    getChunkAt(cx, cz) {
        return this.chunks.get(cx + (cz << 16)) || null;
    }

    chunkExists(cx, cz) {
        return this.chunks.has(cx + (cz << 16));
    }

    addChunk(chunk) {
        this.chunks.set(chunk.x + (chunk.z << 16), chunk);
    }

    getBlockAt(x, y, z) {
        if (y < 0 || y >= WORLD_TOTAL_HEIGHT) return 0;
        const chunk = this.getChunkAt(x >> 4, z >> 4);
        if (!chunk) return 0;
        return chunk.getBlockAt(x & 15, y, z & 15);
    }

    setBlockAt(x, y, z, typeId) {
        if (y < 0 || y >= WORLD_TOTAL_HEIGHT) return;
        const chunk = this.getChunkAt(x >> 4, z >> 4);
        if (chunk) chunk.setBlockAt(x & 15, y, z & 15, typeId);
    }

    getHeightAt(x, z) {
        const chunk = this.getChunkAt(x >> 4, z >> 4);
        if (!chunk) return 0;
        return chunk.getHeightAt(x & 15, z & 15);
    }

    getHighestBlockAt(x, z) {
        const chunk = this.getChunkAt(x >> 4, z >> 4);
        if (!chunk) return 0;
        return chunk.getHighestBlockAt(x & 15, z & 15);
    }

    blockExists(x, y, z) {
        return y >= 0 && y < WORLD_TOTAL_HEIGHT && this.chunkExists(x >> 4, z >> 4);
    }

    updateLight() {
        // Cross-chunk light propagation is handled by the main thread
    }

    onBlockChanged() {}

    getChunkAtBlock(x, y, z) {
        const chunk = this.getChunkAt(x >> 4, z >> 4);
        if (!chunk) return null;
        return chunk.getSection(y >> 4);
    }

    getSavedLightValue(sourceType, x, y, z) {
        if (!this.blockExists(x, y, z)) return 15;
        const section = this.getChunkAtBlock(x, y, z);
        return section ? section.getLightAt(sourceType, x & 15, y & 15, z & 15) : 15;
    }
}

function serializeChunk(chunk) {
    const sectionCount = WORLD_TOTAL_HEIGHT / SECTION_SIZE;
    const sections = [];
    let sectionMask = 0;

    for (let y = 0; y < sectionCount; y++) {
        const section = chunk.sections[y];
        if (!section.isEmpty()) {
            sectionMask |= 1 << y;

            const blocks = new Uint16Array(4096);
            const blocksData = new Uint8Array(4096);
            const blockLight = new Uint8Array(2048);
            const skyLight = new Uint8Array(2048);

            for (let i = 0; i < 4096; i++) {
                blocks[i] = section.blocks[i] || 0;
                blocksData[i] = section.blocksData[i] || 0;
            }

            for (let i = 0; i < 4096; i++) {
                const byteIndex = i >> 1;
                const isHigh = (i & 1) === 0;
                const bl = section.blockLight[i] || 0;
                const sl = section.skyLight[i] || 0;
                if (isHigh) {
                    blockLight[byteIndex] |= (bl & 0xF) << 4;
                    skyLight[byteIndex] |= (sl & 0xF) << 4;
                } else {
                    blockLight[byteIndex] |= bl & 0xF;
                    skyLight[byteIndex] |= sl & 0xF;
                }
            }

            sections[y] = { blocks, blocksData, blockLight, skyLight };
        }
    }

    const heightMap = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        heightMap[i] = chunk.heightMap[i] || 0;
    }

    return { x: chunk.x, z: chunk.z, sectionMask, sections, heightMap };
}

function generateChunks(chunkCoords, seedData, worldType, onProgress) {
    const seed = Long.fromBits(seedData.low, seedData.high);
    const world = new WorldStub();
    const generator = worldType === "flat"
        ? new FlatWorldGenerator(world, seed)
        : new WorldGenerator(world, seed, worldType);

    // Collect all chunk coordinates that need to be populated (requested + 1-ring neighbors)
    const populateKeys = new Set();
    const populateCoords = [];
    for (const [cx, cz] of chunkCoords) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const px = cx + dx;
                const pz = cz + dz;
                const key = `${px},${pz}`;
                if (!populateKeys.has(key)) {
                    populateKeys.add(key);
                    populateCoords.push([px, pz]);
                }
            }
        }
    }

    // Collect base-terrain chunks (populated chunks + their 1-ring neighbors), deduped
    const generateKeys = new Set();
    const toGenerate = [];
    for (const [px, pz] of populateCoords) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const tx = px + dx;
                const tz = pz + dz;
                const key = `${tx},${tz}`;
                if (!generateKeys.has(key)) {
                    generateKeys.add(key);
                    toGenerate.push([tx, tz]);
                }
            }
        }
    }

    const totalWork = toGenerate.length + populateCoords.length + chunkCoords.length;
    let workDone = 0;
    const reportProgress = () => {
        if (onProgress) onProgress(workDone, totalWork);
    };

    // 1. Generate base terrain for populated chunks and their 1-ring neighbors
    for (const [tx, tz] of toGenerate) {
        const chunk = generator.newChunk(world, tx, tz, ChunkStub);
        world.addChunk(chunk);
        workDone++;
        reportProgress();
    }

    // 2. Populate target chunks AND neighbors so cross-chunk structures (trees) spill correctly
    for (const [px, pz] of populateCoords) {
        generator.populateChunk(px, pz);
        workDone++;
        reportProgress();
    }

    // 3. Serialize and return requested chunks
    const requested = [];
    for (const [cx, cz] of chunkCoords) {
        const chunk = world.getChunkAt(cx, cz);
        if (chunk) {
            requested.push(serializeChunk(chunk));
            workDone++;
            reportProgress();
        }
    }
    return requested;
}

self.onmessage = function(e) {
    const msg = e.data;

    try {
        if (msg.type === "generate") {
            const { chunkX, chunkZ, seed, worldType } = msg;
            const results = generateChunks([[chunkX, chunkZ]], seed, worldType);
            self.postMessage({ type: "chunkGenerated", results });
        }

        if (msg.type === "generateBatch") {
            const { coords, seed, worldType, batchId } = msg;
            const results = generateChunks(coords, seed, worldType, (done, total) => {
                self.postMessage({ type: "batchProgress", batchId, done, total });
            });
            self.postMessage({ type: "batchGenerated", batchId, results });
        }
    } catch (err) {
        console.error("Worker generation error:", err);
        self.postMessage({ type: msg.type === "generateBatch" ? "batchGenerated" : "chunkGenerated", batchId: msg.batchId, results: [] });
    }
};
