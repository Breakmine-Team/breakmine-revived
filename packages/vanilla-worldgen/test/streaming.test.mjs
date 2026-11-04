import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamingLRU, StreamingMetrics, streamingDemand, customMemoryBudget } from '../../../src/js/net/minecraft/client/world/provider/VanillaStreaming.js';
import VanillaPreviewChunkProvider from '../../../src/js/net/minecraft/client/world/provider/VanillaPreviewChunkProvider.js';
import VanillaChunkProvider from '../../../src/js/net/minecraft/client/world/provider/VanillaChunkProvider.js';
import { VANILLA_SOURCE_SHA } from '../chunk-session.mjs';
import MetadataChunkBlock from '../../../src/js/net/minecraft/util/MetadataChunkBlock.js';
import EnumSkyBlock from '../../../src/js/net/minecraft/util/EnumSkyBlock.js';
import World from '../../../src/js/net/minecraft/client/world/World.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import VanillaRenderChunk from '../../../src/js/net/minecraft/client/world/VanillaRenderChunk.js';
import { VanillaChunk } from '../chunk.mjs';
import * as THREE from '../../../libraries/three.module.js';
import BlockRenderer from '../../../src/js/net/minecraft/client/render/BlockRenderer.js';

test('slider memory budgets clamp safely and reserve nominal process headroom', () => {
    const low = customMemoryBudget(256), high = customMemoryBudget(3072);
    assert.deepEqual(customMemoryBudget(99999), high);
    assert.deepEqual(customMemoryBudget(-1), low);
    assert.ok(high.nativeBytes > low.nativeBytes);
    assert.ok(high.nativeBytes + high.renderBytes + high.terrainBytes + high.lodBytes < 3072 * 1024 ** 2);
});

test('warm cache LRU refreshes visits, obeys byte budget and releases resources', () => {
    const removed = [], cache = new StreamingLRU(20, (_, key) => removed.push(key));
    cache.put('A', 1, 10); cache.put('B', 2, 10);
    assert.equal(cache.get('A'), 1);
    cache.put('C', 3, 10);
    assert.equal(cache.entries.has('B'), false);
    assert.equal(cache.take('A'), 1);
    assert.deepEqual(removed, ['B']);
    cache.clear(); assert.equal(cache.bytes, 0); assert.deepEqual(removed, ['B', 'C']);
});

test('near field is independent of camera and movement changes priority, not demanded coordinates', () => {
    const forward = streamingDemand({ x: 0, z: 0, radius: 3, velocityX: 32, yaw: 180 });
    const backward = streamingDemand({ x: 0, z: 0, radius: 3, velocityX: -32, yaw: 0 });
    assert.deepEqual(new Set(forward.map(c => c.key)), new Set(backward.map(c => c.key)));
    assert.equal(forward.filter(c => c.tier === 0).length, 9);
    assert.equal(forward.find(c => c.key === '2,0').tier, 1);
    assert.equal(backward.find(c => c.key === '-2,0').tier, 1);
    assert.equal(forward[0].key, '0,0');
});
test('streaming demand keeps a warm outer LOD ring, scales prediction with speed, and treats yaw as secondary', () => {
    const stopped = streamingDemand({ x: 0, z: 0, radius: 3, backgroundRadius: 6, yaw: 0 });
    assert.equal(stopped.filter(c => c.tier === 0).length, 9, 'immediate 3x3 remains critical');
    assert.equal(stopped.find(c => c.key === '5,0').tier, 4, 'outer side/rear chunks stay low priority');
    assert.equal(stopped.find(c => c.key === '0,5').tier, 4, 'outer forward chunks stay low priority while stopped');
    assert.equal(stopped.some(c => c.tier === 1), false, 'stationary player has no directional prediction corridor');

    const walking = streamingDemand({ x: 0, z: 0, radius: 3, backgroundRadius: 8, velocityX: 4.3, yaw: 0 });
    const flying = streamingDemand({ x: 0, z: 0, radius: 3, backgroundRadius: 8, velocityX: 48, yaw: 0 });
    assert.equal(walking.find(c => c.key === '4,0').tier, 4, 'walking prediction stays short');
    assert.equal(flying.find(c => c.key === '4,0').tier, 1, 'fast movement gets a longer predicted corridor');
    assert.equal(flying.find(c => c.key === '0,3').tier, 1, 'a sharp camera turn is also warmed immediately');
    assert.ok(flying.findIndex(c => c.key === '3,0') < flying.findIndex(c => c.key === '0,3'),
        'actual movement sorts ahead of the camera-only corridor');
});

test('priority prototype preserves the complete critical source-region footprint after center publication', async () => {
    for (const yaw of [0, 90, 180, 270]) {
        const provider = Object.create(VanillaPreviewChunkProvider.prototype);
        const demand = streamingDemand({ x: 0, z: 0, radius: 3, yaw });
        const requests = [];
        Object.assign(provider, { closed: false, error: null, decorationFocus: '0,0',
            decorationDesired: new Map(demand.map(c => [c.key, c.coordinate])),
            demandTiers: new Map(demand.map(c => [c.key, c.tier])),
            chunks: new Map([['0,0', {}]]), publications: new Map(), provisional: new Set(),
            streamingMetrics: new StreamingMetrics(), onProgress() {},
            source: { store: { chunks: new Map() }, async getChunksAtAsync(coords) {
                requests.push(coords); provider.closed = true; return [];
            } } });
        await provider.pumpDecoration();
        assert.equal(requests.length, 1);
        assert.deepEqual(new Set(requests[0].map(pair => pair.join(','))), new Set(
            demand.filter(c => c.tier === 0 && c.key !== '0,0').map(c => c.key)));
    }
});

test('telemetry uses bounded samples while retaining cumulative spike counts', () => {
    const metrics = new StreamingMetrics(8);
    for (let i = 0; i < 100; i++) metrics.record('frames', 60);
    assert.equal(metrics.snapshot().timings.frames.retainedSamples, 8);
    assert.equal(metrics.snapshot().timings.frames.over50, 100);
});

new Block(1);
function fixture() {
    const native = new VanillaChunk(0, 0);
    native.blocks.fill(1, 0, 256 * 68);
    native.heightmap.fill(4);
    const world = Object.create(World.prototype);
    Object.assign(world, { minY: -64, maxY: 320, height: 384,
        minecraft: { settings: { ambientOcclusion: false }, player: { x: 8, y: 8, z: 8, getEyeHeight: () => 1.6 } } });
    const mapping = new Map([[0, 0], [1, 16]]);
    return { native, world, mapping };
}

test('sliced payload conversion and initial lightmaps match synchronous results exactly', () => {
    const { native, world, mapping } = fixture();
    const a = VanillaRenderChunk.fromPayload(world, native.serialize(), mapping);
    const steps = VanillaRenderChunk.fromPayloadSteps(world, native.serialize(), mapping);
    let result, slices = 0;
    do { result = steps.next(); slices++; } while (!result.done);
    const b = result.value;
    assert.ok(slices >= 24);
    world.updateChunkSkyLight(a); world.resetChunkBlockLight(a);
    for (const _ of world.updateChunkSkyLightSteps(b)) {}
    for (const _ of world.resetChunkBlockLightSteps(b)) {}
    assert.deepEqual(a.heightMap, b.heightMap);
    for (let i = 0; i < a.sections.length; i++) for (const field of ['blocks', 'blocksData', 'skyLight', 'blockLight']) assert.deepEqual(a.sections[i][field], b.sections[i][field], field);
});

test('sliced meshing preserves vertex/index/UV/colors and isolates GUI tessellator state between slices', () => {
    const { native, world, mapping } = fixture();
    const a = VanillaRenderChunk.fromPayload(world, native.serialize(), mapping);
    const b = VanillaRenderChunk.fromPayload(world, native.serialize(), mapping);
    Object.assign(world, { getChunkAtBlock: () => null, getBlockAt: (x, y, z) => x >= 0 && x < 16 && z >= 0 && z < 16 && y < 4 ? 1 : 0,
        getChunkAt: () => a, getBlockAtFace: () => 0, getTotalLightAt: () => 15, getBlockDataAt: () => 0, isWaterAt: () => false });
    const renderer = { textureAtlas: { isLoaded: () => true, getTexture: () => null, getUVs: () => ({ minU: 0, maxU: 1, minV: 0, maxV: 1 }) } };
    renderer.blockRenderer = new BlockRenderer(renderer);
    const original = renderer.blockRenderer.tessellator;
    const index = 4;
    a.sections[index].rebuild(renderer);
    const steps = b.sections[index].rebuildSteps(renderer, true);
    let result;
    do {
        result = steps.next();
        assert.equal(renderer.blockRenderer.tessellator, original);
        original.startDrawing(); original.addVertexWithUV(1, 2, 3, .1, .2);
    } while (!result.done);
    assert.equal(a.sections[index].group.children.length, b.sections[index].group.children.length);
    for (let i = 0; i < a.sections[index].group.children.length; i++) {
        const ga = a.sections[index].group.children[i].geometry, gb = b.sections[index].group.children[i].geometry;
        assert.deepEqual(ga.index.array, gb.index.array);
        for (const key of Object.keys(ga.attributes)) assert.deepEqual(ga.attributes[key].array, gb.attributes[key].array, key);
    }
});

test('publication is deduplicated, deferred and discarded safely when demand moves away', async () => {
    const provider = Object.create(VanillaPreviewChunkProvider.prototype);
    Object.assign(provider, { frameBudgetEnabled: true, closed: false, publications: new Map(), desired: new Map([['0,0', [0, 0]]]), streamingMetrics: new StreamingMetrics() });
    let published = 0;
    provider.publicationSteps = function* () { yield; published++; return 1; };
    const payload = { chunkX: 0, chunkZ: 0 };
    const a = provider.enqueuePublication(payload), b = provider.enqueuePublication(payload);
    assert.equal(a, b); assert.equal(published, 0);
    provider.desired.clear();
    provider.flushPublications(performance.now() + 100);
    await a; assert.equal(published, 0);
    provider.desired.set('0,0', [0, 0]);
    const c = provider.enqueuePublication(payload);
    provider.flushPublications(performance.now() + 100);
    assert.equal(await c, 1); assert.equal(published, 1);
});

test('terrain in-flight overlap shares a job and a return visit uses the exact cached arrays', async () => {
    const source = new VanillaChunkProvider('1', 'overworld', { warmCache: true });
    const requests = [];
    source.requestTerrainChunksAtAsync = coords => new Promise(resolve => requests.push({ coords, resolve }));
    const first = source.getTerrainChunksAtAsync([[0, 0], [1, 0]]);
    const overlap = source.getTerrainChunksAtAsync([[1, 0], [2, 0]]);
    assert.deepEqual(requests.map(r => r.coords), [[[0, 0], [1, 0]], [[2, 0]]]);
    for (const request of requests) request.resolve(request.coords.map(pair => new VanillaChunk(...pair)));
    const a = await first, b = await overlap;
    assert.equal(a[1], b[0]);
    assert.equal((await source.getTerrainChunksAtAsync([[0, 0]]))[0], a[0]);
    assert.equal(requests.length, 2);
    const otherSeed = new VanillaChunkProvider('2', 'overworld', { warmCache: true });
    assert.equal(otherSeed.terrainCache.entries.size, 0);
    await source.terminate(); await otherSeed.terminate();
    assert.equal(source.terrainCache.bytes, 0);
});

test('A-B-A restores decorated world/mesh state without requesting generation again', async () => {
    const { world } = fixture();
    const source = { seed: '1', decorationDraft: true, store: { chunks: new Map() }, requests: 0,
        async getChunksAtAsync(coords) {
            return coords.map(([x,z]) => {
                const key = `${x},${z}`;
                if (!this.store.chunks.has(key)) { this.requests++; this.store.chunks.set(key, new VanillaChunk(x, z)); }
                return this.store.chunks.get(key);
            });
        }, async terminate() { this.store.chunks.clear(); } };
    Object.assign(world, { chunkProvider: null, group: new THREE.Group(), lightUpdateQueue: [], updateChunkLight: () => {},
        minecraft: { settings: { vanillithWarmCache: true }, worldRenderer: { chunkSectionUpdateQueue: [] } } });
    const provider = new VanillaPreviewChunkProvider(world, source,
        { protocol: 1, source: VANILLA_SOURCE_SHA, token: 1, settings: 'overworld', minY: -64, height: 384 }, new Map([[0,0], [1,16]]));
    world.chunkProvider = provider;
    await provider.requestRadius(0, 0, 0);
    const initial = provider.chunks.get('0,0');
    await provider.requestRadius(20, 0, 0);
    assert.equal(provider.warmRender.entries.has('0,0'), true);
    await provider.requestRadius(0, 0, 0);
    assert.equal(provider.chunks.get('0,0'), initial);
    assert.equal(source.requests, 2);
    assert.equal(provider.streamingMetrics.snapshot().counts.warmRestores, 1);
    await provider.terminate();
    assert.equal(provider.warmRender.bytes, 0);
});

test('sliced flood visits the same blocks in the same order as the synchronous flood', () => {
    const run = sliced => {
        const light = new Map(), writes = [];
        const key = (x,y,z) => `${x},${y},${z}`;
        const world = { minY: 0, maxY: 16, height: 16,
            blockExists: (x,y,z) => x >= 0 && x < 4 && z >= 0 && z < 4 && y >= 0 && y < 16,
            getBlockAt: () => 0, isAboveGround: (_x,y) => y >= 10,
            getSavedLightValue: (_type,x,y,z) => light.get(key(x,y,z)) ?? 0,
            setLightAt(type,x,y,z,v) { writes.push([x,y,z,v]); light.set(key(x,y,z), v); } };
        const update = new MetadataChunkBlock(EnumSkyBlock.SKY, 0, 0, 0, 3, 15, 3);
        if (sliced) { for (const _ of update.updateBlockLightningSteps(world)) {} }
        else update.updateBlockLightning(world);
        return { light, writes };
    };
    assert.deepEqual(run(true), run(false));
});

test('long exploration stays within a fixed warm byte budget', () => {
    const cache = new StreamingLRU(8 * 1024 * 1024);
    for (let x = 0; x < 2000; x++) {
        cache.put(`${x},0`, { x }, 512 * 1024);
        assert.ok(cache.bytes <= cache.budget);
        assert.ok(cache.entries.size <= 16);
    }
    assert.equal(cache.evictions, 1984);
});

test('warm prewarm installs the complete dependency set once and reprioritization keeps computed terrain', async () => {
    const source = new VanillaChunkProvider('1', 'overworld', { decorationDraft: true, warmCache: true });
    let generated = 0, preloads = [];
    source.requestTerrainChunksAtAsync = async coords => coords.map(pair => { generated++; return new VanillaChunk(...pair); });
    source.preloadDecorationTerrain = async chunks => { preloads.push(chunks.map(c => `${c.chunkX},${c.chunkZ}`)); };
    assert.equal(await source.ensureDecorationTerrain([[0, 0]]), true);
    assert.equal(generated, 25); assert.equal(preloads.length, 1); assert.equal(preloads[0].length, 25);
    await source.ensureDecorationTerrain([[1, 0]]);
    assert.equal(generated, 30); assert.equal(preloads[1].length, 25);
    assert.equal(source.terrainCache.hits, 20);
    let checks = 0;
    assert.equal(await source.ensureDecorationTerrain([[20, 0]], { shouldContinue: () => ++checks < 3 }), false);
    assert.equal(generated, 38); assert.equal(preloads.length, 2);
    assert.equal(source.terrainCache.entries.has('18,-2'), true);
    // Avoid starting the integrated worker in this pure orchestration test.
    source.decorationDraft = false;
    await source.terminate();
});
