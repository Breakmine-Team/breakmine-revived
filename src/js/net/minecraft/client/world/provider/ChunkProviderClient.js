import ChunkProvider from "./ChunkProvider.js";
import Chunk from "../Chunk.js";
import Block from "../block/Block.js";
import { BlockRegistry } from "../block/BlockRegistry.js";

const SECTION_COUNT = 16;
const SECTION_VOLUME = 16 * 16 * 16;

export default class ChunkProviderClient extends ChunkProvider {

    constructor(world) {
        super(world);

        this.emptyChunk = new Chunk(world, 0, 0);
        this.emptyChunk.generateSkylightMap();
        this.emptyChunk.generateBlockLightMap();

        // Full chunks are decoded and lit by a worker, then installed here.
        // Partial chunk updates stay synchronous: they are small and need the
        // chunk's existing sections.
        this.pendingChunks = new Map();
        this.pendingBlockChanges = new Map();
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

    loadChunk(x, z) {
        let index = x + (z << 16);
        let chunk = this.chunks.get(index);

        // A full chunk can arrive while the previous one is still being used.
        // Keep the old data visible until the worker result is ready rather
        // than removing the chunk and leaving a hole under the player.
        if (typeof chunk !== 'undefined') {
            chunk.isTerrainPopulated = false;
            return chunk;
        }

        chunk = new Chunk(this.world, x, z);
        // An empty chunk reads height 0 and sky light 15. The worker replaces
        // both once it has decoded the packet.
        chunk.heightMap = new Uint16Array(256);
        chunk.loaded = true;
        chunk.isTerrainPopulated = false;
        this.chunks.set(index, chunk);
        this.world.group.add(chunk.group);

        return chunk;
    }

    /**
     * Install a full chunk packet. The worker decodes the block arrays and
     * prepares the heightmap and sky-light column values; the main thread only
     * copies the result into the chunk and queues the cross-chunk light flood.
     */
    fillChunkFromPacket(x, z, data, mask) {
        const key = x + (z << 16);
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
        // Do not transfer `data`: the main thread keeps it so a worker failure
        // can fall back to the original synchronous path.
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
                // A block that cannot answer without a world is conservatively
                // opaque. If it is present in a chunk, the worker asks the
                // main thread to recompute the light there.
                opacity = 1;
            }
            opacityById[id] = opacity;

            // Static opacity overrides take no arguments. Anything that takes
            // the world can depend on metadata or position, so leave the light
            // pass to the main thread when such a block is present.
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
                // Ignore termination errors; the fallback below is what matters.
            }
            this.worker = null;
        }

        // Recover every in-flight chunk with the original synchronous path.
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

            // Empty sections below floating terrain need their computed
            // darker sky light too; the default path would otherwise return
            // 15 for the whole section.
            section.blockLight = [];
            section.skyLight = skyLight;

            section.isModified = true;
            section.isDirty = true;
            section.translucentMesh = null;
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
                    }
                }
            }
        }

        if (result.needsMainLight) {
            // The worker could not evaluate opacity for every block (unknown
            // mod block or a world-dependent opacity). Recompute with the
            // authoritative block table and metadata on the main thread.
            for (let x = 0; x < 16; x++) {
                for (let z = 0; z < 16; z++) {
                    chunk.updateHeightMapAt(x, z);
                }
            }
            this.world.updateChunkLight(chunk);
        } else {
            // The worker already produced the per-column sky light and zeroed
            // block light; only the border flood remains.
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

        // A full chunk replaces every section, including sections that were
        // present in an older version of this chunk.
        for (const section of chunk.sections) {
            section.blocks = new Uint16Array(SECTION_VOLUME);
            section.blocksData = new Uint8Array(SECTION_VOLUME);
            section.blockLight = [];
            section.skyLight = [];
            section.empty = true;
            section.isModified = true;
            section.isDirty = true;
            section.translucentMesh = null;
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

    unloadChunk(x, z) {
        const key = x + (z << 16);
        this.pendingChunks.delete(key);
        this.pendingBlockChanges.delete(key);
        super.unloadChunk(x, z);
    }

    terminate() {
        if (this.worker !== null) {
            this.worker.terminate();
            this.worker = null;
        }
        this.pendingChunks.clear();
        this.pendingBlockChanges.clear();
    }

}
