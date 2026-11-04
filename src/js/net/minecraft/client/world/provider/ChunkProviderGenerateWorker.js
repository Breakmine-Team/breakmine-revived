import ChunkProvider from "./ChunkProvider.js";
import Chunk from "../Chunk.js";
import Random from "../../../util/Random.js";
import Long from "../../../../../../../libraries/long.js";

export default class ChunkProviderGenerateWorker extends ChunkProvider {

    constructor(world, seed, worldType = "normal") {
        super(world);

        this.seed = seed;
        this.seedData = { low: seed.low, high: seed.high };
        this.worldType = worldType;
        this.pendingChunks = new Map();
        this.pendingBatchProgress = new Map();
        this._nextBatchId = 0;

        const workerUrl = new URL("../worker/worldgen.worker.js", import.meta.url);
        this.worker = new Worker(workerUrl, { type: "module" });

        this.worker.onmessage = (e) => this._onWorkerMessage(e.data);
        this.worker.onerror = (e) => {
            console.error("WorldGen worker error:", e.message, e);
        };
    }

    _onWorkerMessage(data) {
        if (data.type === "batchProgress") {
            const callback = this.pendingBatchProgress.get(data.batchId);
            if (callback) callback(data.done, data.total);
            return;
        }

        if (data.type === "chunkGenerated" || data.type === "batchGenerated") {
            const results = data.results;
            for (const result of results) {
                const key = result.x + (result.z << 16);
                const pending = this.pendingChunks.get(key);
                if (pending) {
                    this.pendingChunks.delete(key);
                    try {
                        const chunk = this._deserializeChunk(result);
                        chunk.loaded = true;
                        this.chunks.set(key, chunk);
                        this.world.group.add(chunk.group);

                        this.world.updateChunkLight(chunk);
                    } catch (err) {
                        console.error("Failed to deserialize chunk", result.x, result.z, err);
                    }
                }
            }
        }
    }

    _deserializeChunk(result) {
        const chunk = new Chunk(this.world, result.x, result.z);

        for (let y = 0; y < 16; y++) {
            if ((result.sectionMask & (1 << y)) === 0) continue;

            const sectionData = result.sections[y];
            if (!sectionData) continue;

            const section = chunk.getSection(y);
            section.empty = false;

            for (let i = 0; i < 4096; i++) {
                const typeId = sectionData.blocks[i];
                if (typeId !== 0) {
                    section.blocks[i] = typeId;
                    section.blocksData[i] = sectionData.blocksData[i];
                }
            }

            for (let i = 0; i < 4096; i++) {
                const byteIndex = i >> 1;
                const isHigh = (i & 1) === 0;
                const bl = isHigh
                    ? (sectionData.blockLight[byteIndex] >> 4) & 0xF
                    : sectionData.blockLight[byteIndex] & 0xF;
                const sl = isHigh
                    ? (sectionData.skyLight[byteIndex] >> 4) & 0xF
                    : sectionData.skyLight[byteIndex] & 0xF;
                if (bl !== 0) section.blockLight[i] = bl;
                section.skyLight[i] = sl;
            }
        }

        for (let i = 0; i < 256; i++) {
            chunk.heightMap[i] = result.heightMap[i];
        }

        chunk.setModifiedAllSections();
        return chunk;
    }

    getChunkAt(chunkX, chunkZ) {
        const index = chunkX + (chunkZ << 16);
        const existing = this.chunks.get(index);
        if (existing) return existing;

        if (this.pendingChunks.has(index)) return null;

        if (!this.worker) return null;

        this.pendingChunks.set(index, { resolve: null });

        this.worker.postMessage({
            type: "generate",
            chunkX,
            chunkZ,
            seed: this.seedData,
            worldType: this.worldType,
        });

        return null;
    }

    requestChunksInRadius(centerX, centerZ, radius) {
        if (!this.worker) return;

        const needed = [];
        for (let x = -radius + 1; x < radius; x++) {
            for (let z = -radius + 1; z < radius; z++) {
                const cx = centerX + x;
                const cz = centerZ + z;
                const index = cx + (cz << 16);
                if (!this.chunks.has(index) && !this.pendingChunks.has(index)) {
                    needed.push([cx, cz, x * x + z * z]);
                }
            }
        }

        if (needed.length === 0) return;

        needed.sort((a, b) => a[2] - b[2]);

        const BATCH = 32;
        const batch = needed.slice(0, BATCH);

        for (const [cx, cz] of batch) {
            const key = cx + (cz << 16);
            this.pendingChunks.set(key, { resolve: null });
        }

        this.worker.postMessage({
            type: "generateBatch",
            coords: batch.map(([cx, cz]) => [cx, cz]),
            seed: this.seedData,
            worldType: this.worldType,
        });
    }

    async getChunkAtAsync(chunkX, chunkZ) {
        const index = chunkX + (chunkZ << 16);
        const existing = this.chunks.get(index);
        if (existing) return existing;

        const result = await new Promise((resolve) => {
            this.pendingChunks.set(index, { resolve });

            this.worker.postMessage({
                type: "generate",
                chunkX,
                chunkZ,
                seed: this.seedData,
                worldType: this.worldType,
            });
        });

        const chunk = this._deserializeChunk(result);
        chunk.loaded = true;
        this.chunks.set(index, chunk);
        this.world.group.add(chunk.group);

        this.world.updateChunkLight(chunk);

        return chunk;
    }

    async loadChunksBatchAsync(chunkCoords, onProgress) {
        const unloadedCoords = [];
        for (const [x, z] of chunkCoords) {
            const index = x + (z << 16);
            if (!this.chunks.has(index) && !this.pendingChunks.has(index)) {
                unloadedCoords.push([x, z]);
            }
        }

        if (unloadedCoords.length === 0) {
            return chunkCoords.map(([x, z]) => this.chunks.get(x + (z << 16))).filter(Boolean);
        }

        const batchId = this._nextBatchId++;
        if (onProgress) this.pendingBatchProgress.set(batchId, onProgress);

        const batchPromise = new Promise((resolve) => {
            const handler = (e) => {
                if (e.data.type === "batchGenerated" && e.data.batchId === batchId) {
                    this.worker.removeEventListener("message", handler);
                    resolve();
                }
            };
            this.worker.addEventListener("message", handler);

            for (const [x, z] of unloadedCoords) {
                const key = x + (z << 16);
                if (!this.pendingChunks.has(key)) {
                    this.pendingChunks.set(key, { resolve: null });
                }
            }

            this.worker.postMessage({
                type: "generateBatch",
                coords: unloadedCoords,
                seed: this.seedData,
                worldType: this.worldType,
                batchId,
            });
        });

        await batchPromise;
        this.pendingBatchProgress.delete(batchId);

        return chunkCoords.map(([x, z]) => this.chunks.get(x + (z << 16))).filter(Boolean);
    }

    populateChunk(chunk) {
    }

    async findSpawnAsync() {
        const spawn = this.world.spawn;
        if (spawn.y <= 0) spawn.y = 64;

        const random = new Random(this.seed);
        let attempts = 0;
        while (attempts < 1000) {
            const chunkX = spawn.x >> 4;
            const chunkZ = spawn.z >> 4;

            await this.getChunkAtAsync(chunkX, chunkZ);

            const block = this.world.getBlockAt(spawn.x, spawn.y + 1, spawn.z);
            if (block !== 0) break;

            spawn.x += random.nextInt(8) - random.nextInt(8);
            spawn.z += random.nextInt(8) - random.nextInt(8);
            attempts++;
        }
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.pendingChunks.clear();
    }

    getGenerator() {
        return { seed: this.seed, getSeed: () => this.seed, getSeaLevel: () => 64 };
    }
}
