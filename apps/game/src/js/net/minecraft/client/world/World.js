import ChunkSection from "./ChunkSection.js";
import MathHelper from "../../util/MathHelper.js";
import BoundingBox from "../../util/BoundingBox.js";
import EnumSkyBlock from "../../util/EnumSkyBlock.js";
import Block from "./block/Block.js";
import EnumBlockFace from "../../util/EnumBlockFace.js";
import Vector3 from "../../util/Vector3.js";
import Vector4 from "../../util/Vector4.js";
import MetadataChunkBlock from "../../util/MetadataChunkBlock.js";
import * as THREE from "../../../../../../libraries/three.module.js";
import ContainerFurnace from "../inventory/container/ContainerFurnace.js";
import BlockEntityRegistry from "./block/entity/BlockEntityRegistry.js";

export default class World {

    static TOTAL_HEIGHT = ChunkSection.SIZE * 16; // 256 blocks high (Y 0..255)

    // Small separation kept between an entity and a block face so the entity's
    // box never becomes exactly flush with a block edge, which lets a diagonal
    // move slip through the corner of a block.
    static COLLISION_EPSILON = 0.001;

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.entities = [];
        this.nextEntityId = 3;

        this.group = new THREE.Object3D();
        this.group.matrixAutoUpdate = false;

        this.lightUpdateQueue = [];
        this.chunkProvider = null;

        this.time = 0;
        this.spawn = new Vector3(0, 0, 0);

        // Block tick system
        this.blockTickQueue = [];
        this.scheduledBlockTicks = new Map();

        // NBT-backed block entities (TileEntity equivalent).
        // Keyed by `${x},${y},${z}` -> BlockEntity instance.
        this.blockEntities = new Map();

        // Store interval ID for cleanup
        this.lightUpdateInterval = null;

        // Dynamic lighting tracking
        this.lastPlayerX = null;
        this.lastPlayerY = null;
        this.lastPlayerZ = null;
        this.dynamicLightUpdateInterval = null;

        const textureLoader = new THREE.TextureLoader();
        this.cloudTexture = textureLoader.load('src/resources/terrain/clouds.png', (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.repeat.set(0.7, 0.7);
        });

        const cloudPlaneSize = 4096;
        const planeGeometry = new THREE.PlaneGeometry(cloudPlaneSize, cloudPlaneSize);
        
        const cloudMaterial = new THREE.MeshBasicMaterial({
            map: this.cloudTexture,
            transparent: true,
            depthTest: true,
            alphaTest: true,
            side: THREE.DoubleSide
        });

        this.clouds = new THREE.Mesh(planeGeometry, cloudMaterial);
        this.clouds.rotation.x = -Math.PI / 2;
        this.clouds.position.y = 192;
        this.group.add(this.clouds);
        
        this.cloudOffset = 0;

        // Update lights async. Time-budget the drain so a large backlog (e.g.
        // the burst of chunks sent when a world loads) can never block the main
        // thread for a whole frame; leftover regions drain on later ticks.
        let scope = this;
        this.lightUpdateInterval = setInterval(function () {
            const deadline = performance.now() + 8;
            while (scope.lightUpdateQueue.length > 0 && performance.now() < deadline) {
                scope.lightUpdateQueue.shift().updateBlockLightning(scope);
            }
        }, 50);

        // Dynamic lighting update interval - update chunks every 0.5s
        this.dynamicLightUpdateInterval = setInterval(function () {
            if (scope.minecraft.settings.dynamicLights && scope.minecraft.player) {
                scope.updateDynamicLighting();
            }
        }, 500);
    }

    getSeed() {
        if (!this.chunkProvider) return 0;
        if (this.chunkProvider.generator) return this.chunkProvider.generator.seed;
        if (this.chunkProvider.seed) return this.chunkProvider.seed;
        return 0;
    }

    cleanup() {
        // Clear light update interval to prevent stale state
        if (this.lightUpdateInterval !== null) {
            clearInterval(this.lightUpdateInterval);
            this.lightUpdateInterval = null;
        }

        // Clear dynamic lighting update interval
        if (this.dynamicLightUpdateInterval !== null) {
            clearInterval(this.dynamicLightUpdateInterval);
            this.dynamicLightUpdateInterval = null;
        }
    }

    setChunkProvider(chunkProvider) {
        this.chunkProvider = chunkProvider;
    }

    onTick() {
        // Tick entities
        for (let i = 0; i < this.entities.length; i++) {
            this.entities[i].onUpdate();
        }

        // Process scheduled block ticks
        this.processBlockTicks();

        // Tick NBT-backed block entities
        this.tickBlockEntities();

        // Tick furnace tile entities
        if (this.blockInventories) {
            for (const [key, inv] of this.blockInventories) {
                if (key.startsWith("furnace:")) {
                    const parts = key.split(":");
                    if (parts.length === 4) {
                        const pos = { x: parseInt(parts[1]), y: parseInt(parts[2]), z: parseInt(parts[3]) };
                        ContainerFurnace.tickFurnace(inv, pos, this);
                    }
                }
            }
        }

        // Update skylight subtracted (To make the night dark)
        let lightLevel = this.calculateSkylightSubtracted(1.0);
        if (lightLevel !== this.skylightSubtracted) {
            this.skylightSubtracted = lightLevel;

            // Rebuild all chunks
            this.minecraft.worldRenderer.rebuildAll();
        }

        // Update clouds
        this.cloudOffset += 0.00001;

        // Update world time
        this.time++;
    }

    scheduleBlockTick(x, y, z, delay) {
        let key = `${x},${y},${z}`;
        let tickTime = this.time + delay;
        this.scheduledBlockTicks.set(key, { x, y, z, tickTime });
    }

    processBlockTicks() {
        // Disable block ticking in multiplayer
        if (!this.minecraft.isSingleplayer()) {
            return;
        }
        
        for (let [key, tick] of this.scheduledBlockTicks) {
            if (this.time >= tick.tickTime) {
                this.scheduledBlockTicks.delete(key);
                this.tickBlock(tick.x, tick.y, tick.z);
            }
        }
    }

    getCollisionBoxes(region) {
        let boundingBoxList = [];

        let minX = MathHelper.floor(region.minX);
        let maxX = MathHelper.floor(region.maxX + 1.0);
        let minY = MathHelper.floor(region.minY);
        let maxY = MathHelper.floor(region.maxY + 2.0);
        let minZ = MathHelper.floor(region.minZ);
        let maxZ = MathHelper.floor(region.maxZ + 1.0);

        for (let x = minX; x < maxX; x++) {
            for (let y = minY; y < maxY; y++) {
                for (let z = minZ; z < maxZ; z++) {
                    let collisionBoxes = this.getBlockCollisionBoxesAt(x, y, z);
                    if (collisionBoxes.length > 0) {
                        boundingBoxList.push(...collisionBoxes);
                    }
                }
            }
        }
        return boundingBoxList;
    }

    getBlockCollisionBoxesAt(x, y, z) {
        let typeId = this.getBlockAt(x, y, z);
        if (typeId === 0) {
            return [];
        }

        let block = Block.getById(typeId);
        if (block === null) {
            return [];
        }

        if (block.multipart) {
            let multipart = block.getMultipart(this, x, y, z);
            if (Array.isArray(multipart) && multipart.length > 0) {
                return multipart.map((part) => {
                    let bbox = part[2];
                    if (!bbox) {
                        return null;
                    }

                    let bb = new BoundingBox(
                        x + bbox.minX,
                        y + bbox.minY,
                        z + bbox.minZ,
                        x + bbox.maxX,
                        y + bbox.maxY,
                        z + bbox.maxZ
                    );
                    bb.epsilon = World.COLLISION_EPSILON;
                    return bb;
                }).filter((box) => box !== null);
            }
        }

        if (block.isSolid()) {
            let bb = new BoundingBox(x, y, z, x + 1, y + 1, z + 1);
            bb.epsilon = World.COLLISION_EPSILON;
            return [bb];
        }

        // Liquids have no collision
        if (block.isLiquid()) {
            return [];
        }

        // Check for blocks with custom collision bounding box
        let collisionBb = block.getCollisionBoundingBox(this, x, y, z);
        if (collisionBb) {
            let bb = new BoundingBox(
                x + collisionBb.minX,
                y + collisionBb.minY,
                z + collisionBb.minZ,
                x + collisionBb.maxX,
                y + collisionBb.maxY,
                z + collisionBb.maxZ
            );
            bb.epsilon = World.COLLISION_EPSILON;
            return [bb];
        }

        // Legacy half-block check for blocks that override isHalf()
        // Only reached if getCollisionBoundingBox returned null
        if (this.isHalfBlockAt(x, y, z)) {
            let bb = new BoundingBox(x, y, z, x + 1, y + 0.5, z + 1);
            bb.epsilon = World.COLLISION_EPSILON;
            return [bb];
        }

        return [];
    }

    isSolidBlockAt(x, y, z) {
        let typeId = this.getBlockAt(x, y, z);
        if (typeId === 0) {
            return false;
        }

        let block = Block.getById(typeId);
        return block !== null && !block.multipart && block.isSolid();
    }

    isHalfBlockAt(x, y, z) {
        let typeId = this.getBlockAt(x, y, z);
        if (typeId === 0) {
            return false;
        }

        let block = Block.getById(typeId);
        return block !== null && block.isHalf(this, x, y, z);
    }

    tickBlock(x, y, z) {
        let typeId = this.getBlockAt(x, y, z);
        if (typeId === 0) return;

        let block = Block.getById(typeId);
        if (block && block.onBlockTick) {
            block.onBlockTick(this, x, y, z);
        }
    }

    getChunkAt(x, z) {
        return this.chunkProvider.getChunkAt(x, z);
    }

    getChunkAtBlock(x, y, z) {
        const chunk = this.getChunkAt(x >> 4, z >> 4);
        if (!chunk) {
            return null;
        }

        const sectionY = y >> 4;
        if (sectionY < 0 || sectionY >= World.TOTAL_HEIGHT / ChunkSection.SIZE) {
            return null;
        }

        return chunk.getSection(sectionY);
    }

    getCollisionBoxes(region) {
        let boundingBoxList = [];

        let minX = MathHelper.floor(region.minX);
        let maxX = MathHelper.floor(region.maxX + 1.0);
        let minY = MathHelper.floor(region.minY);
        let maxY = MathHelper.floor(region.maxY + 1.0);
        let minZ = MathHelper.floor(region.minZ);
        let maxZ = MathHelper.floor(region.maxZ + 1.0);

        for (let x = minX; x < maxX; x++) {
            for (let y = minY; y < maxY; y++) {
                for (let z = minZ; z < maxZ; z++) {
                    let collisionBoxes = this.getBlockCollisionBoxesAt(x, y, z);
                    if (collisionBoxes.length > 0) {
                        boundingBoxList.push(...collisionBoxes);
                    }
                }
            }
        }
        return boundingBoxList;
    }

    updateLights() {
        // Drain a bounded slice of the queue per call so onRender can pace the
        // work across frames; returns true while more light updates remain.
        let processed = 0;
        while (this.lightUpdateQueue.length > 0 && processed < 4) {
            processed++;
            this.lightUpdateQueue.shift().updateBlockLightning(this);
        }
        return this.lightUpdateQueue.length > 0;
    }

    updateLight(sourceType, x1, y1, z1, x2, y2, z2, notifyNeighbor = true) {
        let centerX = (x2 + x1) / 2;
        let centerZ = (z2 + z1) / 2;

        if (!this.blockExists(centerX, 64, centerZ)) {
            return;
        }

        let size = this.lightUpdateQueue.length;

        if (notifyNeighbor) {
            let max = 4;
            if (max > size) {
                max = size;
            }
            for (let i = 0; i < max; i++) {
                let meta = this.lightUpdateQueue[(this.lightUpdateQueue.length - i - 1)];
                if (meta.type === sourceType && meta.isOutsideOf(x1, y1, z1, x2, y2, z2)) {
                    return;
                }
            }
        }

        let centerChunk = this.getChunkAt(centerX >> 4, centerZ >> 4);
        if (!centerChunk.loaded) {
            return;
        }

        // Skip if section has no blocks
        let section1 = this.getChunkSectionAt(x1 >> 4, y1 >> 4, z1 >> 4);
        let section2 = this.getChunkSectionAt(x2 >> 4, y2 >> 4, z2 >> 4);
        if (section1 === section2 && section1.isEmpty()) {
            return;
        }

        // Add light update region to queue.
        if (this.lightUpdateQueue.length < 9999) {
            this.lightUpdateQueue.push(new MetadataChunkBlock(sourceType, x1, y1, z1, x2, y2, z2));
        }

        // Max light updates in queue
        if (this.lightUpdateQueue.length > 10000) {
            this.lightUpdateQueue = [];
        }
    }

    /**
     * Compute the sky lightmap of a chunk directly, column by column, without
     * relaxation. Sky light enters from above: blocks at or above the heightmap
     * get 15, and below ground it attenuates by each block's opacity. Fresh
     * chunks start with the "uncomputed" sky marker (14) everywhere, which
     * makes neighbor-based propagation crawl one level at a time; this pass
     * establishes near-final values instantly, and the flood from updateLight()
     * then fixes horizontal exposure at cave openings and cliffs.
     */
    updateChunkSkyLight(chunk) {
        if (!chunk || !chunk.loaded) return;

        const worldX = chunk.x * ChunkSection.SIZE;
        const worldZ = chunk.z * ChunkSection.SIZE;

        for (let lx = 0; lx < ChunkSection.SIZE; lx++) {
            for (let lz = 0; lz < ChunkSection.SIZE; lz++) {
                const height = chunk.getHeightAt(lx, lz);
                let light = 15;
                for (let y = World.TOTAL_HEIGHT - 1; y >= 0; y--) {
                    if (y < height) {
                        const typeId = this.getBlockAt(worldX + lx, y, worldZ + lz);
                        const block = Block.getById(typeId);
                        let opacity = block === null || typeId === 0 ? 0 : Math.round(block.getOpacity() * 255);
                        if (opacity === 0) {
                            opacity = 1;
                        }
                        light -= opacity;
                        if (light < 0) {
                            light = 0;
                        }
                    } else {
                        light = 15;
                    }
                    if (light !== this.getSavedLightValue(EnumSkyBlock.SKY, worldX + lx, y, worldZ + lz)) {
                        // fillChunk already marked every section modified, so a
                        // direct section write skips the redundant rebuild flags.
                        chunk.getSection(y >> 4).setLightAt(EnumSkyBlock.SKY, lx, y & 15, lz, light);
                    }
                }
            }
        }
    }

    /**
     * The server sends a light placeholder (0xFF) for every block, so a
     * freshly-filled chunk has block light = 15 everywhere. If the flood ran
     * on that, light would have to "decay" 15 -> 0 through the whole chunk one
     * level at a time (an enormous amount of work, a freeze, and wrong results
     * when capped). Block light is recomputed from scratch anyway, so just
     * zero it before the flood runs.
     */
    resetChunkBlockLight(chunk) {
        const sectionCount = World.TOTAL_HEIGHT / ChunkSection.SIZE;
        for (let layer = 0; layer < sectionCount; layer++) {
            const section = chunk.getSection(layer);
            for (let k = 0; k < ChunkSection.SIZE * ChunkSection.SIZE * ChunkSection.SIZE; k++) {
                section.setLightAt(EnumSkyBlock.BLOCK, k & 15, (k >> 8) & 15, (k >> 4) & 15, 0);
            }
        }
    }

    /**
     * Recompute the lightmaps of a chunk and its loaded orthogonal neighbors.
     * Chunks are added in arbitrary order, so a chunk loaded after its
     * neighbors must refresh their boundary columns too (their saved light
     * was computed without this chunk's terrain/light present).
     */
    updateChunkLight(chunk) {
        if (!chunk || !chunk.loaded) return;

        this.updateChunkSkyLight(chunk);
        this.resetChunkBlockLight(chunk);

        // Recompute this chunk's light in a single queued pass. The flood
        // spreads through loaded neighbors on its own (light changes push into
        // adjacent chunks), so requeueing every loaded neighbor here only
        // multiplied the queue - and the main-thread stall - while chunks
        // streamed in.
        const x1 = chunk.x * ChunkSection.SIZE;
        const z1 = chunk.z * ChunkSection.SIZE;
        this.updateLight(EnumSkyBlock.SKY, x1, 0, z1, x1 + ChunkSection.SIZE - 1, World.TOTAL_HEIGHT - 1, z1 + ChunkSection.SIZE - 1);
        this.updateLight(EnumSkyBlock.BLOCK, x1, 0, z1, x1 + ChunkSection.SIZE - 1, World.TOTAL_HEIGHT - 1, z1 + ChunkSection.SIZE - 1);
    }

    blockExists(x, y, z) {
        if (y < 0 || y >= World.TOTAL_HEIGHT) {
            return false;
        } else {
            return this.chunkExists(x >> 4, z >> 4);
        }
    }

    chunkExists(chunkX, chunkZ) {
        return this.chunkProvider !== null && this.chunkProvider.chunkExists(chunkX, chunkZ);
    }

    /**
     * Get the first non-solid block
     */
    getHeightAt(x, z) {
        if (!this.chunkExists(x >> 4, z >> 4)) {
            return 0;
        }
        return this.getChunkAt(x >> 4, z >> 4).getHeightAt(x & 15, z & 15);
    }

    /**
     * Get the highest solid block
     */
    getHighestBlockAt(x, z) {
        if (!this.chunkExists(x >> 4, z >> 4)) {
            return 0;
        }
        return this.getChunkAt(x >> 4, z >> 4).getHighestBlockAt(x & 15, z & 15);
    }

    /**
     * Is the highest solid block or above
     */
    isHighestBlock(x, y, z) {
        let chunk = this.getChunkAt(x >> 4, z >> 4)
        return chunk.isHighestBlock(x & 15, y, z & 15);
    }

    /**
     * Is above the highest solid block
     */
    isAboveGround(x, y, z) {
        let chunk = this.getChunkAt(x >> 4, z >> 4)
        return chunk.isAboveGround(x & 15, y, z & 15);
    }

    getSavedLightValue(sourceType, x, y, z) {
        if (!this.blockExists(x, y, z)) {
            return 15;
        }

        let section = this.getChunkSectionAt(x >> 4, y >> 4, z >> 4)
        return section.getLightAt(sourceType, x & 15, y & 15, z & 15);
    }

    setLightAt(sourceType, x, y, z, lightLevel) {
        if (!this.blockExists(x, y, z)) {
            return;
        }

        let section = this.getChunkSectionAt(x >> 4, y >> 4, z >> 4);
        if (!section) {
            return;
        }

        section.setLightAt(sourceType, x & 15, y & 15, z & 15, lightLevel);

        // Rebuild chunk
        this.onBlockChanged(x, y, z);
    }

    isSolidBlockAt(x, y, z) {
        let typeId = this.getBlockAt(x, y, z);
        if (typeId === 0) {
            return false;
        }

        let block = Block.getById(typeId);
        return block !== null && block.isSolid();
    }

    isTranslucentBlockAt(x, y, z) {
        let typeId = this.getBlockAt(x, y, z);
        return typeId === 0 || Block.getById(typeId).isTranslucent();
    }

    setBlockAt(x, y, z, type, data = 0) {
        if (y < 0 || y >= World.TOTAL_HEIGHT) {
            return;
        }

        // Get old block before changing
        let oldTypeId = this.getBlockAt(x, y, z);
        let oldBlock = Block.getById(oldTypeId);

        let chunk = this.getChunkAt(x >> 4, z >> 4);
        chunk.setBlockAt(x & 15, y, z & 15, type, data);

        // NBT block-entity lifecycle:
        //   - If the old block had an entity, remove it (closes the entity,
        //     releases resources, fires onClose()).
        //   - We remove whenever the block is destroyed (type === 0) OR the
        //     block type is changing. When the same block type is re-placed
        //     (e.g. just a data update), the entity survives.
        if (oldTypeId !== type || type === 0) {
            this.removeBlockEntity(x, y, z);
        }

        // Call onBlockRemoved for the old block if it's being replaced
        if (oldBlock && oldBlock.onBlockRemoved && (type === 0 || oldTypeId !== type)) {
            oldBlock.onBlockRemoved(this, x, y, z);
        }

        // Call onBlockPlaced for the new block if it's being placed
        if (type !== 0 && type !== oldTypeId) {
            let newBlock = Block.getById(type);
            if (newBlock) {
                if (newBlock.onBlockPlaced) {
                    newBlock.onBlockPlaced(this, x, y, z, null);
                }
                // Auto-create a BlockEntity if the new block type opts in.
                if (newBlock.hasBlockEntity && newBlock.hasBlockEntity()) {
                    let entity = newBlock.createBlockEntity(this, x, y, z);
                    if (entity) {
                        // Seed the entity from the block data nibble that
                        // onBlockPlaced (or the placement code) already wrote.
                        if (typeof entity.readFromBlockData === "function") {
                            entity.readFromBlockData(this.getBlockDataAt(x, y, z));
                        }
                        this.setBlockEntity(x, y, z, entity);
                        if (typeof newBlock.onBlockEntityLoaded === "function") {
                            newBlock.onBlockEntityLoaded(this, x, y, z, entity);
                        }
                    }
                }
            }

            // Tell surrounding blocks that a new block appeared next to them
            // (observers/repeaters watch for this to detect state changes).
            this.notifyNeighborBlockChange(x, y, z);
        }

        // Schedule ticks for adjacent blocks when a block is removed
        if (type === 0) {
            this.scheduleNeighborTicks(x, y, z);
            this.notifyNeighborBlockChange(x, y, z);
        }

        // Rebuild chunk
        this.onBlockChanged(x, y, z);
    }

    /**
     * Apply a server-authoritative block change without running any block
     * callbacks (onBlockPlaced / onBlockAdded / onBlockRemoved / neighbor
     * notification). In multiplayer the server runs the bluestone/door
     * simulation, so clients must trust the received state verbatim instead of
     * re-running placement logic (which would e.g. recompute a door's facing
     * from the local player's yaw and desync it from the server).
     */
    setBlockAtNoEvents(x, y, z, type, data = 0) {
        if (y < 0 || y >= World.TOTAL_HEIGHT) {
            return;
        }

        let chunk = this.getChunkAt(x >> 4, z >> 4);
        if (!chunk) {
            return;
        }

        let prevTypeId = this.getBlockAt(x, y, z);
        if (prevTypeId === type && this.getBlockDataAt(x, y, z) === data) {
            return;
        }

        let section = chunk.getSection(y >> 4);
        section.setBlockAt(x & 15, y & 15, z & 15, type, data);

        // Keep block entities (if any) in sync so NBT and rendering stay
        // correct for the received state.
        if (prevTypeId !== type || type === 0) {
            this.removeBlockEntity(x, y, z);
        }
        if (type !== 0 && type !== prevTypeId) {
            let newBlock = Block.getById(type);
            if (newBlock && newBlock.hasBlockEntity && newBlock.hasBlockEntity()) {
                let entity = newBlock.createBlockEntity(this, x, y, z);
                if (entity) {
                    if (typeof entity.readFromBlockData === "function") {
                        entity.readFromBlockData(this.getBlockDataAt(x, y, z));
                    }
                    this.setBlockEntity(x, y, z, entity);
                }
            }
        }

        // Refresh light the same way Chunk.setBlockAt would.
        this.updateLight(EnumSkyBlock.SKY, x, y, z, x, y, z);
        this.updateLight(EnumSkyBlock.BLOCK, x, y, z, x, y, z);

        // Rebuild chunk
        this.onBlockChanged(x, y, z);
    }

    // ------------------------------------------------------------------
    // Block Entity management (NBT-backed per-block state)
    // ------------------------------------------------------------------

    static blockEntityKey(x, y, z) {
        return `${x},${y},${z}`;
    }

    /**
     * Get the BlockEntity at the given position, or null.
     */
    getBlockEntity(x, y, z) {
        return this.blockEntities.get(World.blockEntityKey(x, y, z)) || null;
    }

    /**
     * Attach (or replace) a BlockEntity at the given position. The entity's
     * world reference and position are synced, and the owning chunk's
     * `blockEntities` set is updated so serialization picks it up.
     */
    setBlockEntity(x, y, z, entity) {
        if (!entity) {
            this.removeBlockEntity(x, y, z);
            return;
        }
        entity.world = this;
        entity.setPosition(x, y, z);

        // Track on the chunk for fast serialization
        let chunk = this.chunkExists(x >> 4, z >> 4) ? this.getChunkAt(x >> 4, z >> 4) : null;
        if (chunk && typeof chunk.addBlockEntity === "function") {
            chunk.addBlockEntity(entity);
        }

        this.blockEntities.set(World.blockEntityKey(x, y, z), entity);
    }

    /**
     * Remove (and close) any BlockEntity at the given position. Safe to call
     * when no entity exists. Returns the removed entity (or null).
     */
    removeBlockEntity(x, y, z) {
        let key = World.blockEntityKey(x, y, z);
        let entity = this.blockEntities.get(key);
        if (!entity) return null;

        if (typeof entity.onClose === "function") {
            try { entity.onClose(); } catch (e) { console.warn("BlockEntity onClose error:", e); }
        }

        this.blockEntities.delete(key);

        let chunk = this.chunkExists(x >> 4, z >> 4) ? this.getChunkAt(x >> 4, z >> 4) : null;
        if (chunk && typeof chunk.removeBlockEntity === "function") {
            chunk.removeBlockEntity(entity);
        }
        return entity;
    }

    /**
     * Move a block entity from one position to another (used when a piston
     * pushes a block that owns an entity). The block type at the new position
     * must already match — this method only relocates the entity.
     */
    moveBlockEntity(fromX, fromY, fromZ, toX, toY, toZ) {
        let entity = this.removeBlockEntity(fromX, fromY, fromZ);
        if (entity) {
            entity.setPosition(toX, toY, toZ);
            this.setBlockEntity(toX, toY, toZ, entity);
        }
        return entity;
    }

    /**
     * Called by BlockEntity.markDirty(). Marks the owning chunk as modified
     * and lets the block at this position react (e.g. schedule a render
     * rebuild).
     */
    onBlockEntityChanged(entity) {
        if (!entity) return;
        let chunk = this.chunkExists(entity.x >> 4, entity.z >> 4)
            ? this.getChunkAt(entity.x >> 4, entity.z >> 4)
            : null;
        if (chunk) chunk.isModified = true;

        let typeId = this.getBlockAt(entity.x, entity.y, entity.z);
        let block = Block.getById(typeId);
        if (block && typeof block.onBlockEntityChanged === "function") {
            block.onBlockEntityChanged(this, entity.x, entity.y, entity.z, entity);
        }
    }

    /**
     * Tick every loaded block entity once. Iterates a snapshot of the values
     * so entities can safely remove themselves during update().
     */
    tickBlockEntities() {
        if (this.blockEntities.size === 0) return;
        for (let entity of Array.from(this.blockEntities.values())) {
            if (entity.isClosed && entity.isClosed()) continue;
            if (typeof entity.update === "function") {
                try {
                    entity.update();
                } catch (e) {
                    console.warn("BlockEntity update error:", e);
                }
            }
        }
    }

    /**
     * Returns all block entities located in the given chunk. Delegates to
     * Chunk.getBlockEntities() when the chunk is loaded.
     */
    getBlockEntitiesInChunk(chunkX, chunkZ) {
        if (!this.chunkExists(chunkX, chunkZ)) return [];
        let chunk = this.getChunkAt(chunkX, chunkZ);
        return chunk && typeof chunk.getBlockEntities === "function"
            ? chunk.getBlockEntities()
            : [];
    }

    /**
     * Called by Chunk.deserialize after a chunk's block entities have been
     * rehydrated from NBT. Wires them into the world map. The chunk's own
     * blockEntities list is updated by the caller.
     */
    loadBlockEntities(chunk) {
        if (!chunk || !Array.isArray(chunk.blockEntities)) return;
        for (let entity of chunk.blockEntities) {
            entity.world = this;
            this.blockEntities.set(World.blockEntityKey(entity.x, entity.y, entity.z), entity);
        }
    }

    /**
     * Called when a chunk is unloaded — removes all of its block entities
     * from the world map so they don't keep ticking.
     */
    unloadBlockEntities(chunk) {
        if (!chunk || !Array.isArray(chunk.blockEntities)) return;
        for (let entity of chunk.blockEntities) {
            let key = World.blockEntityKey(entity.x, entity.y, entity.z);
            let current = this.blockEntities.get(key);
            if (current === entity) {
                if (typeof entity.onClose === "function") {
                    try { entity.onClose(); } catch (e) { console.warn(e); }
                }
                this.blockEntities.delete(key);
            }
        }
        chunk.blockEntities = [];
    }

    scheduleNeighborTicks(x, y, z) {
        // Schedule ticks for all adjacent blocks
        let faces = [
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: -1, z: 0 }
        ];

        for (let face of faces) {
            let checkX = x + face.x;
            let checkY = y + face.y;
            let checkZ = z + face.z;

            let typeId = this.getBlockAt(checkX, checkY, checkZ);
            if (typeId !== 0) {
                let block = Block.getById(typeId);
                if (block && block.onBlockTick) {
                    this.scheduleBlockTick(checkX, checkY, checkZ, 1);
                }
            }
        }
    }

    /**
     * Notify adjacent blocks that the block at (x, y, z) changed type
     * (placed or removed). Only blocks that explicitly implement
     * `onNeighborBlockChange` (e.g. observers, repeaters) are affected.
     */
    notifyNeighborBlockChange(x, y, z) {
        let faces = [
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: -1, z: 0 }
        ];

        for (let face of faces) {
            let checkX = x + face.x;
            let checkY = y + face.y;
            let checkZ = z + face.z;

            let typeId = this.getBlockAt(checkX, checkY, checkZ);
            if (typeId === 0) continue;

            let block = Block.getById(typeId);
            if (block && typeof block.onNeighborBlockChange === "function") {
                block.onNeighborBlockChange(this, checkX, checkY, checkZ);
            }
        }
    }

    setBlockDataAt(x, y, z, data) {
        this.getChunkAt(x >> 4, z >> 4).setBlockDataAt(x & 15, y, z & 15, data);

        // Keep the block entity (if any) in sync with the data nibble so NBT
        // serialization always captures the latest state.
        let entity = this.getBlockEntity(x, y, z);
        if (entity && typeof entity.readFromBlockData === "function") {
            entity.readFromBlockData(data);
        }
    }

    getBlockAt(x, y, z) {
        let chunkSection = this.getChunkAtBlock(x, y, z);
        return chunkSection == null ? 0 : chunkSection.getBlockAt(x & 15, y & 15, z & 15);
    }

    getBlockDataAt(x, y, z) {
        let chunkSection = this.getChunkAtBlock(x, y, z);
        return chunkSection == null ? 0 : chunkSection.getBlockDataAt(x & 15, y & 15, z & 15);
    }

    getBlockAtFace(x, y, z, face) {
        return this.getBlockAt(x + face.x, y + face.y, z + face.z);
    }

    getChunkSectionAt(chunkX, layerY, chunkZ) {
        const chunk = this.getChunkAt(chunkX, chunkZ);
        if (!chunk) {
            return null;
        }

        if (layerY < 0 || layerY >= World.TOTAL_HEIGHT / ChunkSection.SIZE) {
            return null;
        }

        return chunk.getSection(layerY);
    }

    onBlockChanged(x, y, z) {
        this.setModified(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1);
    }

    setModified(minX, minY, minZ, maxX, maxY, maxZ) {
        // To chunk coordinates
        minX = minX >> 4;
        maxX = maxX >> 4;
        minY = minY >> 4;
        maxY = maxY >> 4;
        minZ = minZ >> 4;
        maxZ = maxZ >> 4;

        const maxSectionY = Math.max(0, Math.floor(World.TOTAL_HEIGHT / ChunkSection.SIZE) - 1);

        // Minimum and maximum y
        minY = Math.max(0, minY);
        maxY = Math.min(maxSectionY, maxY);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    if (this.chunkExists(x, z)) {
                        const section = this.getChunkSectionAt(x, y, z);
                        if (section) {
                            section.isModified = true;
                        }
                    }
                }
            }
        }
    }

   rayTraceBlocks(from, to, slab = false) {
        let toX = MathHelper.floor(to.x);
        let toY = MathHelper.floor(to.y);
        let toZ = MathHelper.floor(to.z);
    
        let x = MathHelper.floor(from.x);
        let y = MathHelper.floor(from.y);
        let z = MathHelper.floor(from.z);
    
        let blockId = this.getBlockAt(x, y, z);
        let block = Block.getById(blockId);
    
        if (block != null && block.canInteract()) {
            let hit = block.collisionRayTrace(this, x, y, z, from, to);
            if (hit != null) {
                // Check for slab condition
                //console.log(slab, from.y, y);
                if (slab) {
                    if (hit.face === EnumBlockFace.TOP) {
                        return 0;
                    }
                    if (hit.face === EnumBlockFace.BOTTOM) {
                        return 1;
                    }
                    if (from.y - y >= 0.5) {
                        return 1;
                    }
                }
                return hit;
            }
        }
    
        let lastHit = null;
    
        let counter = 200;
        while (counter-- >= 0) {
            if (x === toX && y === toY && z === toZ) {
                return lastHit;
            }
    
            let hitX = true;
            let hitY = true;
            let hitZ = true;
    
            let nearestX1 = 999.0;
            let nearestY1 = 999.0;
            let nearestZ1 = 999.0;
    
            if (toX > x) {
                nearestX1 = x + 1.0;
            } else if (toX < x) {
                nearestX1 = x;
            } else {
                hitX = false;
            }
    
            if (toY > y) {
                nearestY1 = y + 1.0;
            } else if (toY < y) {
                nearestY1 = y;
            } else {
                hitY = false;
            }
    
            if (toZ > z) {
                nearestZ1 = z + 1.0;
            } else if (toZ < z) {
                nearestZ1 = z;
            } else {
                hitZ = false;
            }
    
            let nearestX = 999.0;
            let nearestY = 999.0;
            let nearestZ = 999.0;
    
            let diffX = to.x - from.x;
            let diffY = to.y - from.y;
            let diffZ = to.z - from.z;
    
            if (hitX) {
                nearestX = (nearestX1 - from.x) / diffX;
            }
            if (hitY) {
                nearestY = (nearestY1 - from.y) / diffY;
            }
            if (hitZ) {
                nearestZ = (nearestZ1 - from.z) / diffZ;
            }
    
            if (nearestX === -0.0) {
                nearestX = -1.0E-4;
            }
            if (nearestY === -0.0) {
                nearestY = -1.0E-4;
            }
            if (nearestZ === -0.0) {
                nearestZ = -1.0E-4;
            }
    
            let face;
            if (nearestX < nearestY && nearestX < nearestZ) {
                face = toX > x ? EnumBlockFace.WEST : EnumBlockFace.EAST;
                from = new Vector3(nearestX1, from.y + diffY * nearestX, from.z + diffZ * nearestX);
            } else if (nearestY < nearestZ) {
                face = toY > y ? EnumBlockFace.BOTTOM : EnumBlockFace.TOP;
                from = new Vector3(from.x + diffX * nearestY, nearestY1, from.z + diffZ * nearestY);
            } else {
                face = toZ > z ? EnumBlockFace.NORTH : EnumBlockFace.SOUTH;
                from = new Vector3(from.x + diffX * nearestZ, from.y + diffY * nearestZ, nearestZ1);
            }
    
            x = MathHelper.floor(from.x) - (face === EnumBlockFace.EAST ? 1 : 0);
            y = MathHelper.floor(from.y) - (face === EnumBlockFace.TOP ? 1 : 0);
            z = MathHelper.floor(from.z) - (face === EnumBlockFace.SOUTH ? 1 : 0);
    
            blockId = this.getBlockAt(x, y, z);
            block = Block.getById(blockId);
            //console.log(blockId);

            if (blockId === 0) { 
                let blockBelowId = this.getBlockAt(x, y - 1, z);
                //console.log(blockBelowId);
                
                if (blockBelowId !== 0) { 
                    let blockBelow = Block.getById(blockBelowId);
                    
                    if (blockBelow != null && blockBelow.boundingBox && blockBelow.boundingBox.maxY > 1.0) {
                        y -= 1; 
                        blockId = blockBelowId;
                    }
                }
            }
    
            if (block != null && block.canInteract()) {
                let hit = block.collisionRayTrace(this, x, y, z, from, to);
                if (hit != null) {
                    // Check for slab condition
                    //console.log(slab, from.y, y);
                    if (slab) {
                        if (hit.face === EnumBlockFace.TOP) {
                            return 0;
                        }
                        if (hit.face === EnumBlockFace.BOTTOM) {
                            return 1;
                        }
                        if (from.y - y >= 0.5) {
                            return 1;
                        }
                    }
                    return hit;
                }
            }
        }
    
        return lastHit;
    }

    getCelestialAngle(partialTicks) {
        return MathHelper.calculateCelestialAngle(this.time, partialTicks);
    }

    getTemperature(x, y, z) {
        return 0.75; // TODO implement biomes
    }

    getHumidity(x, y, z) {
        return 0.85; // TODO implement biomes
    }

    getSkyColor(x, z, partialTicks) {
        let angle = this.getCelestialAngle(partialTicks);
        let brightness = Math.cos(angle * 3.141593 * 2.0) * 2.0 + 0.5;

        if (brightness < 0.0) {
            brightness = 0.0;
        }
        if (brightness > 1.0) {
            brightness = 1.0;
        }

        let temperature = this.getTemperature(x, z);
        let rgb = this.getSkyColorByTemp(temperature);

        let red = (rgb >> 16 & 0xff) / 255;
        let green = (rgb >> 8 & 0xff) / 255;
        let blue = (rgb & 0xff) / 255;

        red *= brightness;
        green *= brightness;
        blue *= brightness;

        return new Vector3(red, green, blue);
    }

    getFogColor(partialTicks) {
        let angle = this.getCelestialAngle(partialTicks);
        let rotation = Math.cos(angle * Math.PI * 2.0) * 2.0 + 0.5;
        rotation = MathHelper.clamp(rotation, 0.0, 1.0);

        let x = 0.7529412;
        let y = 0.84705883;
        let z = 1.0;

        x = x * (rotation * 0.94 + 0.06);
        y = y * (rotation * 0.94 + 0.06);
        z = z * (rotation * 0.91 + 0.09);

        return new Vector3(x, y, z);
    }

    getSunriseSunsetColor(partialTicks) {
        let angle = this.getCelestialAngle(partialTicks);
        let rotation = Math.cos(angle * Math.PI * 2.0);

        let min = 0;
        let max = 0.4;

        // Check if rotation is inside of sunrise or sunset
        if (rotation >= -max && rotation <= max) {
            let factor = ((rotation - min) / max) * 0.5 + 0.5;
            let strength = Math.pow(1.0 - (1.0 - Math.sin(factor * Math.PI)) * 0.99, 2);

            // Calculate colors for sunrise and sunset
            return new Vector4(
                factor * 0.3 + 0.7,
                factor * factor * 0.7 + 0.2,
                0.2,
                strength
            );
        } else {
            return null;
        }
    }

    getStarBrightness(partialTicks) {
        let angle = this.getCelestialAngle(partialTicks);
        let rotation = 1.0 - (Math.cos(angle * Math.PI * 2.0) * 2.0 + 0.75);
        rotation = MathHelper.clamp(rotation, 0.0, 1.0);
        return rotation * rotation * 0.5;
    }

    getLightBrightnessForEntity(entity) {
        let level = this.getTotalLightAt(Math.floor(entity.x), Math.floor(entity.y), Math.floor(entity.z));
        return Math.max(level / 15, 0.1);
    }

    getLightBrightness(x, y, z) {
        let level = this.getTotalLightAt(x, y, z);
        return Math.max(level / 15, 0.1);
    }

    getItemLightValue(itemTypeId) {
        if (!this.minecraft.settings.dynamicLights) {
            return 0;
        }

        // Check if item is a light-emitting block
        const block = Block.getById(itemTypeId);
        if (block) {
            return block.getLightValue(this, 0, 0, 0);
        }

        return 0;
    }

    updateDynamicLighting() {
        if (!this.minecraft.player) return;

        const player = this.minecraft.player;
        const playerX = Math.floor(player.x);
        const playerY = Math.floor(player.y);
        const playerZ = Math.floor(player.z);

        // Check if player moved at all
        if (playerX !== this.lastPlayerX || playerY !== this.lastPlayerY || playerZ !== this.lastPlayerZ) {
            this.lastPlayerX = playerX;
            this.lastPlayerY = playerY;
            this.lastPlayerZ = playerZ;
            this.markChunksAroundPlayerDirty();
        }
    }

    markChunksAroundPlayerDirty() {
        if (!this.minecraft.player || !this.chunkProvider) return;

        const player = this.minecraft.player;
        const playerChunkX = Math.floor(player.x) >> 4;
        const playerChunkZ = Math.floor(player.z) >> 4;
        const playerSectionY = Math.floor(player.y) >> 4;
        const lightRadius = 1; // Update neighboring chunks

        // Mark only affected sections in chunks around player
        for (let dx = -lightRadius; dx <= lightRadius; dx++) {
            for (let dz = -lightRadius; dz <= lightRadius; dz++) {
                const chunkX = playerChunkX + dx;
                const chunkZ = playerChunkZ + dz;

                const chunk = this.chunkProvider.getChunkAt(chunkX, chunkZ);
                if (chunk) {
                    // Only mark sections that could be affected by light (current + adjacent)
                    // Light radius is 8 blocks, so it can affect current section and adjacent ones
                    const sectionsToUpdate = [playerSectionY - 1, playerSectionY, playerSectionY + 1];
                    
                    for (let sectionY of sectionsToUpdate) {
                        if (sectionY >= 0 && sectionY < 16) {
                            const section = chunk.sections[sectionY];
                            if (section && !section.isEmpty()) {
                                section.isModified = true;
                                // Queue for rebuild via WorldRenderer
                                if (this.minecraft.worldRenderer && 
                                    !this.minecraft.worldRenderer.chunkSectionUpdateQueue.includes(section)) {
                                    this.minecraft.worldRenderer.chunkSectionUpdateQueue.push(section);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    getTotalLightAt(x, y, z) {
        if (!this.blockExists(x, y, z)) {
            return 15;
        }

        let section = this.getChunkSectionAt(x >> 4, y >> 4, z >> 4);
        let baseLight = section.getTotalLightAt(x & 15, y & 15, z & 15);

        // Add dynamic lighting from held items if enabled
        if (this.minecraft.settings.dynamicLights && this.minecraft.player) {
            const player = this.minecraft.player;
            const playerX = Math.floor(player.x);
            const playerY = Math.floor(player.y);
            const playerZ = Math.floor(player.z);

            // Check if this position is near the player
            const dx = x - playerX;
            const dy = y - playerY;
            const dz = z - playerZ;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (distance < 8) { // Dynamic light radius
                // Get held item light value
                const heldItem = player.inventory.getItemInSelectedSlot();
                const itemLight = this.getItemLightValue(heldItem.getType());

                if (itemLight > 0) {
                    // Calculate falloff based on distance
                    const falloff = Math.max(0, 1 - (distance / 8));
                    const dynamicLight = Math.floor(itemLight * falloff);
                    baseLight = Math.max(baseLight, dynamicLight);
                }
            }
        }

        return baseLight;
    }

    getSkyColorByTemp(temperature) {
        temperature /= 3;
        if (temperature < -1) {
            temperature = -1;
        }
        if (temperature > 1.0) {
            temperature = 1.0;
        }
        return MathHelper.hsbToRgb(0.6222222 - temperature * 0.05, 0.5 + temperature * 0.1, 1.0);
    }

    calculateSkylightSubtracted(partialTicks) {
        let angle = this.getCelestialAngle(partialTicks);
        let level = 1.0 - (Math.cos(angle * 3.141593 * 2.0) * 2.0 + 0.5);
        if (level < 0.0) {
            level = 0.0;
        }
        if (level > 1.0) {
            level = 1.0;
        }
        return Math.floor(level * 11);
    }

    addEntity(entity) {
        // Assign unique ID if entity doesn't have one
        if (entity.id === -2 || entity.id === undefined) {
            entity.id = this.nextEntityId++;
        }

        // Check if entity with same ID already exists
        let existing = this.getEntityById(entity.id);
        if (existing !== null) {
            console.warn(`Entity with ID ${entity.id} already exists, removing old entity`);
            this.removeEntityById(entity.id);
        }

        this.entities.push(entity);
        try {
            entity.initRenderer();
            this.group.add(entity.renderer.group);
        } catch (e) {
            console.error(`Failed to initialize renderer for entity ${entity.id}:`, e);
            this.entities.pop();
        }
    }

    removeEntityById(id) {
        let entity = this.getEntityById(id);
        if (entity !== null) {
            let index = this.entities.indexOf(entity);
            if (index !== -1) {
                this.entities.splice(index, 1);
            }
            if (entity.renderer && entity.renderer.group) {
                this.group.remove(entity.renderer.group);
            }
            if (entity.renderer && entity.renderer.nametagGroup) {
                const overlay = this.minecraft.worldRenderer.overlay;
                if (entity.renderer.nametagGroup.parent === overlay) {
                    overlay.remove(entity.renderer.nametagGroup);
                }
                if (entity.renderer.nametagTexture) {
                    entity.renderer.nametagTexture.dispose();
                }
            }
            if (entity.renderer && entity.renderer.shadowGroup) {
                this.minecraft.worldRenderer.scene.remove(entity.renderer.shadowGroup);
                if (entity.renderer.shadowMesh) {
                    if (entity.renderer.shadowMesh.geometry) {
                        entity.renderer.shadowMesh.geometry.dispose();
                    }
                    if (entity.renderer.shadowMesh.material) {
                        entity.renderer.shadowMesh.material.dispose();
                    }
                }
            }
        }
    }

    getEntityById(id) {
        for (let entity of this.entities) {
            if (entity && entity.id === id) {
                return entity;
            }
        }
        return null;
    }

    getSpawn() {
        return this.spawn;
    }

    setSpawn(x, z) {
        let y = this.getHeightAt(x, z);
        this.spawn = new Vector3(x, y + 8, z);
    }

    loadSpawnChunks() {
        let viewDistance = this.minecraft.settings.viewDistance;
        let spawnChunkX = this.spawn.x >> 4;
        let spawnChunkZ = this.spawn.z >> 4;
        for (let x = -viewDistance; x <= viewDistance; x++) {
            for (let z = -viewDistance; z <= viewDistance; z++) {
                this.getChunkAt(spawnChunkX + x, spawnChunkZ + z);
            }
        }
        this.spawn.y = this.getHeightAt(this.spawn.x, this.spawn.z) + 8;
    }

    getChunkProvider() {
        return this.chunkProvider;
    }

    clearChunks() {
        if (this.chunkProvider !== null) {
            this.chunkProvider.clearChunks();
        }
    }

    clearEntities() {
        for (let entity of this.entities) {
            this.removeEntityById(entity.id);
        }
    }

}