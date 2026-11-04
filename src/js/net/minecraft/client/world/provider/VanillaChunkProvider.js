import { VanillaChunkStore, readVanillaChunk } from '../../../../../../../packages/vanilla-worldgen/chunk-store.mjs';
import { parseSeed } from '../../../../../../../packages/vanilla-worldgen/runtime.mjs';
import { VANILLA_SOURCE_SHA } from '../../../../../../../packages/vanilla-worldgen/chunk-session.mjs';
import { generateVanillaChunks, generateVanillaChunksStreaming, loadVanillaChunk, preloadVanillaTerrainChunks, prepareVanillaChunkService, releaseVanillaChunks, saveVanillaChunks } from '../../integrated/IntegratedServer.js';
import { StreamingLRU, STREAM_MEMORY_PRESETS, nativeChunkBytes } from './VanillaStreaming.js';

const REUSABLE_TERRAIN_STAGES = ['noise', 'aquifer', 'biomes', 'material_rules'];
const REUSABLE_TERRAIN_PENDING = ['carvers', 'decoration', 'structures', 'lighting'];

// Modern chunks stay separate until the renderer/save/packet adapters support them.
export default class VanillaChunkProvider {
    constructor(seed, settings = 'overworld', { worldKey, decorationDraft = false, dimension, warmCache = false, memoryPreset = 'balanced' } = {}) {
        this.decorationDraft = decorationDraft;
        if (worldKey !== undefined && (typeof worldKey !== 'string' || !/^[a-z0-9_]{1,80}$/.test(worldKey))) throw new RangeError('Invalid modern world key');
        this.seed = parseSeed(seed).toString();
        this.settings = settings;
        const expectedDimension = settings === 'nether' ? 'minecraft:the_nether'
            : settings === 'end' ? 'minecraft:the_end' : 'minecraft:overworld';
        if (dimension !== undefined && dimension !== expectedDimension) throw new Error('Generator settings do not match terrain dimension');
        this.dimension = expectedDimension;
        this.worldKey = worldKey;
        this.store = new VanillaChunkStore();
        this.pending = new Map();
        this.terrainPending = new Map();
        this.nextTerrainRequestId = 1;
        this.terrainWorker = null;
        this.preloadedDecorationTerrain = new Set();
        this.closed = false;
        this.configureStreamingCache(warmCache, memoryPreset);
    }

    configureStreamingCache(enabled, preset = 'balanced') {
        this.warmCacheEnabled = !!enabled;
        const budgets = typeof preset === 'object' ? preset : STREAM_MEMORY_PRESETS[preset] ?? STREAM_MEMORY_PRESETS.balanced;
        this.nativeCache ??= new StreamingLRU(budgets.nativeBytes, (_, key) => this.store.chunks.delete(key));
        this.terrainCache ??= new StreamingLRU(budgets.terrainBytes);
        this.nativeCache.budget = budgets.nativeBytes;
        this.terrainCache.budget = budgets.terrainBytes;
        this.nativeCache.trim(); this.terrainCache.trim();
        this.terrainChunkPending ??= new Map();
    }

    rememberChunks(chunks) {
        if (this.warmCacheEnabled) for (const chunk of chunks) {
            const key = `${chunk.chunkX},${chunk.chunkZ}`;
            // Refreshing an existing entry must not remove the store's new value.
            this.nativeCache.put(key, chunk, nativeChunkBytes(chunk));
            this.store.chunks.set(key, chunk);
        }
        return chunks;
    }

    recordWorkerResult(result, start) {
        const stats = result.streamingStats, metrics = this.streamingMetrics;
        if (!metrics) return;
        metrics.record('workerRoundTripMs', performance.now() - start);
        if (!stats) return;
        metrics.record('workerGenerationMs', stats.totalMs);
        metrics.record('workerQueueAndMessagingMs', Math.max(0, performance.now() - start - stats.totalMs));
        metrics.record('terrainGenerationMs', stats.terrainMs);
        metrics.record('sourceFeatureMs', stats.sourceMs);
        metrics.count('terrainGenerated', stats.terrainMisses);
        metrics.count('dependencyCacheHits', stats.terrainHits);
        metrics.count('sourceExecutions', stats.sourceExecutions);
        metrics.count('decorationResultHits', Number(stats.decorationResultHit));
    }

    async getChunkAtAsync(x, z) {
        if (this.closed) throw new Error('Vanilla chunk provider is closed');
        const cached = this.store.getChunk(x, z);
        if (cached) { if (this.warmCacheEnabled) this.nativeCache.get(`${x},${z}`); return cached; }
        const key = `${x},${z}`;
        if (this.pending.has(key)) return this.pending.get(key);
        const request = this.requestChunk(x, z)
            .then(result => {
                if (this.closed) throw new Error('Vanilla chunk provider is closed');
                if (!!result.decorationDraft !== !!this.decorationDraft || result.format !== 'breakmine:vanilla-generation-v1' || result.seed !== this.seed || result.settings !== this.settings ||
                    result.chunks.length !== 1 || result.chunks[0].chunkX !== x || result.chunks[0].chunkZ !== z) throw new Error('Vanilla chunk response context mismatch');
                this.generationStatus = { stages: result.stages, pendingStages: result.pendingStages, playable: result.playable };
                this.biomeNames = result.biomeNames;
                return this.rememberChunks(this.store.setBatch(result.chunks))[0];
            }).finally(() => this.pending.delete(key));
        this.pending.set(key, request);
        return request;
    }

    ensureTerrainWorker(index = 0) {
        this.terrainWorkers ??= [];
        if (index === 0 && this.terrainWorker) return this.terrainWorker;
        if (this.terrainWorkers[index]) return this.terrainWorkers[index];
        const worker = new Worker(new URL('../generator/VanillaPreviewTerrainWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
            const pending = this.terrainPending.get(data.id);
            if (!pending) return;
            this.terrainPending.delete(data.id);
            if (data.error) pending.reject(new Error(data.error));
            else pending.resolve(data.result);
        };
        worker.onerror = event => {
            for (const [id, pending] of this.terrainPending) if (pending.worker === worker) {
                pending.reject(new Error(event.message || 'Vanillith terrain worker failed')); this.terrainPending.delete(id);
            }
            worker.terminate();
            if (this.terrainWorker === worker) this.terrainWorker = null;
            this.terrainWorkers[index] = null;
        };
        this.terrainWorkers[index] = worker;
        if (index === 0) this.terrainWorker = worker;
        return worker;
    }

    async getTerrainChunksAtAsync(coords, { onChunk } = {}) {
        if (!this.warmCacheEnabled) return this.requestTerrainChunksAtAsync(coords, null, onChunk);
        if (this.closed) throw new Error('Vanilla chunk provider is closed');
        if (!Array.isArray(coords) || coords.length < 1 || coords.length > 4 || !coords.every(pair =>
            Array.isArray(pair) && pair.length === 2 && pair.every(Number.isSafeInteger))) throw new RangeError('Expected 1..4 terrain coordinates');
        const ready = new Map(), missing = [];
        for (const pair of coords) {
            const key = pair.join(','), cached = this.terrainCache.get(key);
            if (cached) ready.set(key, Promise.resolve(cached));
            else if (this.terrainChunkPending.has(key)) ready.set(key, this.terrainChunkPending.get(key));
            else if (!missing.some(p => p.join(',') === key)) missing.push(pair);
        }
        if (missing.length) {
            const request = this.requestTerrainChunksAtAsync(missing, null, onChunk).then(chunks => {
                for (const chunk of chunks) this.terrainCache.put(`${chunk.chunkX},${chunk.chunkZ}`, chunk, nativeChunkBytes(chunk));
                return chunks;
            });
            missing.forEach((pair, index) => {
                const key = pair.join(','), pending = request.then(chunks => chunks[index]);
                this.terrainChunkPending.set(key, pending); ready.set(key, pending);
                pending.finally(() => { if (this.terrainChunkPending.get(key) === pending) this.terrainChunkPending.delete(key); }).catch(() => {});
            });
        }
        if (onChunk) {
            for (const pair of coords) {
                const key = pair.join(',');
                if (missing.some(candidate => candidate[0] === pair[0] && candidate[1] === pair[1])) continue;
                ready.get(key)?.then(onChunk).catch(() => {});
            }
        }
        const chunks = await Promise.all(coords.map(pair => ready.get(pair.join(','))));
        if (this.closed) throw new Error('Vanilla chunk provider is closed');
        return chunks;
    }

    async requestTerrainChunksAtAsync(coords, workerIndex = null, onChunk = null) {
        if (this.closed) throw new Error('Vanilla chunk provider is closed');
        if (!Array.isArray(coords) || coords.length < 1 || coords.length > 4 || !coords.every(pair =>
            Array.isArray(pair) && pair.length === 2 && pair.every(Number.isSafeInteger))) throw new RangeError('Expected 1..4 terrain coordinates');
        if (workerIndex === null && this.terrainParallelism > 1 && coords.length > 1) {
            const chunks = await Promise.all(coords.map((pair, index) =>
                this.requestTerrainChunksAtAsync([pair], index % this.terrainParallelism).then(result => {
                    onChunk?.(result[0]);
                    return result;
                })));
            return chunks.flat();
        }
        const worker = this.ensureTerrainWorker(workerIndex ?? 0);
        const startedAt = performance.now();
        const result = await new Promise((resolve, reject) => {
            const id = this.nextTerrainRequestId++;
            this.terrainPending.set(id, { resolve, reject, worker });
            try {
                worker.postMessage({ id, request: { seed: this.seed, settings: this.settings, coords } });
            } catch (error) {
                this.terrainPending.delete(id);
                reject(error);
            }
        });
        if (this.closed) throw new Error('Vanilla chunk provider is closed');
        this.recordWorkerResult(result, startedAt);
        if (result.decorationDraft || result.format !== 'breakmine:vanilla-generation-v1' ||
            result.seed !== this.seed || result.settings !== this.settings || result.chunks.length !== coords.length ||
            result.chunks.some((chunk, index) => chunk.chunkX !== coords[index][0] || chunk.chunkZ !== coords[index][1])) {
            throw new Error('Vanilla terrain response context mismatch');
        }
        const stages = result.stages;
        const pendingStages = result.pendingStages;
        if (result.playable !== false || !Array.isArray(stages) ||
            stages.length !== REUSABLE_TERRAIN_STAGES.length || stages.some((stage, index) => stage !== REUSABLE_TERRAIN_STAGES[index]) ||
            !Array.isArray(pendingStages) || pendingStages.length !== REUSABLE_TERRAIN_PENDING.length ||
            pendingStages.some((stage, index) => stage !== REUSABLE_TERRAIN_PENDING[index])) {
            throw new Error('Vanilla terrain response has an incompatible generation status');
        }
        const expectedBounds = this.settings === 'nether' || this.settings === 'end'
            ? { minY: 0, height: 128 } : { minY: -64, height: 384 };
        const chunks = result.chunks.map(payload => {
            if (payload.minY !== expectedBounds.minY || payload.height !== expectedBounds.height) {
                throw new Error('Vanilla terrain response has incompatible dimension bounds');
            }
            const chunk = readVanillaChunk(payload);
            chunk.terrainReuseContext = Object.freeze({ seed: this.seed, dimension: this.dimension, settings: this.settings,
                generator: VANILLA_SOURCE_SHA, minY: payload.minY, height: payload.height, stages: Object.freeze([...stages]),
                pendingStages: Object.freeze([...pendingStages]), chunkX: payload.chunkX, chunkZ: payload.chunkZ,
                playable: false, decorationDraft: false });
            return chunk;
        });
        for (const chunk of chunks) onChunk?.(chunk);
        return chunks;
    }

    async getTerrainChunkAtAsync(x, z) { return (await this.getTerrainChunksAtAsync([[x, z]]))[0]; }

    async preloadDecorationTerrain(natives) {
        if (!this.decorationDraft || !natives.length) return;
        for (const chunk of natives) {
            const context = chunk.terrainReuseContext;
            if (!context || context.seed !== this.seed || context.dimension !== this.dimension || context.settings !== this.settings ||
                context.generator !== VANILLA_SOURCE_SHA ||
                context.chunkX !== chunk.chunkX || context.chunkZ !== chunk.chunkZ ||
                context.minY !== chunk.minY || context.height !== chunk.height || context.playable !== false ||
                context.decorationDraft !== false || !Array.isArray(context.stages) ||
                context.stages.length !== REUSABLE_TERRAIN_STAGES.length ||
                context.stages.some((stage, index) => stage !== REUSABLE_TERRAIN_STAGES[index]) ||
                !Array.isArray(context.pendingStages) || context.pendingStages.length !== REUSABLE_TERRAIN_PENDING.length ||
                context.pendingStages.some((stage, index) => stage !== REUSABLE_TERRAIN_PENDING[index])) {
                throw new Error('Refusing to reuse terrain chunk with an incompatible context or generation status');
            }
        }
        const chunks = natives.map(chunk => structuredClone(chunk.serialize()));
        const result = await preloadVanillaTerrainChunks(this.seed, this.settings, chunks);
        if (!result || result.loaded !== chunks.length || !Array.isArray(result.terrainCacheKeys) || result.terrainCacheKeys.length > 49 ||
            !result.terrainCacheKeys.every(key => /^-?\d+,-?\d+$/.test(key))) throw new Error('Terrain preload cache acknowledgement is malformed');
        this.preloadedDecorationTerrain = new Set(result.terrainCacheKeys);
        return result.loaded;
    }

    async ensureDecorationTerrain(outputCoords, { shouldContinue = () => true } = {}) {
        if (!this.decorationDraft || !Array.isArray(outputCoords) || !outputCoords.length) return;
        const required = new Map();
        for (const [chunkX, chunkZ] of outputCoords) {
            if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkZ)) throw new RangeError('Invalid decoration output coordinate');
            for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
                const x = chunkX + dx, z = chunkZ + dz, key = `${x},${z}`;
                required.set(key, [x, z]);
            }
        }
        // Publish one complete compatible dependency set to the worker. Partial
        // preloads can evict older required entries before the region is ready.
        if (this.warmCacheEnabled && required.size <= 49) {
            const coordinates = [...required.values()], chunks = [];
            for (let offset = 0; offset < coordinates.length; offset += 4) {
                if (this.closed || !shouldContinue()) return false;
                chunks.push(...await this.getTerrainChunksAtAsync(coordinates.slice(offset, offset + 4)));
            }
            if (this.closed || !shouldContinue()) return false;
            await this.preloadDecorationTerrain(chunks);
            return true;
        }
        const missing = [...required.entries()].filter(([key]) => !this.preloadedDecorationTerrain.has(key)).map(([, coordinate]) => coordinate);
        for (let offset = 0; offset < missing.length; offset += 4) {
            if (this.closed || !shouldContinue()) return false;
            const natives = await this.getTerrainChunksAtAsync(missing.slice(offset, offset + 4));
            await this.preloadDecorationTerrain(natives);
        }
        return true;
    }

    async prepareDecorationService() {
        if (!this.decorationDraft) return;
        return await prepareVanillaChunkService();
    }

    async getChunksAtAsync(coordinates, { onChunk } = {}) {
        if (!this.decorationDraft) throw new Error('Batched chunk requests are only available for decoration previews');
        if (!Array.isArray(coordinates) || coordinates.length < 1 || coordinates.length > 9 || !coordinates.every(pair =>
            Array.isArray(pair) && pair.length === 2 && pair.every(Number.isSafeInteger))) throw new RangeError('Expected 1..9 valid chunk coordinates');
        if (this.closed) throw new Error('Vanilla chunk provider is closed');

        const keys = coordinates.map(([x, z]) => `${x},${z}`);
        const unique = new Map(coordinates.map(([x, z]) => [`${x},${z}`, { x, z, key: `${x},${z}` }]));
        let missing = [...unique.values()].filter(({ key }) => !this.store.chunks.has(key) && !this.pending.has(key));
        if (this.worldKey !== undefined && missing.length) {
            const persisted = await Promise.all(missing.map(({ x, z }) => loadVanillaChunk(this.worldKey, this.seed, this.settings, x, z)));
            const remaining = [];
            for (let index = 0; index < missing.length; index++) {
                if (persisted[index]) this.rememberChunks(this.store.setBatch([persisted[index]]));
                else remaining.push(missing[index]);
            }
            missing = remaining;
        }
        this.streamingMetrics?.count('completedCacheMisses', missing.length);
        if (missing.length) {
            const startedAt = performance.now();
            const requestCoords = missing.map(({ x, z }) => [x, z]);
            const streamed = new Map();
            const generate = typeof onChunk === 'function'
                ? generateVanillaChunksStreaming({ seed: this.seed, settings: this.settings, coords: requestCoords, mode: 'decoration_draft' }, payload => {
                    const key = `${payload.chunkX},${payload.chunkZ}`;
                    if (!missing.some(entry => entry.key === key) || streamed.has(key)) throw new Error(`Unexpected duplicate streamed decoration chunk ${key}`);
                    streamed.set(key, payload);
                    onChunk(payload);
                })
                : generateVanillaChunks({ seed: this.seed, settings: this.settings, coords: requestCoords, mode: 'decoration_draft' });
            const request = generate
                .then(async result => {
                    if (this.closed) throw new Error('Vanilla chunk provider is closed');
                    this.recordWorkerResult(result, startedAt);
                    if (typeof onChunk === 'function') {
                        if (streamed.size !== missing.length) throw new Error(`Decoration stream ended after ${streamed.size}/${missing.length} chunks`);
                        result = { ...result, chunks: missing.map(entry => streamed.get(entry.key)) };
                    }
                    if (!result.decorationDraft || result.format !== 'breakmine:vanilla-generation-v1' || result.seed !== this.seed || result.settings !== this.settings ||
                        !Array.isArray(result.terrainCacheKeys) || result.terrainCacheKeys.length > 49 ||
                        result.chunks.length !== missing.length || result.chunks.some((chunk, index) =>
                            chunk.chunkX !== missing[index].x || chunk.chunkZ !== missing[index].z)) throw new Error('Vanilla chunk response context mismatch');
                    this.preloadedDecorationTerrain = new Set(result.terrainCacheKeys);
                    this.generationStatus = { stages: result.stages, pendingStages: result.pendingStages, playable: result.playable };
                    this.biomeNames = result.biomeNames;
                    if (this.worldKey !== undefined) await saveVanillaChunks(this.worldKey, this.seed, this.settings, result.chunks);
                    return this.rememberChunks(this.store.setBatch(result.chunks));
                });
            const chunkRequests = missing.map((entry, index) => request.then(chunks => chunks[index]));
            for (let index = 0; index < missing.length; index++) {
                const { key } = missing[index];
                const chunkRequest = chunkRequests[index];
                this.pending.set(key, chunkRequest);
                chunkRequest.finally(() => {
                    if (this.pending.get(key) === chunkRequest) this.pending.delete(key);
                }).catch(() => {});
            }
        }

        const jobs = [...new Set(keys)].map(key => {
            if (this.store.chunks.has(key)) {
                if (this.warmCacheEnabled) this.nativeCache.get(key);
                return Promise.resolve(this.store.chunks.get(key));
            }
            return this.pending.get(key);
        });
        await Promise.all(jobs);
        if (this.closed) throw new Error('Vanilla chunk provider is closed');

        return keys.map(key => {
            const [x, z] = key.split(',').map(Number);
            return this.store.getChunk(x, z);
        });
    }

    async requestChunk(x, z) {
        if (this.worldKey !== undefined) {
            const chunk = await loadVanillaChunk(this.worldKey, this.seed, this.settings, x, z);
            if (this.closed) throw new Error('Vanilla chunk provider is closed');
            if (chunk) return { format: 'breakmine:vanilla-generation-v1', seed: this.seed, settings: this.settings,
                chunks: [chunk], biomeNames: chunk.biomeNames, stages: ['noise', 'aquifer', 'biomes', 'material_rules'],
                pendingStages: ['carvers', 'decoration', 'structures', 'lighting'], playable: false };
        }
        const result = await generateVanillaChunks({ seed: this.seed, settings: this.settings, coords: [[x, z]],
            ...(this.decorationDraft ? { mode: 'decoration_draft' } : {}) });
        if (this.closed) throw new Error('Vanilla chunk provider is closed');
        if (result.decorationDraft && !this.decorationDraft) throw new Error('Decoration drafts cannot be saved or published as world chunks');
        if (this.worldKey !== undefined) await saveVanillaChunks(this.worldKey, this.seed, this.settings, result.chunks);
        return result;
    }

    getBlockState(x, y, z) { return this.store.getBlockState(x, y, z); }

    async createRenderChunk(world, x, z, stateMap) {
        const native = await this.getChunkAtAsync(x, z);
        const { default: VanillaRenderChunk } = await import('../VanillaRenderChunk.js');
        if (this.closed) throw new Error('Vanilla chunk provider is closed');
        return VanillaRenderChunk.fromPayload(world, native.serialize(), stateMap);
    }

    async terminate() {
        this.closed = true;
        this.nativeCache.clear(); this.terrainCache.clear(); this.terrainChunkPending.clear();
        this.store.clear();
        this.terrainWorker?.terminate();
        for (const worker of this.terrainWorkers ?? []) if (worker !== this.terrainWorker) worker?.terminate();
        this.terrainWorkers = [];
        this.terrainWorker = null;
        for (const pending of this.terrainPending.values()) pending.reject(new Error('Vanilla chunk provider is closed'));
        this.terrainPending.clear();
        this.preloadedDecorationTerrain.clear();
        if (this.decorationDraft) await releaseVanillaChunks();
    }
}
