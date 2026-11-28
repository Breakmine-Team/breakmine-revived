import ChunkProvider from "./ChunkProvider.js";
import Chunk from "../Chunk.js";
import Block from "../block/Block.js";
import { BlockRegistry } from "../block/BlockRegistry.js";
import { buildTerrainPayload } from "../generator/JsonTerrain.js";

const SECTION_COUNT = 16;
const SECTION_VOLUME = 16 * 16 * 16;

export default class ChunkProviderClient extends ChunkProvider {

    // Generation is expensive, so a few jobs are kept in flight at a time and
    // worked outwards from the player.
    static MAX_GENERATION_JOBS = 4;

    constructor(world) {
        super(world);

        this.emptyChunk = new Chunk(world, 0, 0);
        this.emptyChunk.generateSkylightMap();
        this.emptyChunk.generateBlockLightMap();

        this.pendingChunks = new Map();
        this.pendingBlockChanges = new Map();
        this.terrain = null;
        this.terrainWorker = null;
        // Chunks the server sent itself (they hold block changes), which this
        // client must not overwrite with locally generated terrain.
        this.serverChunks = new Set();
        this.nextJobId = 1;
        this.blockTableSignature = null;

        this.worker = null;
        try {
            this.worker = new Worker(new URL("../worker/chunkdata.worker.js", import.meta.url), { type: "module" });
            this.worker.onmessage = (event) => this.onWorkerMessage(event.data);
            this.worker.onerror = (event) => this.onWorkerError(event);
        } catch (error) {
            console.error("Chunk data worker could not be created; falling back to main-thread chunk filling.", error);
            this.worker = null;
        }
    }

    getChunkAt(x, z) {
        let index = x + (z << 16);
        let chunk = this.chunks.get(index);
        return typeof chunk === 'undefined' ? this.emptyChunk : chunk;
    }

    isChunkReady(x, z) {
        const key = x + (z << 16);
        const chunk = this.chunks.get(key);
        return chunk !== undefined && chunk.isTerrainPopulated && !this.pendingChunks.has(key);
    }

    hasTerrain() {
        return this.terrain !== null;
    }

    // Called for the "terrain" message: remember how chunks are generated.
    // Flat worlds share one payload; seeded worlds generate per column in a
    // worker.
    setTerrain(descriptor) {
        // Switching to a different descriptor (a /server switch) would otherwise
        // keep the previous world's locally generated columns around.
        if (this.terrain !== null && this.terrain.generated !== undefined) {
            for (const key of Array.from(this.terrain.generated)) {
                this.unloadChunk((key << 16) >> 16, key >> 16);
            }
        }
        this.clearTerrain();

        if (descriptor.generator === "normal") {
            this.terrain = {
                descriptor,
                generator: descriptor.generator,
                seed: descriptor.seed,
                pending: new Set(),
                generated: new Set()
            };

            try {
                this.terrainWorker = new Worker(
                    new URL("../worker/terraingen.worker.js", import.meta.url),
                    { type: "module" }
                );
                this.terrainWorker.onmessage = (event) => this.onTerrainWorkerMessage(event.data);
                this.terrainWorker.onerror = (event) => {
                    console.error("Terrain generator worker failed:", event && event.message ? event.message : event);
                };
            } catch (error) {
                console.error("Terrain generator worker could not be created:", error);
                this.terrainWorker = null;
            }
            return;
        }

        const payload = buildTerrainPayload(descriptor);
        this.terrain = {
            descriptor,
            data: payload.data,
            mask: payload.mask
        };
    }

    clearTerrain() {
        if (this.terrainWorker !== null) {
            try {
                this.terrainWorker.terminate();
            } catch (error) {
            }
            this.terrainWorker = null;
        }
        this.terrain = null;
    }

    // Generates any missing terrain chunks around a world position.
    updateTerrainChunks(x, z) {
        const terrain = this.terrain;
        if (terrain === null) {
            return;
        }

        const centerX = Math.floor(x) >> 4;
        const centerZ = Math.floor(z) >> 4;
        const radius = terrain.descriptor.viewDistance;

        if (terrain.generated !== undefined) {
            this.unloadDistantTerrainChunks(centerX, centerZ, radius + 2);
        }

        const missing = [];
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const chunkX = centerX + dx;
                const chunkZ = centerZ + dz;
                const key = chunkX + (chunkZ << 16);

                if (this.chunks.has(key) || this.pendingChunks.has(key) || this.serverChunks.has(key)) {
                    continue;
                }
                if (terrain.pending !== undefined && terrain.pending.has(key)) {
                    continue;
                }

                missing.push([chunkX, chunkZ, dx * dx + dz * dz]);
            }
        }

        if (missing.length === 0) {
            return;
        }

        if (terrain.pending === undefined) {
            for (const [chunkX, chunkZ] of missing) {
                this.fillChunkFromPacket(chunkX, chunkZ, terrain.data, terrain.mask);
            }
            return;
        }

        missing.sort((a, b) => a[2] - b[2]);
        const room = ChunkProviderClient.MAX_GENERATION_JOBS - terrain.pending.size;
        for (let i = 0; i < Math.min(room, missing.length); i++) {
            this.requestTerrainChunk(missing[i][0], missing[i][1]);
        }
    }

    requestTerrainChunk(chunkX, chunkZ) {
        if (this.terrainWorker === null || this.terrain === null) {
            return;
        }

        this.terrain.pending.add(chunkX + (chunkZ << 16));
        this.terrainWorker.postMessage({
            type: "generate",
            chunkX: chunkX,
            chunkZ: chunkZ,
            worldType: this.terrain.generator,
            seed: this.terrain.seed
        });
    }

    onTerrainWorkerMessage(message) {
        const terrain = this.terrain;
        if (terrain === null || message === null || message === undefined || message.type !== "generated") {
            return;
        }

        const key = message.x + (message.z << 16);
        if (terrain.pending === undefined || !terrain.pending.delete(key)) {
            return;
        }
        if (this.serverChunks.has(key)) {
            return;
        }

        terrain.generated.add(key);
        this.fillChunkFromPacket(message.x, message.z, new Uint8Array(message.data), message.mask, true);
    }

    // Locally generated chunks are dropped when the player walks away; chunks
    // the server sent are unloaded by its own unload messages.
    unloadDistantTerrainChunks(centerX, centerZ, keepDistance) {
        for (const key of Array.from(this.terrain.generated)) {
            const chunkX = (key << 16) >> 16;
            const chunkZ = key >> 16;

            if (Math.abs(chunkX - centerX) <= keepDistance && Math.abs(chunkZ - centerZ) <= keepDistance) {
                continue;
            }

            this.terrain.generated.delete(key);
            if (this.terrain.pending !== undefined) {
                this.terrain.pending.delete(key);
            }
            this.unloadChunk(chunkX, chunkZ);
        }
    }

    loadChunk(x, z) {
        let index = x + (z << 16);
        let chunk = this.chunks.get(index);

        if (typeof chunk !== 'undefined') {
            chunk.isTerrainPopulated = false;
            return chunk;
        }

        chunk = new Chunk(this.world, x, z);
        chunk.heightMap = new Uint16Array(256);
        chunk.loaded = true;
        chunk.isTerrainPopulated = false;
        this.chunks.set(index, chunk);
        this.world.group.add(chunk.group);

        return chunk;
    }

    
    fillChunkFromPacket(x, z, data, mask, fromTerrain = false) {
        const key = x + (z << 16);
        if (!fromTerrain) {
            // The server's chunk holds block changes, so it wins over terrain
            // this client would have generated for the same column.
            this.serverChunks.add(key);
            if (this.terrain !== null && this.terrain.pending !== undefined) {
                this.terrain.pending.delete(key);
            }
        }

        const chunk = this.loadChunk(x, z);
        const jobId = this.nextJobId++;

        this.pendingChunks.set(key, {
            jobId,
            chunk,
            data,
            mask
        });

        if (this.worker === null) {
            this.fillPendingOnMain(key);
            return;
        }

        this.syncBlockTable();
        this.worker.postMessage({
            type: "fill",
            id: jobId,
            x,
            z,
            mask,
            data
        });
    }

    syncBlockTable() {
        if (this.worker === null) {
            return;
        }

        const signature = `${Block.blocks.size}:${BlockRegistry.idMap.size}:${BlockRegistry.registry.size}`;
        if (signature === this.blockTableSignature) {
            return;
        }

        const validBlocks = new Uint8Array(4096);
        const opacityById = new Float32Array(4096);
        const dynamicOpacityById = new Uint8Array(4096);
        validBlocks[0] = 0;
        opacityById[0] = 0;

        for (let id = 1; id < 4096; id++) {
            const block = Block.getById(id);
            if (block === null || block === undefined) {
                continue;
            }

            validBlocks[id] = 1;

            let opacity = 1;
            try {
                if (typeof block.getOpacity === "function") {
                    const value = block.getOpacity(null, 0, 0, 0, block);
                    if (Number.isFinite(value)) {
                        opacity = value;
                    }
                }
            } catch (error) {
                opacity = 1;
            }
            opacityById[id] = opacity;

            if (block.getOpacity !== Block.prototype.getOpacity && block.getOpacity.length >= 4) {
                dynamicOpacityById[id] = 1;
            }
        }

        this.blockTableSignature = signature;
        this.worker.postMessage({
            type: "config",
            validBlocks,
            opacityById,
            dynamicOpacityById
        }, [validBlocks.buffer, opacityById.buffer, dynamicOpacityById.buffer]);
    }

    onWorkerMessage(message) {
        if (message === null || message === undefined) {
            return;
        }

        if (message.type === "error") {
            const key = message.x + (message.z << 16);
            const pending = this.pendingChunks.get(key);
            if (pending && pending.jobId === message.id) {
                console.error("Chunk data worker failed to process a chunk:", message.message);
                this.fillPendingOnMain(key);
            }
            return;
        }

        if (message.type !== "filled") {
            return;
        }

        const key = message.x + (message.z << 16);
        const pending = this.pendingChunks.get(key);
        if (!pending || pending.jobId !== message.id || this.chunks.get(key) !== pending.chunk) {
            return;
        }

        this.pendingChunks.delete(key);
        this.applyProcessedChunk(pending.chunk, message);
        this.flushPendingBlockChanges(key);
    }

    onWorkerError(event) {
        console.error("Chunk data worker error:", event && event.message ? event.message : event);
        if (this.worker !== null) {
            try {
                this.worker.terminate();
            } catch (error) {
            }
            this.worker = null;
        }

        for (const key of Array.from(this.pendingChunks.keys())) {
            this.fillPendingOnMain(key);
        }
    }

    applyProcessedChunk(chunk, result) {
        for (let layer = 0; layer < SECTION_COUNT; layer++) {
            const section = chunk.sections[layer];
            const sectionData = result.sections[layer];
            const skyLight = result.skyLights[layer];

            if (sectionData === null || sectionData === undefined) {
                if (!section.empty) {
                    section.blocks = new Uint16Array(SECTION_VOLUME);
                    section.blocksData = new Uint8Array(SECTION_VOLUME);
                    section.empty = true;
                }
            } else {
                section.blocks = sectionData.blocks;
                section.blocksData = sectionData.blocksData;
                section.empty = false;
            }

            section.blockLight = [];
            section.skyLight = skyLight;

            section.isModified = true;
            section.isDirty = true;
            section.translucentMesh = null;
            section.invalidateFaceSolidCache();
        }

        chunk.heightMap = result.heightMap;
        chunk.loaded = true;
        chunk.isTerrainPopulated = true;

        if (result.unknownCells && result.unknownCells.length > 0) {
            for (let i = 0; i < result.unknownCells.length; i += 3) {
                const layer = result.unknownCells[i];
                const index = result.unknownCells[i + 1];
                const typeId = result.unknownCells[i + 2];
                if (Block.getById(typeId) === null) {
                    const section = chunk.sections[layer];
                    if (section) {
                        section.blocks[index] = 1;
                        section.invalidateFaceSolidCache();
                    }
                }
            }
        }

        if (result.needsMainLight) {
            for (let x = 0; x < 16; x++) {
                for (let z = 0; z < 16; z++) {
                    chunk.updateHeightMapAt(x, z);
                }
            }
            this.world.updateChunkLight(chunk);
        } else {
            this.world.queueChunkLight(chunk);
        }
    }

    fillPendingOnMain(key) {
        const pending = this.pendingChunks.get(key);
        if (!pending) {
            return;
        }

        this.pendingChunks.delete(key);
        const chunk = pending.chunk;
        chunk.loaded = true;

        for (const section of chunk.sections) {
            section.blocks = new Uint16Array(SECTION_VOLUME);
            section.blocksData = new Uint8Array(SECTION_VOLUME);
            section.blockLight = [];
            section.skyLight = [];
            section.empty = true;
            section.isModified = true;
            section.isDirty = true;
            section.translucentMesh = null;
            section.invalidateFaceSolidCache();
        }

        chunk.fillChunk(pending.data, pending.mask, true);
        chunk.isTerrainPopulated = true;
        this.flushPendingBlockChanges(key);
    }

    deferBlockChange(x, y, z, typeId, data) {
        const key = (x >> 4) + ((z >> 4) << 16);
        if (!this.pendingChunks.has(key)) {
            return false;
        }

        let changes = this.pendingBlockChanges.get(key);
        if (changes === undefined) {
            changes = [];
            this.pendingBlockChanges.set(key, changes);
        }
        changes.push({ x, y, z, typeId, data });
        return true;
    }

    flushPendingBlockChanges(key) {
        const changes = this.pendingBlockChanges.get(key);
        if (changes === undefined) {
            return;
        }

        this.pendingBlockChanges.delete(key);
        if (!this.chunks.has(key)) {
            return;
        }

        for (const change of changes) {
            this.world.setBlockAtNoEvents(change.x, change.y, change.z, change.typeId, change.data);
        }
    }

    clearChunks() {
        this.serverChunks.clear();
        if (this.terrain !== null) {
            if (this.terrain.generated !== undefined) this.terrain.generated.clear();
            if (this.terrain.pending !== undefined) this.terrain.pending.clear();
        }
        super.clearChunks();
    }

    unloadChunk(x, z) {
        const key = x + (z << 16);
        this.pendingChunks.delete(key);
        this.pendingBlockChanges.delete(key);
        this.serverChunks.delete(key);
        if (this.terrain !== null) {
            if (this.terrain.generated !== undefined) this.terrain.generated.delete(key);
            if (this.terrain.pending !== undefined) this.terrain.pending.delete(key);
        }
        super.unloadChunk(x, z);
    }

    terminate() {
        if (this.worker !== null) {
            this.worker.terminate();
            this.worker = null;
        }
        this.clearTerrain();
        this.pendingChunks.clear();
        this.pendingBlockChanges.clear();
    }

}
