import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../../libraries/three.module.js';
import VanillaPreviewChunkProvider from '../../../src/js/net/minecraft/client/world/provider/VanillaPreviewChunkProvider.js';
import VanillaPreviewWorld from '../../../src/js/net/minecraft/client/world/VanillaPreviewWorld.js';
import VanillaChunkProvider from '../../../src/js/net/minecraft/client/world/provider/VanillaChunkProvider.js';
import World from '../../../src/js/net/minecraft/client/world/World.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import { VanillaChunk } from '../chunk.mjs';
import { VANILLA_SOURCE_SHA } from '../chunk-session.mjs';
import { VANILLA_WORLDGEN_PREVIEW_READY, assertWorldGeneratorReady } from '../../../src/js/net/minecraft/client/world/generator/VanillaWorldgenStatus.js';

new Block(1);
function setup(loader = async (x, z) => new VanillaChunk(x, z)) {
    const calls = [];
    const batches = [];
    const terrainCalls = [];
    const terrainBatches = [];
    const preloads = [];
    const source = { seed: '1', store: { chunks: new Map() }, closed: false,
        async getTerrainChunksAtAsync(coordinates) {
            terrainBatches.push(coordinates);
            return Promise.all(coordinates.map(([x, z]) => {
                terrainCalls.push([x, z]);
                return loader(x, z);
            }));
        },
        async preloadDecorationTerrain(chunks) { preloads.push(chunks.length); },
        async getChunkAtAsync(x, z) {
            calls.push([x, z]);
            const chunk = await loader(x, z);
            this.store.chunks.set(`${x},${z}`, chunk);
            return chunk;
        }, async getChunksAtAsync(coordinates) {
            batches.push(coordinates);
            return Promise.all(coordinates.map(([x, z]) => this.getChunkAtAsync(x, z)));
        }, terminate() { this.closed = true; this.store.chunks.clear(); } };
    const world = Object.create(World.prototype);
    Object.assign(world, { minY: 0, maxY: 256, height: 256, chunkProvider: null, group: new THREE.Group(), lightUpdateQueue: [],
        minecraft: { worldRenderer: { chunkSectionUpdateQueue: [] }, settings: {} } });
    world.updateChunkLight = () => {};
    const progress = [];
    const provider = new VanillaPreviewChunkProvider(world, source,
        { protocol: 1, source: VANILLA_SOURCE_SHA, token: 1, settings: 'overworld', minY: -64, height: 384 }, new Map([[0, 0], [1, 16]]),
        { onProgress: value => progress.push(value) });
    world.chunkProvider = provider;
    return { source, world, provider, calls, batches, terrainCalls, terrainBatches, preloads, progress };
}

test('stationary full-radius demand decorates 7x7 in bounded batches without repeated requests', async () => {
    const { provider, source, calls, batches } = setup();
    source.decorationDraft = true;
    await provider.requestRadius(0, 0, 3, { decorateAll: true });
    assert.equal(provider.chunks.size, 49);
    assert.equal(provider.decorationDesired.size, 49);
    assert.equal(new Set(calls.map(pair => pair.join(','))).size, 49);
    assert.equal(batches[0].length, 9);
    assert.ok(batches[0].some(([x, z]) => x === 0 && z === 0));
    assert.ok(batches.slice(1).some(batch => batch.length === 9));
    assert.ok(batches.every(batch => batch.length <= 9));
    await provider.requestRadius(0, 0, 3, { decorateAll: true });
    assert.equal(calls.length, 49);
    await provider.terminate();
});

test('background generation completes without movement and only near chunks become active', async () => {
    const { provider, source, world, calls } = setup();
    source.decorationDraft = true;
    provider.warmCacheEnabled = true;
    Object.assign(world.minecraft.settings, { vanillithGenerationRadius: 1, vanillithBackgroundRadius: 4 });
    provider.requestBackgroundDemand({ x: 8, z: 8 });
    await provider.decorationPumping;
    assert.equal(provider.desired.size, 81);
    assert.equal(provider.chunks.size, 9);
    assert.equal(provider.backgroundCompleted.size, 72);
    assert.equal(calls.length, 81);
    assert.equal(world.nativeChunks.chunks.size, 9);
    provider.lastBackgroundDemandAt = undefined;
    provider.requestBackgroundDemand({ x: 8, z: 8 });
    await provider.decorationPumping;
    assert.equal(calls.length, 81);
    assert.equal(provider.needsDecoration('4,0'), false);
    // A cached far chunk is promoted when the player arrives, not left marked complete.
    await provider.requestRadius(4, 0, 1, { decorateAll: true });
    assert.equal(provider.chunks.has('4,0'), true);
    await provider.terminate();
});

test('terrain-only background jobs also remain out of active gameplay storage', async () => {
    const { provider, world, terrainCalls } = setup();
    provider.warmCacheEnabled = true;
    Object.assign(world.minecraft.settings, { vanillithGenerationRadius: 1, vanillithBackgroundRadius: 3 });
    provider.requestBackgroundDemand({ x: 8, z: 8 });
    await provider.terrainPumping;
    assert.equal(terrainCalls.length, 49);
    assert.equal(provider.chunks.size, 9);
    assert.equal(provider.backgroundCompleted.size, 40);
    provider.lastBackgroundDemandAt = undefined;
    provider.requestBackgroundDemand({ x: 8, z: 8 });
    await provider.terrainPumping;
    assert.equal(terrainCalls.length, 49);
    await provider.terminate();
});

test('terrain test opens independently while complete vanilla worlds remain gated', () => {
    assert.equal(VANILLA_WORLDGEN_PREVIEW_READY, true);
    assert.throws(() => assertWorldGeneratorReady('vanilla_26_3'), /in development/);
    assert.doesNotThrow(() => assertWorldGeneratorReady('normal'));
});

test('Vanillith decorated chunks can use persistent worlds and stream a bounded radius', async () => {
    const persistentDecorated = new VanillaChunkProvider('1', 'overworld', { worldKey: 'saved', decorationDraft: true });
    assert.equal(persistentDecorated.worldKey, 'saved');
    assert.equal(persistentDecorated.decorationDraft, true);
    await persistentDecorated.terminate();
    assert.throws(() => new VanillaChunkProvider('1', 'overworld', { dimension: 'minecraft:the_nether' }), /settings do not match/);
    const { provider, source, calls, batches, terrainCalls, terrainBatches, preloads } = setup();
    source.decorationDraft = true;
    await provider.requestRadius(10, -10, 2);
    assert.ok(calls.slice(0, 9).some(([x, z]) => x === 10 && z === -10));
    assert.equal(calls.length, 9);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches.map(batch => batch.length), [9]);
    assert.equal(terrainCalls.length, 0);
    assert.equal(provider.getChunks().size, 9);
    assert.equal(preloads.length, 0);
    assert.equal(provider.terrainPreloaded.size, 49);
    await provider.requestRadius(20, 20, 2);
    assert.ok(calls.slice(-9).some(([x, z]) => x === 20 && z === 20));
    assert.equal(calls.length, 18);
    assert.equal(provider.getChunks().size, 9);
    await provider.terminate();
});

test('preview can enter after its center chunk and stream neighbors on the next tick', async () => {
    const { provider, source, calls } = setup();
    source.decorationDraft = true;
    await provider.requestRadius(0, 0, 0);
    assert.deepEqual(calls, [[0, 0]]);
    assert.equal(provider.getChunks().size, 1);
    await provider.requestRadius(0, 0, 1);
    assert.equal(provider.getChunks().size, 9);
    await provider.terminate();
});

test('fast terrain bootstrap is replaced by a decorated center without caching terrain as final', async () => {
    const { provider, source, calls } = setup();
    source.decorationDraft = true;
    provider.loadProvisional(new VanillaChunk(0, 0).serialize());
    assert.equal(provider.getChunks().size, 1);
    assert.equal(provider.provisional.has('0,0'), true);
    assert.equal(source.store.chunks.size, 0);
    await provider.requestRadius(0, 0, 1);
    assert.deepEqual(calls[0], [0, 0]);
    assert.equal(provider.provisional.size, 0);
    assert.equal(provider.getChunks().size, 9);
    await provider.terminate();
});

test('moving player reprioritizes shared decoration streaming without terrain-only chunks', async () => {
    const { provider, source, terrainCalls } = setup();
    source.decorationDraft = true;
    const pending = [];
    source.getChunksAtAsync = coordinates => new Promise(resolve => pending.push({ coordinates, resolve }));
    const first = provider.requestRadius(0, 0, 2);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(provider.getChunks().size, 0);
    assert.equal(provider.provisional.size, 0);
    assert.equal(pending.length, 1);
    const moved = provider.requestRadius(10, 0, 2);
    assert.equal(terrainCalls.length, 0);
    pending[0].resolve(pending[0].coordinates.map(([x, z]) => new VanillaChunk(x, z)));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.length, 2);
    assert.deepEqual(pending[1].coordinates[0], [10, 0]);
    const ending = provider.terminate();
    pending[1].resolve(pending[1].coordinates.map(([x, z]) => new VanillaChunk(x, z)));
    await Promise.all([first, moved, ending]);
});

test('decoration terrain reuse fetches each required dependency once in bounded batches', async () => {
    const provider = Object.create(VanillaChunkProvider.prototype);
    provider.seed = '1';
    provider.settings = 'overworld';
    provider.decorationDraft = true;
    provider.preloadedDecorationTerrain = new Set(['0,0']);
    const fetched = [], preloaded = [];
    provider.getTerrainChunksAtAsync = async coordinates => {
        assert.ok(coordinates.length <= 4);
        fetched.push(...coordinates);
        return coordinates.map(([x, z]) => new VanillaChunk(x, z));
    };
    provider.preloadDecorationTerrain = async chunks => {
        preloaded.push(...chunks.map(chunk => `${chunk.chunkX},${chunk.chunkZ}`));
        for (const key of preloaded) provider.preloadedDecorationTerrain.add(key);
    };
    await provider.ensureDecorationTerrain([[0, 0]]);
    assert.equal(fetched.length, 24);
    assert.equal(preloaded.length, 24);
    assert.equal(new Set(fetched.map(pair => pair.join(','))).size, 24);
    assert.equal(provider.preloadedDecorationTerrain.size, 25);
    const adjacent = [];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (x || z) adjacent.push([x, z]);
    await provider.ensureDecorationTerrain(adjacent);
    assert.equal(fetched.length, 48);
    assert.equal(new Set(fetched.map(pair => pair.join(','))).size, 48);
    assert.equal(provider.preloadedDecorationTerrain.size, 49);
});

test('terrain preload refuses payloads without matching seed/settings/generator status', async () => {
    const provider = Object.create(VanillaChunkProvider.prototype);
    Object.assign(provider, { decorationDraft: true, seed: '1', settings: 'overworld' });
    const chunk = new VanillaChunk(0, 0);
    await assert.rejects(provider.preloadDecorationTerrain([chunk]), /incompatible context or generation status/);
    chunk.terrainReuseContext = { seed: '2', dimension: 'minecraft:overworld', settings: 'overworld',
        generator: 'wrong', minY: -64, height: 384, stages: ['material_rules'], pendingStages: ['decoration'],
        playable: false, decorationDraft: false };
    await assert.rejects(provider.preloadDecorationTerrain([chunk]), /incompatible context or generation status/);
});

test('terrain worker results are tagged only after seed, settings, bounds and status validation', async () => {
    const provider = new VanillaChunkProvider('1', 'overworld', { decorationDraft: true });
    provider.ensureTerrainWorker = () => ({ postMessage({ id, request }) {
        const payload = new VanillaChunk(...request.coords[0]).serialize();
        queueMicrotask(() => provider.terrainPending.get(id).resolve({
            format: 'breakmine:vanilla-generation-v1', seed: '1', settings: 'overworld',
            stages: ['noise', 'aquifer', 'biomes', 'material_rules'],
            pendingStages: ['carvers', 'decoration', 'structures', 'lighting'], playable: false, chunks: [payload]
        }));
    } });
    const [terrain] = await provider.getTerrainChunksAtAsync([[2, -3]]);
    assert.equal(terrain.terrainReuseContext.dimension, 'minecraft:overworld');
    assert.equal(terrain.terrainReuseContext.generator.length, 64);
    assert.equal(terrain.terrainReuseContext.playable, false);
    await provider.terminate();

    const incompatible = new VanillaChunkProvider('1', 'overworld', { decorationDraft: true });
    incompatible.ensureTerrainWorker = () => ({ postMessage({ id, request }) {
        const payload = new VanillaChunk(...request.coords[0]).serialize();
        queueMicrotask(() => incompatible.terrainPending.get(id).resolve({
            format: 'breakmine:vanilla-generation-v1', seed: '1', settings: 'overworld',
            stages: ['noise', 'aquifer', 'biomes'], pendingStages: ['decoration'], playable: false, chunks: [payload]
        }));
    } });
    await assert.rejects(incompatible.getTerrainChunksAtAsync([[0, 0]]), /incompatible generation status/);
    await incompatible.terminate();
});

test('four terrain workers dispatch concurrently and preserve request/result coordinate order', async () => {
    const provider = new VanillaChunkProvider('1'); provider.terrainParallelism = 4;
    const dispatched = [], streamed = [];
    provider.ensureTerrainWorker = index => ({ postMessage({ id, request }) {
        dispatched.push(index);
        setTimeout(() => provider.terrainPending.get(id).resolve({
            format: 'breakmine:vanilla-generation-v1', seed: '1', settings: 'overworld',
            stages: ['noise','aquifer','biomes','material_rules'],
            pendingStages: ['carvers','decoration','structures','lighting'], playable: false,
            chunks: request.coords.map(pair => new VanillaChunk(...pair).serialize())
        }), (4-index) * 5);
    } });
    const promise = provider.requestTerrainChunksAtAsync([[4,0],[0,4],[-4,0],[0,-4]], null,
        chunk => streamed.push([chunk.chunkX, chunk.chunkZ]));
    assert.deepEqual(dispatched, [0,1,2,3]);
    const chunks = await promise;
    assert.deepEqual(chunks.map(chunk => [chunk.chunkX,chunk.chunkZ]), [[4,0],[0,4],[-4,0],[0,-4]]);
    assert.deepEqual(streamed, [[0,-4],[-4,0],[0,4],[4,0]]);
    await provider.terminate();
});

test('initial preview loads nearest chunk first, nine scene chunks, progress and no duplicate requests', async () => {
    const { provider, calls, terrainCalls, world, progress } = setup();
    provider.source.decorationDraft = true;
    const first = provider.requestRadius(0, 0, 1);
    const second = provider.requestRadius(0, 0, 1);
    await Promise.all([first, second]);
    assert.equal(terrainCalls.length, 0);
    assert.equal(provider.getChunks().size, 9);
    assert.equal(world.nativeChunks.chunks.size, 9);
    assert.equal(progress.at(-1), 1);
    await provider.requestRadius(0, 0, 1);
    assert.equal(calls.length, 9);
    await provider.terminate();
    assert.equal(provider.getChunks().size, 0);
});

test('moving the camera replaces desired requests and evicts distant scene and native cache entries', async () => {
    const { provider, source, terrainCalls, world } = setup();
    await provider.requestRadius(0, 0, 1);
    await provider.requestRadius(65536, -2, 1);
    assert.equal(provider.getChunks().size, 9);
    assert.equal(world.nativeChunks.chunks.size, 9);
    assert.equal(terrainCalls.length, 18);
    assert.ok(provider.getChunks().has('65536,-2'));
    assert.ok(!provider.getChunks().has('0,0'));
    await provider.terminate();
});

test('terminating during generation cannot attach a late chunk', async () => {
    const resolvers = [];
    const { provider, source, world } = setup((x, z) => new Promise(done => { resolvers.push(() => done(new VanillaChunk(x, z))); }));
    const loading = provider.requestRadius(0, 0, 1);
    const ending = provider.terminate();
    for (const resolve of resolvers) resolve();
    await Promise.all([loading, ending]);
    assert.equal(provider.getChunks().size, 0);
    assert.equal(world.nativeChunks.chunks.size, 0);
    assert.equal(source.closed, true);
});

test('failed generation reports a visible error and does not retry indefinitely', async () => {
    const { provider, world, terrainCalls } = setup(async () => { throw new Error('Generation failed'); });
    await provider.requestRadius(0, 0, 1);
    assert.equal(world.vanillaPreviewError, 'Generation failed');
    assert.equal(provider.getChunks().size, 0);
    await provider.requestRadius(1, 1, 1);
    assert.equal(terrainCalls.length, 4);
    await provider.terminate();
});

test('Vanillith world ticks preserve its selected game mode and run scheduled block simulation', () => {
    const world = Object.create(VanillaPreviewWorld.prototype);
    let updated = false, requested;
    const player = { x: -1, z: -17, motionX: 0.2, motionZ: -0.2, spectator: false, creative: true, flying: false, onUpdate() {
        assert.equal(this.spectator, false); assert.equal(this.creative, false); assert.equal(this.flying, false); updated = true;
    } };
    Object.assign(world, { entities: [player], cloudOffset: 0, time: 6000, worldAgeTicks: 0,
        inhabitedTimeByChunk: new Map(), moonBrightness: 1, animationTick: 0,
        clouds: { position: {}, material: { color: { setRGB() {} } } }, cloudTexture: { offset: {} },
        calculateSkylightSubtracted: () => 0,
        vanillithPlayable: true, gameMode: 'survival', scheduledBlockTicks: new Map(),
        minecraft: { player, loadingScreen: null, isSingleplayer: () => true },
        chunkProvider: { requestRadius: (...args) => { requested = args; } } });
    world.onTick();
    assert.equal(updated, true);
    assert.deepEqual(requested, [0, -3, 3, { decorateAll: true }]);
    assert.equal(world.time, 6001);
    assert.equal(world.worldAgeTicks, 1);
    assert.equal(world.inhabitedTimeByChunk.get('-1,-2'), 1);
    assert.equal(world.vanillithPlayable, true);
    assert.equal(typeof world.scheduleBlockTick, 'function');
});
