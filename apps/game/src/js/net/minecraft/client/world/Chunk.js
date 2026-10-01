import EnumSkyBlock from "../../util/EnumSkyBlock.js";
import Block from "./block/Block.js";
import World from "./World.js";
import ChunkSection from "./ChunkSection.js";
import * as THREE from "../../../../../../libraries/three.module.js";
import TagCompound from "../../nbt/tag/TagCompound.js";
import BlockEntityRegistry from "./block/entity/BlockEntityRegistry.js";

export default class Chunk {

    static SECTION_AMOUNT = World.TOTAL_HEIGHT / ChunkSection.SIZE;

    constructor(world, x, z) {
        this.world = world;
        this.x = x;
        this.z = z;

        this.group = new THREE.Object3D();
        this.group.matrixAutoUpdate = false;
        this.group.chunkX = x;
        this.group.chunkZ = z;

        this.loaded = false;
        this.isTerrainPopulated = false;

        // Initialize sections
        this.sections = [];
        for (let y = 0; y < Chunk.SECTION_AMOUNT; y++) {
            let section = new ChunkSection(world, this, x, y, z);

            this.sections[y] = section;
            this.group.add(section.group);
        }

        // Create height map
        this.heightMap = [];

        // Block entities located in this chunk. The world also keeps a global
        // position->entity map; this list is the chunk-local view used for
        // serialization and chunk unload.
        this.blockEntities = [];
    }

    // ------------------------------------------------------------------
    // Block entity tracking (chunk-local view; world owns the global map)
    // ------------------------------------------------------------------

    /**
     * Add a block entity to this chunk's tracking list. Called by
     * World.setBlockEntity. Idempotent — adding the same entity twice is
     * a no-op.
     */
    addBlockEntity(entity) {
        if (!entity) return;
        if (this.blockEntities.indexOf(entity) !== -1) return;
        this.blockEntities.push(entity);
        this.isModified = true;
    }

    /**
     * Remove a block entity from this chunk's tracking list. Called by
     * World.removeBlockEntity.
     */
    removeBlockEntity(entity) {
        if (!entity) return;
        let i = this.blockEntities.indexOf(entity);
        if (i !== -1) {
            this.blockEntities.splice(i, 1);
            this.isModified = true;
        }
    }

    /**
     * Returns a snapshot array of block entities located in this chunk.
     */
    getBlockEntities() {
        return this.blockEntities.slice();
    }

    generateSkylightMap() {
        // Calculate height map
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                this.setHeightAt(x, z, 0);
                this.updateHeightMap(x, World.TOTAL_HEIGHT, z);
            }
        }

        // Update light of neighbor blocks
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                this.notifyNeighbors(x, z);
            }
        }

        // Rebuild all sections
        this.setModifiedAllSections();
    }

    generateBlockLightMap() {
        let targetY = 32;
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                for (let y = 0; y < World.TOTAL_HEIGHT; y++) {
                    let section = this.getSection(y >> 4);

                    let typeId = section.getBlockAt(x, y & 15, z);
                    let block = Block.getById(typeId);
                    let blockLight = typeId === 0 ? 0 : block.getLightValue(this.world, x + this.x * 16, y, z + this.z * 16);

                    if (blockLight > 0) {
                        section.setLightAt(EnumSkyBlock.BLOCK, x, y & 15, z, blockLight);
                    }
                }

                let level = 15;
                for (let y = targetY - 2; y < 256 && level > 0;) {
                    y++;

                    let section = this.getSection(y >> 4);

                    let typeId = section.getBlockAt(x, y & 15, z);
                    let block = Block.getById(typeId);

                    let opacity = typeId === 0 ? 0 : block.getOpacity();
                    let blockLight = typeId === 0 ? 0 : block.getLightValue(this.world, x + this.x * 16, y, z + this.z * 16);

                    if (opacity === 0) {
                        opacity = 1;
                    }

                    level -= opacity;

                    if (blockLight > level) {
                        level = blockLight;
                    }

                    if (level < 0) {
                        level = 0;
                    }

                    section.setLightAt(EnumSkyBlock.BLOCK, x, y & 15, z, blockLight);
                }
            }
        }

        this.world.updateLight(EnumSkyBlock.BLOCK,
            this.x * 16, targetY - 1, this.z * 16,
            this.x * 16 + 16, targetY + 1, this.z * 16 + 16
        );
        this.setModifiedAllSections();
    }

    updateBlockLight() {
        this.setModifiedAllSections();
    }

    notifyNeighbors(x, z) {
        let height = this.getHeightAt(x, z);
        let totalX = this.x * 16 + x;
        let totalZ = this.z * 16 + z;

        this.updateSkyLight(totalX - 1, totalZ, height);
        this.updateSkyLight(totalX + 1, totalZ, height);
        this.updateSkyLight(totalX, totalZ - 1, height);
        this.updateSkyLight(totalX, totalZ + 1, height);
    }

    updateSkyLight(x, z, y) {
        let height = this.world.getHeightAt(x, z);
        if (height > y) {
            this.world.updateLight(EnumSkyBlock.SKY, x, y, z, x, height, z);
        } else if (height < y) {
            this.world.updateLight(EnumSkyBlock.SKY, x, height, z, x, y, z);
        }
        this.setModifiedAllSections();
    }

    updateHeightMap(relX, y, relZ) {
        let currentHighestY = this.getHeightAt(relX, relZ);
        let highestY = currentHighestY;
        if (y > currentHighestY) {
            highestY = y;
        }

        highestY = this.calculateHeightAt(relX, relZ, highestY);

        if (highestY === currentHighestY) {
            return;
        }

        this.setHeightAt(relX, relZ, highestY);

        let x = this.x * 16 + relX;
        let z = this.z * 16 + relZ;

        if (highestY < currentHighestY) {
            for (let hy = highestY; hy < currentHighestY; hy++) {
                this.setLightAt(EnumSkyBlock.SKY, relX, hy, relZ, 15);
            }
        } else {
            this.world.updateLight(EnumSkyBlock.SKY, x, currentHighestY, z, x, highestY, z);
            for (let hy = currentHighestY; hy < highestY; hy++) {
                this.setLightAt(EnumSkyBlock.SKY, relX, hy, relZ, 0);
            }
        }

        let lightLevel = 15;
        let prevHeight = highestY;
        let iterations = 0;
        while (highestY > 0 && lightLevel > 0 && iterations < 256) {
            highestY--;

            let typeId = this.getBlockID(relX, highestY, relZ);
            let block = Block.getById(typeId);

            let opacity = Math.floor(typeId === 0 ? 0 : block.getOpacity() * 255);
            if (opacity === 0) {
                opacity = 1;
            }
            lightLevel -= opacity;
            if (lightLevel < 0) {
                lightLevel = 0;
            }

            this.setLightAt(EnumSkyBlock.SKY, relX, highestY, relZ, lightLevel);
            iterations++;
        }

        highestY = this.calculateHeightAt(relX, relZ, highestY);

        if (highestY !== prevHeight) {
            this.world.updateLight(EnumSkyBlock.SKY, x - 1, highestY, z - 1, x + 1, prevHeight, z + 1);
        }
        this.setModifiedAllSections();
    }

    calculateHeightAt(x, z, startY) {
        let y = startY;
        let iterations = 0;
        while (y > 0 && iterations < 256) {
            let typeId = this.getBlockAt(x, y - 1, z);
            let block = Block.getById(typeId);
            let opacity = typeId === 0 || block === null ? 0 : block.getOpacity();

            if (opacity !== 0) {
                break;
            }
            y--;
            iterations++;
        }
        return y;
    }

    updateHeightMapAt(x, z) {
        let y = this.calculateHeightAt(x, z, World.TOTAL_HEIGHT);
        this.setHeightAt(x, z, y);
    }

    setHeightAt(x, z, height) {
        this.heightMap[z << 4 | x] = height;
    }

    /**
     * Is the highest solid block or above
     */
    isHighestBlock(x, y, z) {
        return y >= this.getHighestBlockAt(x, z);
    }

    /**
     * Is above the highest solid block
     */
    isAboveGround(x, y, z) {
        return y >= this.getHeightAt(x, z);
    }

    /**
     * Get the first non-solid block
     */
    getHeightAt(x, z) {
        return this.heightMap[z << 4 | x];
    }

    /**
     * Get the highest solid block
     */
    getHighestBlockAt(x, z) {
        return this.getHeightAt(x, z) - 1;
    }

    setLightAt(sourceType, x, y, z, level) {
        let section = this.getSection(y >> 4);
        section.setLightAt(sourceType, x, y & 15, z, level);
    }

    setBlockDataAt(x, y, z, data) {
        this.setBlockAt(x, y, z, this.getBlockAt(x, y, z), data);
    }

    setBlockAt(x, y, z, typeId, data = 0) {
        if (y < 0 || y >= World.TOTAL_HEIGHT) {
            return;
        }

        let section = this.getSection(y >> 4);
        let yInSection = y & 15;

        let height = this.getHeightAt(x, z);
        let prevTypeId = section.getBlockAt(x, yInSection, z);
        let prevData = section.getBlockDataAt(x, yInSection, z);

        // Check if block type has changed
        if (prevTypeId === typeId && prevData === data) {
            return false;
        }

        // Update block type and data
        section.setBlockAt(x, yInSection, z, typeId);
        section.setBlockDataAt(x, yInSection, z, data);

        if (!this.loaded) {
            return;
        }

        // Update height map
        let block = Block.getById(typeId);
        if (typeId !== 0 && block !== null && block.isSolid()) {
            if (y >= height) {
                this.updateHeightMap(x, y + 1, z);
            }
        } else if (y === height - 1) {
            this.updateHeightMap(x, y, z);
        }

        let totalX = this.x * 16 + x;
        let totalZ = this.z * 16 + z;

        // Update light
        this.world.updateLight(EnumSkyBlock.SKY, totalX, y, totalZ, totalX, y, totalZ);
        this.world.updateLight(EnumSkyBlock.BLOCK, totalX, y, totalZ, totalX, y, totalZ);

        // Notify surrounding blocks
        this.notifyNeighbors(x, z);

        // Handle block abilities
        if (typeId !== 0 && block !== null) {
            block.onBlockAdded(this.world, totalX, y, totalZ);
        }

        return true;
    }

    fillChunk(data, mask, fullChunk) {
        let i = 0;
        const NIBBLE_SIZE = 2048; // 2048 bytes

        for (let layer = 0; layer < Chunk.SECTION_AMOUNT; layer++) {
            if ((mask & 1 << layer) !== 0) {
                let section = this.getSection(layer);

                // Read block states
                for (let k = 0; k < ChunkSection.SIZE * ChunkSection.SIZE * ChunkSection.SIZE; k++) {
                    let x = k & 15;
                    let z = (k >> 4) & 15;
                    let y = (k >> 8) & 15;

                    let value = (((data[i] & 0xFF) | (data[i + 1] & 0xFF) << 8));
                    let typeId = value >> 4;
                    let meta = value & 0xF;

                    // TODO support more blocks
                    if (typeId !== 0 && Block.getById(typeId) === null) {
                        typeId = 1;
                    }

                    section.setBlockAt(x, y, z, typeId);
                    section.setBlockDataAt(x, y, z, meta);

                    i += 2;
                }

                // Read block light (2048 bytes)
                let blockLightOffset = i;
                for (let k = 0; k < ChunkSection.SIZE * ChunkSection.SIZE * ChunkSection.SIZE; k++) {
                    let x = k & 15;
                    let z = (k >> 4) & 15;
                    let y = (k >> 8) & 15;
                    let nibbleIndex = k >> 1;
                    let isHighNibble = (k & 1) === 0;
                    let byte = data[blockLightOffset + nibbleIndex];
                    let light = isHighNibble ? (byte >> 4) & 0xF : byte & 0xF;
                    section.setLightAt(EnumSkyBlock.BLOCK, x, y, z, light);
                }
                i += NIBBLE_SIZE;

                // Read sky light (2048 bytes)
                let skyLightOffset = i;
                for (let k = 0; k < ChunkSection.SIZE * ChunkSection.SIZE * ChunkSection.SIZE; k++) {
                    let x = k & 15;
                    let z = (k >> 4) & 15;
                    let y = (k >> 8) & 15;
                    let nibbleIndex = k >> 1;
                    let isHighNibble = (k & 1) === 0;
                    let byte = data[skyLightOffset + nibbleIndex];
                    let light = isHighNibble ? (byte >> 4) & 0xF : byte & 0xF;
                    section.setLightAt(EnumSkyBlock.SKY, x, y, z, light);
                }
                i += NIBBLE_SIZE;
            }
        }

        for (let x = 0; x < ChunkSection.SIZE; x++) {
            for (let z = 0; z < ChunkSection.SIZE; z++) {
                this.setHeightAt(x, z, this.calculateHeightAt(x, z, World.TOTAL_HEIGHT));
            }
        }

        this.setModifiedAllSections();

        if (this.loaded) {
            // Recompute this chunk's lightmaps and those of its already-loaded
            // neighbors, so chunk borders stay consistent no matter the order
            // chunks arrive in.
            this.world.updateChunkLight(this);
        }
    }

    getBlockID(x, y, z) {
        return this.getBlockAt(x, y, z);
    }

    getBlockAt(x, y, z) {
        return this.getSection(y >> 4).getBlockAt(x, y & 15, z);
    }

    getBlockDataAt(x, y, z) {
        return this.getSection(y >> 4).getBlockDataAt(x, y & 15, z);
    }

    getSection(y) {
        if (y < 0 || y >= this.sections.length) {
            return null;
        }
        return this.sections[y];
    }

    rebuild(renderer) {
        for (let y = 0; y < Chunk.SECTION_AMOUNT; y++) {
            this.sections[y].rebuild(renderer);
        }
    }

    isLoaded() {
        return this.loaded;
    }

    unload() {
        // Detach all block entities from the world when the chunk unloads.
        if (this.world && typeof this.world.unloadBlockEntities === "function") {
            this.world.unloadBlockEntities(this);
        }
        this.loaded = false;
    }

    setModifiedAllSections() {
        for (let y = 0; y < Chunk.SECTION_AMOUNT; y++) {
            this.sections[y].isModified = true;
        }
    }

    hasDirtySections() {
        for (let y = 0; y < Chunk.SECTION_AMOUNT; y++) {
            if (this.sections[y].isDirty) return true;
        }
        return false;
    }

    serialize() {
        const sections = [];
        for (let y = 0; y < Chunk.SECTION_AMOUNT; y++) {
            const section = this.sections[y];
            if (section.empty) {
                sections[y] = null;
                continue;
            }

            const blocks = {};
            const blocksData = {};
            const blockLight = {};
            const skyLight = {};

            for (let i = 0; i < 4096; i++) {
                if (i in section.blocks && section.blocks[i] !== 0) {
                    blocks[i] = section.blocks[i];
                }
                if (i in section.blocksData && section.blocksData[i] !== 0) {
                    blocksData[i] = section.blocksData[i];
                }
                if (i in section.blockLight) {
                    blockLight[i] = section.blockLight[i];
                }
                if (i in section.skyLight) {
                    skyLight[i] = section.skyLight[i];
                }
            }

            sections[y] = {
                blocks: Object.keys(blocks).length > 0 ? blocks : null,
                blocksData: Object.keys(blocksData).length > 0 ? blocksData : null,
                blockLight: Object.keys(blockLight).length > 0 ? blockLight : null,
                skyLight: Object.keys(skyLight).length > 0 ? skyLight : null,
            };
        }

        return {
            x: this.x,
            z: this.z,
            sections: sections,
            heightMap: Array.from(this.heightMap),
            blockEntities: this.serializeBlockEntities()
        };
    }

    /**
     * Serialize every block entity in this chunk to a plain-JS array of
     * TagCompound.toObject() representations. Returns null when the chunk
     * has no block entities (so old saves stay compatible).
     */
    serializeBlockEntities() {
        if (!this.blockEntities || this.blockEntities.length === 0) {
            return null;
        }
        let out = [];
        for (let entity of this.blockEntities) {
            let tag = new TagCompound("");
            try {
                entity.writeToNBT(tag);
            } catch (e) {
                console.warn(`[Chunk.serializeBlockEntities] Failed to write entity at (${entity.x},${entity.y},${entity.z}):`, e);
                continue;
            }
            out.push(tag.toObject());
        }
        return out.length > 0 ? out : null;
    }

    static deserialize(world, data) {
        const chunk = new Chunk(world, data.x, data.z);

        for (let y = 0; y < Chunk.SECTION_AMOUNT; y++) {
            const sectionData = data.sections[y];
            if (!sectionData) continue;

            const section = chunk.getSection(y);
            section.empty = false;

            if (sectionData.blocks) {
                for (const idxStr in sectionData.blocks) {
                    section.blocks[parseInt(idxStr)] = sectionData.blocks[idxStr];
                }
            }
            if (sectionData.blocksData) {
                for (const idxStr in sectionData.blocksData) {
                    section.blocksData[parseInt(idxStr)] = sectionData.blocksData[idxStr];
                }
            }
            if (sectionData.blockLight) {
                for (const idxStr in sectionData.blockLight) {
                    section.blockLight[parseInt(idxStr)] = sectionData.blockLight[idxStr];
                }
            }
            if (sectionData.skyLight) {
                for (const idxStr in sectionData.skyLight) {
                    section.skyLight[parseInt(idxStr)] = sectionData.skyLight[idxStr];
                }
            }
        }

        chunk.heightMap = data.heightMap.slice();

        // Restore block entities from NBT objects, then push their state back
        // into the block data nibble (NBT is authoritative for entity state).
        chunk.blockEntities = [];
        if (Array.isArray(data.blockEntities)) {
            for (let obj of data.blockEntities) {
                let tag = TagCompound.fromObject(obj);
                if (!tag) continue;
                let entity = BlockEntityRegistry.createFromNBT(world, tag);
                if (entity) {
                    entity.world = world;
                    chunk.blockEntities.push(entity);
                    if (typeof entity.applyToChunk === "function") {
                        entity.applyToChunk(chunk);
                    }
                }
            }
        }

        // Migration: blocks that own a BlockEntity but had no NBT entity
        // stored (e.g. saves made before block entities existed) get one
        // seeded from their current block data so state persists from now on.
        {
            let existing = new Set(chunk.blockEntities.map(
                (e) => `${e.x},${e.y},${e.z}`
            ));
            for (let sy = 0; sy < Chunk.SECTION_AMOUNT; sy++) {
                const sectionData = data.sections[sy];
                if (!sectionData || !sectionData.blocks) continue;
                const section = chunk.getSection(sy);
                for (const idxStr in sectionData.blocks) {
                    const idx = parseInt(idxStr);
                    const block = Block.getById(section.blocks[idx]);
                    if (!block || !block.hasBlockEntity || !block.hasBlockEntity()) continue;

                    const lx = idx & 15;
                    const ly = (idx >> 8) & 15;
                    const lz = (idx >> 4) & 15;
                    const wx = chunk.x * 16 + lx;
                    const wy = sy * 16 + ly;
                    const wz = chunk.z * 16 + lz;
                    if (existing.has(`${wx},${wy},${wz}`)) continue;

                    const entity = block.createBlockEntity(world, wx, wy, wz);
                    if (entity) {
                        if (typeof entity.readFromBlockData === "function") {
                            entity.readFromBlockData(section.getBlockDataAt(lx, ly, lz));
                        }
                        chunk.blockEntities.push(entity);
                    }
                }
            }
        }

        chunk.loaded = true;
        chunk.isTerrainPopulated = true;

        // Register restored entities with the world's global map. Done here
        // (rather than from the caller) so that by the time deserialize()
        // returns, the chunk is fully wired up.
        if (typeof world.loadBlockEntities === "function") {
            world.loadBlockEntities(chunk);
        }

        return chunk;
    }
}