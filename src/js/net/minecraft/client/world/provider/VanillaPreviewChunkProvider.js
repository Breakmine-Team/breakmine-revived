import ChunkProviderClient from './ChunkProviderClient.js';
import VanillaRenderChunk from '../VanillaRenderChunk.js';
import { StreamingMetrics, StreamingLRU, STREAM_MEMORY_PRESETS, nativeChunkBytes, streamingDemand, customMemoryBudget } from './VanillaStreaming.js';
import VanillaDistantTerrain from '../../render/VanillaDistantTerrain.js';

const DECORATION_REGION_BATCH_SIZE = 9;

export default class VanillaPreviewChunkProvider extends ChunkProviderClient {
    constructor(world, source, offer, stateMap, { onProgress = () => {} } = {}) {
        super(world);
        this.source = source;
        this.seed = source.seed;
        this.closed = false;
        this.error = null;
        this.desired = new Map();
        this.decorationDesired = new Map();
        this.provisional = new Set();
        this.terrainPreloaded = new Set();
        this.firstDecoration = new Promise((resolve, reject) => {
            this.resolveFirstDecoration = resolve;
            this.rejectFirstDecoration = reject;
        });
        this.firstDecoration.catch(() => {});
        this.onProgress = onProgress;
        this.streamingMetrics = new StreamingMetrics();
        source.streamingMetrics = this.streamingMetrics;
        this.frameBudgetEnabled = !!world.minecraft?.settings?.vanillithFrameBudget;
        this.publications = new Map();
        const settings = world.minecraft?.settings ?? {};
        this.warmCacheEnabled = !!settings.vanillithWarmCache || !!settings.vanillithPriorityStreaming;
        this.memoryBudget = STREAM_MEMORY_PRESETS[settings.vanillithMemoryPreset] ?? STREAM_MEMORY_PRESETS.balanced;
        source.configureStreamingCache?.(this.warmCacheEnabled, settings.vanillithMemoryPreset);
        this.warmRender = new StreamingLRU(this.memoryBudget.renderBytes, chunk => this.disposeRenderChunk(chunk));
        this.backgroundCompleted = new Set();
        this.lightEngineReady = this.enableVanillaMode(offer, stateMap);
        this.distantTerrain = new VanillaDistantTerrain(this);
        source.terrainParallelism = 4;
        if (settings.vanillithMemoryCustom) this.setMemoryPreset(settings.vanillithMemoryPreset);
    }

    enqueuePublication(payload, warmChunk = null) {
        if (!this.frameBudgetEnabled) {
            return this.lightEngineReady
                ? Promise.resolve(this.lightEngineReady).then(() => this.loadVanillaChunk(payload))
                : Promise.resolve(this.loadVanillaChunk(payload));
        }
        const key = `${payload.chunkX},${payload.chunkZ}`;
        if (this.publications.has(key)) return this.publications.get(key).promise;
        const job = { payload, warmChunk, queuedAt: performance.now(), ready: !this.lightEngineReady };
        job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
        this.publications.set(key, job);
        if (this.lightEngineReady) {
            Promise.resolve(this.lightEngineReady).then(() => {
                job.ready = true;
            }, error => {
                if (this.publications.get(key) === job) this.publications.delete(key);
                job.reject(error);
            });
        }
        return job.promise;
    }

    *publicationSteps(payload, warmChunk = null) {
        const saved = this.world.vanillithDirtyChunks?.get(`${payload.chunkX},${payload.chunkZ}`);
        if (saved) payload = saved;
        if (warmChunk) {
            const start = performance.now();
            const restored = this.installVanillaChunk(warmChunk, true);
            this.streamingMetrics.count('warmRestores');
            this.streamingMetrics.record('warmRestoreMs', performance.now() - start);
            return restored;
        }
        const chunk = yield* VanillaRenderChunk.fromPayloadSteps(this.world, payload, this.nativeRenderStateMap);
        if (this.world.vanillaLightEngine) yield* this.world.vanillaLightEngine.initializeChunkSteps(chunk);
        else {
            yield* this.world.updateChunkSkyLightSteps(chunk);
            yield* this.world.resetChunkBlockLightSteps(chunk);
        }
        if (this.closed) return;
        const installed = this.installVanillaChunk(chunk, true);
        this.provisional.delete(`${chunk.x},${chunk.z}`);
        if (`${chunk.x},${chunk.z}` === this.decorationFocus) {
            this.resolveFirstDecoration?.(installed);
            this.resolveFirstDecoration = null;
        }
        return installed;
    }

    flushPublications(deadline) {
        if (!this.frameBudgetEnabled || this.closed || this.error) return;
        while (this.publications.size && performance.now() < deadline) {
            const [key, job] = this.publications.entries().next().value;
            if (!job.ready) break;
            if (!this.desired.has(key)) {
                job.steps?.return();
                if (job.warmChunk) this.disposeRenderChunk(job.warmChunk);
                this.publications.delete(key); job.resolve(); continue;
            }
            job.steps ??= this.publicationSteps(job.payload, job.warmChunk);
            const start = performance.now();
            try {
                const result = job.steps.next();
                this.streamingMetrics.record('publishSliceMs', performance.now() - start);
                if (result.done) {
                    this.publications.delete(key);
                    this.streamingMetrics.record('readyToPublishedMs', performance.now() - job.queuedAt);
                    this.streamingMetrics.count('publishedChunks');
                    job.resolve(result.value);
                }
            } catch (error) { this.publications.delete(key); if (job.warmChunk) this.disposeRenderChunk(job.warmChunk); job.reject(error); }
        }
    }

    streamingSnapshot() {
        return { active: this.chunks.size, desired: this.desired.size, decorationDesired: this.decorationDesired.size,
            backgroundCompleted: this.backgroundCompleted.size,
            publicationQueue: this.publications.size, generationInFlight: this.source.pending?.size ?? 0,
            terrainInFlight: this.source.terrainPending?.size ?? 0,
            meshQueue: this.world.minecraft?.worldRenderer?.chunkSectionUpdateQueue?.length ?? 0,
            lightQueue: this.world.lightUpdateQueue?.length ?? 0,
            warmRender: this.warmRender.snapshot(), nativeCache: this.source.nativeCache?.snapshot(), terrainCache: this.source.terrainCache?.snapshot(),
            lodCache: this.distantTerrain?.cache.snapshot(), lodQueue: this.distantTerrain?.jobs.size ?? 0 };
    }

    setMemoryPreset(preset) {
        const settings = this.world.minecraft.settings;
        this.memoryBudget = settings.vanillithMemoryCustom ? customMemoryBudget(settings.vanillithMemoryMiB)
            : STREAM_MEMORY_PRESETS[preset] ?? STREAM_MEMORY_PRESETS.balanced;
        this.warmRender.budget = this.memoryBudget.renderBytes;
        this.warmRender.trim();
        this.source.configureStreamingCache?.(this.warmCacheEnabled, settings.vanillithMemoryCustom ? this.memoryBudget : preset);
        this.distantTerrain?.setMemoryPreset(preset, this.memoryBudget.lodBytes);
    }

    retainRenderChunk(chunk) {
        const key = `${chunk.x},${chunk.z}`;
        const renderer = this.world.minecraft?.worldRenderer;
        if (renderer?.streamingSection?.section.chunk === chunk) {
            renderer.streamingSection.steps.return(); renderer.streamingSection = null;
        }
        const queue = renderer?.chunkSectionUpdateQueue;
        if (queue) for (let i = queue.length - 1; i >= 0; i--) if (queue[i].chunk === chunk) queue.splice(i, 1);
        this.chunks.delete(key); this.world.nativeChunks.chunks.delete(key);
        this.world.vanillaLightEngine?.removeChunk(chunk.x, chunk.z);
        this.world.group.remove(chunk.group);
        let bytes = nativeChunkBytes(chunk.native);
        for (const section of chunk.sections) {
            bytes += ['blocks', 'blocksData', 'skyLight', 'blockLight'].reduce((sum, field) => sum + section[field].length * 8, 0);
            section.group.traverse(object => {
                if (!object.geometry) return;
                bytes += object.geometry.index?.array?.byteLength ?? 0;
                for (const attribute of Object.values(object.geometry.attributes)) bytes += attribute.array.byteLength;
            });
        }
        this.warmRender.put(key, chunk, bytes);
        this.distantTerrain?.enqueue(chunk.native);
        this.world.setModified(chunk.x * 16 - 1, chunk.minY, chunk.z * 16 - 1, chunk.x * 16 + 16, chunk.maxY - 1, chunk.z * 16 + 16);
    }

    restoreWarmChunks() {
        if (!this.warmCacheEnabled) return;
        for (const key of this.desired.keys()) {
            if (this.chunks.has(key) || this.publications.has(key) || this.demandTiers?.get(key) === 4) continue;
            if (!this.warmRender.entries.has(key)) continue;
            const chunk = this.warmRender.take(key);
            if (!chunk) continue;
            if (this.frameBudgetEnabled) {
                this.enqueuePublication(chunk.native.serialize(), chunk).catch(error => { this.error = error; this.world.vanillaPreviewError = error.message; });
                continue;
            }
            const start = performance.now();
            this.installVanillaChunk(chunk, true);
            this.streamingMetrics.count('warmRestores');
            this.streamingMetrics.record('warmRestoreMs', performance.now() - start);
        }
    }

    loadProvisional(payload) {
        const chunk = super.loadVanillaChunk(payload);
        if (this.source.decorationDraft) this.provisional.add(`${chunk.x},${chunk.z}`);
        return chunk;
    }

    *getRenderableChunks() {
        yield* this.chunks;
        for (const [key, { value: chunk }] of this.warmRender.entries) {
            if (this.chunks.has(key)) continue;
            if (chunk.group.parent !== this.world.group) this.world.group.add(chunk.group);
            yield [key, chunk];
        }
    }

    loadVanillaChunk(payload) {
        const chunk = super.loadVanillaChunk(payload);
        this.provisional.delete(`${chunk.x},${chunk.z}`);
        if (this.source.decorationDraft) {
            for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
                this.terrainPreloaded.add(`${chunk.x + dx},${chunk.z + dz}`);
            }
        }
        if (`${chunk.x},${chunk.z}` === this.decorationFocus) {
            this.resolveFirstDecoration?.(chunk);
            this.resolveFirstDecoration = null;
        }
        return chunk;
    }

    isCollisionChunkReady(chunkX, chunkZ) {
        const chunk = this.chunks.get(this.chunkKey(chunkX, chunkZ));
        return chunk?.loaded === true;
    }

    unloadChunk(x, z) {
        super.unloadChunk(x, z);
        this.provisional.delete(`${x},${z}`);
    }

    requestBackgroundDemand(player) {
        const now = performance.now();
        if (this.lastBackgroundDemandAt !== undefined && now - this.lastBackgroundDemandAt < 500) return;
        this.lastBackgroundDemandAt = now;
        const settings = this.world.minecraft.settings;
        const radius = Math.max(1, Math.min(8, Math.floor(settings.vanillithGenerationRadius ?? 3)));
        const background = this.warmCacheEnabled ? Math.max(radius, Math.min(48, Math.floor(settings.vanillithBackgroundRadius ?? 16))) : radius;
        const x = Math.floor(player.x / 16), z = Math.floor(player.z / 16);
        const demand = streamingDemand({ x, z, radius, idleRadius: background - radius });
        this.backgroundCenter = [x, z];
        this.requestRadius(x, z, radius, { demand, backgroundPrefetch: true }).catch(error => {
            this.error = error; this.world.vanillaPreviewError = error.message;
        });
    }

    requestStreamingDemand(player) {
        const now = performance.now();
        if (this.lastDemandAt !== undefined && now - this.lastDemandAt < 200) return;
        const elapsed = Math.max(.05, (now - (this.lastDemandAt ?? now - 50)) / 1000);
        const velocityX = this.lastDemandPosition ? (player.x - this.lastDemandPosition.x) / elapsed : (player.motionX ?? 0) * 20;
        const velocityZ = this.lastDemandPosition ? (player.z - this.lastDemandPosition.z) / elapsed : (player.motionZ ?? 0) * 20;
        const speed = Math.hypot(velocityX, velocityZ);
        if (speed > .2) this.stationarySince = now;
        else this.stationarySince ??= now;
        this.lastDemandAt = now; this.lastDemandPosition = { x: player.x, z: player.z };
        const x = Math.floor(player.x / 16), z = Math.floor(player.z / 16);
        const settings = this.world.minecraft.settings;
        const radius = Math.max(1, Math.min(6, Math.floor(settings.vanillithGenerationRadius ?? 3)));
        const backgroundRadius = this.warmCacheEnabled
            ? Math.max(radius, Math.min(48, Math.floor(settings.vanillithBackgroundRadius ?? 16))) : radius;
        const demand = streamingDemand({ x, z, velocityX, velocityZ, yaw: player.rotationYaw, radius, backgroundRadius });
        // Readiness changes priority inside a tier; camera never gates near-field demand.
        for (const entry of demand) {
            if (this.source.store.chunks.has(entry.key)) entry.priority -= 30;
            else if (this.source.terrainCache?.entries.has(entry.key)) entry.priority -= 10;
            if (this.source.pending?.has(entry.key)) entry.priority -= 5;
        }
        demand.sort((a, b) => a.priority - b.priority);
        this.requestRadius(x, z, radius, { demand, backgroundPrefetch: true }).catch(error => { this.error = error; this.world.vanillaPreviewError = error.message; });
    }

    requestRadius(x, z, radius = 2, { demand, decorateAll = false, backgroundPrefetch = false } = {}) {
        if (this.closed || this.error) return Promise.resolve();
        if (![x, z].every(Number.isSafeInteger) || !Number.isInteger(radius) || radius < 0 || radius > 8) throw new Error('Invalid preview radius');
        const coordinates = [];
        for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) coordinates.push([x + dx, z + dz]);
        coordinates.sort((a, b) => (a[0] - x) ** 2 + (a[1] - z) ** 2 - (b[0] - x) ** 2 - (b[1] - z) ** 2);
        const nextDesired = demand ? new Map(demand.map(entry => [entry.key, entry.coordinate])) : new Map(coordinates.map(pair => [pair.join(','), pair]));
        if (this.warmCacheEnabled && !this.world.vanillaLightEngine && [...nextDesired.keys()].some(key => this.warmRender.entries.has(key))) {
            return this.lightEngineReady.then(() => this.requestRadius(x, z, radius, { demand, decorateAll, backgroundPrefetch }));
        }
        this.demandTiers = demand ? new Map(demand.map(entry => [entry.key, entry.tier])) : null;
        this.backgroundPrefetch = backgroundPrefetch;
        const nextDecorationDesired = this.source.decorationDraft
            ? demand || decorateAll ? new Map(nextDesired) : new Map(coordinates.filter(([cx, cz]) => Math.max(Math.abs(cx - x), Math.abs(cz - z)) <= 1)
                .map(pair => [pair.join(','), pair])) : new Map();
        this.desired = nextDesired;
        for (const key of this.backgroundCompleted) if (!this.desired.has(key)) this.backgroundCompleted.delete(key);
        this.decorationDesired = nextDecorationDesired;
        this.decorationFocus = `${x},${z}`;
        for (const key of this.terrainPreloaded) if (!this.desired.has(key)) this.terrainPreloaded.delete(key);
        for (const chunk of [...this.chunks.values()]) {
            if (Math.max(Math.abs(chunk.x - x), Math.abs(chunk.z - z)) > radius + 1 ||
                (backgroundPrefetch && this.demandTiers?.get(`${chunk.x},${chunk.z}`) === 4)) {
                if (this.warmCacheEnabled && !this.provisional.has(`${chunk.x},${chunk.z}`)) this.retainRenderChunk(chunk);
                else { this.unloadChunk(chunk.x, chunk.z); this.source.store.chunks.delete(`${chunk.x},${chunk.z}`); }
            }
        }
        this.restoreWarmChunks();
        const hasTerrainWork = !this.source.decorationDraft && [...this.desired.keys()].some(key => this.needsTerrain(key));
        if (!this.terrainPumping && hasTerrainWork) this.terrainPumping = this.pumpTerrain().finally(() => { this.terrainPumping = null; });
        const hasDecorationWork = this.source.decorationDraft && [...this.decorationDesired.keys()]
            .some(key => this.needsDecoration(key));
        if (hasDecorationWork && !this.decorationPumping) {
            this.decorationPumping = this.pumpDecoration().finally(() => { this.decorationPumping = null; });
        }
        return Promise.all([this.terrainPumping, this.decorationPumping, ...[...this.publications.values()].map(job => job.promise)]);
    }

    needsTerrain(key) {
        return !this.chunks.has(key) && !this.publications.has(key) &&
            !(this.demandTiers?.get(key) === 4 && this.backgroundCompleted.has(key));
    }

    needsDecoration(key) {
        if (this.publications?.has(key)) return false;
        if (this.demandTiers?.get(key) === 4 && (this.source.store.chunks.has(key) || this.backgroundCompleted.has(key))) return false;
        return !this.chunks.has(key) || this.provisional.has(key);
    }

    async pumpTerrain() {
        while (!this.closed) {
            const pending = [...this.desired.entries()].filter(([key]) => this.needsTerrain(key));
            let missing = pending.slice(0,4);
            if (this.backgroundPrefetch && pending.length && this.demandTiers.get(pending[0][0]) === 4) {
                const [x,z] = this.backgroundCenter ?? [0,0];
                const direction = ([, [cx,cz]]) => Math.abs(cx-x) >= Math.abs(cz-z) ? (cx >= x ? 0 : 2) : (cz >= z ? 1 : 3);
                missing = [0,1,2,3].map(side => pending.find(entry => direction(entry) === side)).filter(Boolean);
                for (const entry of pending) if (missing.length < 4 && !missing.includes(entry)) missing.push(entry);
            }
            if (!missing.length) return;
            try {
                const handled = new Set(), publications = [];
                const publishReady = native => {
                    const key = `${native.chunkX},${native.chunkZ}`;
                    if (handled.has(key)) return;
                    handled.add(key);
                    if (!this.desired.has(key)) return;
                    if (this.demandTiers?.get(key) === 4) {
                        this.backgroundCompleted.add(key); this.streamingMetrics.count('backgroundChunks');
                        this.distantTerrain?.enqueue(native);
                        return;
                    }
                    if (!this.chunks.has(key)) publications.push(this.enqueuePublication(native.serialize()));
                };
                const natives = await this.source.getTerrainChunksAtAsync(missing.map(([, coordinate]) => coordinate), {
                    onChunk: publishReady
                });
                if (this.closed) return;
                for (const native of natives) publishReady(native);
                await Promise.all(publications);
                const ready = [...this.desired.keys()].filter(key => this.chunks.has(key) || this.backgroundCompleted.has(key)).length;
                this.onProgress(ready / this.desired.size);
            } catch (error) {
                if (!this.closed) {
                    this.error = error;
                    this.world.vanillaPreviewError = error.message;
                    console.error('[Vanillith] Terrain generation failed:', error);
                    this.rejectFirstDecoration?.(error);
                    this.rejectFirstDecoration = null;
                }
                return;
            }
        }
    }

    async pumpDecoration() {
        while (!this.closed) {
            if (this.closed || this.error) return;
            const pending = [...this.decorationDesired.entries()]
                .filter(([key]) => this.needsDecoration(key));
            const focusIndex = pending.findIndex(([key]) => key === this.decorationFocus);
            if (focusIndex > 0) pending.unshift(pending.splice(focusIndex, 1)[0]);
            let missing = pending.slice(0, DECORATION_REGION_BATCH_SIZE);
            if (this.demandTiers && focusIndex < 0 && pending.length) {
                const critical = pending.filter(([key]) => this.demandTiers.get(key) === 0);
                if (critical.length) {
                    missing = critical.slice(0, DECORATION_REGION_BATCH_SIZE);
                } else {
                    let anchor = pending[0];
                    if (this.backgroundPrefetch && this.demandTiers.get(anchor[0]) === 4) {
                        const [x,z] = this.backgroundCenter ?? [0,0];
                        const direction = ([, [cx,cz]]) => Math.abs(cx-x) >= Math.abs(cz-z) ? (cx >= x ? 0 : 2) : (cz >= z ? 1 : 3);
                        for (let offset = 0; offset < 4; offset++) {
                            const selected = pending.find(entry => direction(entry) === ((this.backgroundDirection ?? 0) + offset) % 4);
                            if (selected) { anchor = selected; this.backgroundDirection = (direction(selected) + 1) % 4; break; }
                        }
                    }
                    const [anchorX, anchorZ] = anchor[1];
                    missing = pending.filter(([, [cx, cz]]) => Math.abs(cx - anchorX) <= 1 && Math.abs(cz - anchorZ) <= 1).slice(0, DECORATION_REGION_BATCH_SIZE);
                }
                if (!this.backgroundPrefetch && this.demandTiers.get(pending[0][0]) === 4 && (this.lastFrameWorkMs ?? 0) > 16) return;
            }
            if (!missing.length) return;
            try {
                const prepared = await this.source.ensureDecorationTerrain?.(missing.map(([, coordinate]) => coordinate), {
                    shouldContinue: () => {
                        if (this.closed || this.error) return false;
                        if (!this.demandTiers) return true;
                        const next = [...this.decorationDesired.keys()].find(key => this.needsDecoration(key));
                        if (this.backgroundPrefetch && next && this.demandTiers.get(next) === 4 &&
                            missing.every(([key]) => this.decorationDesired.has(key) && this.demandTiers.get(key) === 4)) return true;
                        return next === undefined || missing.some(([key]) => key === next);
                    }
                });
                if (this.closed || this.error) return;
                if (prepared === false) { this.streamingMetrics.count('prewarmReprioritized'); continue; }
                // Direction may have changed during prewarm. Keep terrain, then
                // choose the new highest-priority request before decorating.
                if (this.demandTiers && missing.every(([key]) => !this.decorationDesired.has(key))) continue;
                const streamedPublications = new Map();
                const natives = await this.source.getChunksAtAsync(missing.map(([, coordinate]) => coordinate), {
                    onChunk: payload => {
                        const key = `${payload.chunkX},${payload.chunkZ}`;
                        if (this.closed || !this.desired.has(key) || streamedPublications.has(key)) return;
                        streamedPublications.set(key, this.enqueuePublication(payload));
                    }
                });
                if (this.closed) return;
                const publications = [];
                for (let index = 0; index < natives.length; index++) {
                    const [key] = missing[index];
                    if (!this.desired.has(key)) {
                        if (!this.warmCacheEnabled) this.source.store.chunks.delete(key);
                        continue;
                    }
                    if (this.demandTiers?.get(key) === 4) {
                        this.backgroundCompleted.add(key); this.streamingMetrics.count('backgroundChunks');
                        this.distantTerrain?.enqueue(natives[index]);
                        continue;
                    }
                    const published = streamedPublications.get(key);
                    if (published) publications.push(published);
                    else publications.push(this.enqueuePublication(natives[index].serialize()));
                }
                await Promise.all(publications);
                const ready = [...this.decorationDesired.keys()]
                    .filter(key => (this.chunks.has(key) && !this.provisional.has(key)) || this.backgroundCompleted?.has(key)).length;
                this.onProgress(ready / this.decorationDesired.size);
            } catch (error) {
                if (!this.closed) {
                    this.error = error;
                    this.world.vanillaPreviewError = error.message;
                    console.error('[Vanillith] Terrain generation failed:', error);
                    this.rejectFirstDecoration?.(error);
                    this.rejectFirstDecoration = null;
                }
                return;
            }
        }
    }

    async terminate() {
        this.closed = true;
        this.desired.clear();
        this.decorationDesired.clear();
        for (const job of this.publications.values()) { job.steps?.return(); if (job.warmChunk) this.disposeRenderChunk(job.warmChunk); job.resolve(); }
        this.publications.clear();
        this.warmRender.clear();
        this.distantTerrain?.clear();
        this.backgroundCompleted.clear();
        const renderer = this.world.minecraft?.worldRenderer;
        if (renderer?.streamingSection?.section.world === this.world) {
            renderer.streamingSection.steps.return(); renderer.streamingSection = null;
        }
        this.world.streamingLight?.return(); this.world.streamingLight = null;
        await this.source.terminate();
        await Promise.all([this.terrainPumping, this.decorationPumping]);
        this.clearChunks();
        this.provisional.clear();
        this.terrainPreloaded.clear();
        this.rejectFirstDecoration?.(new Error('Vanillith preview closed before decoration completed'));
        this.rejectFirstDecoration = null;
    }
}
