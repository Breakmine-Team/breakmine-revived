import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VanillaChunk } from '../chunk.mjs';
import { createProgressiveDecorationSession, generateDecorationDraft, generateDecorationDraftBatch,
    generateProgressiveDecorationDraft } from '../decoration-stage.mjs';
import { createChunkService, chunkTransferList } from '../chunk-service.mjs';
import terrainRender from '../generated/terrain-render.json' with { type: 'json' };
import treeRender from '../generated/decoration-render.json' with { type: 'json' };
import featureRender from '../generated/feature-render.json' with { type: 'json' };

test('all 25 terrain neighbors exist before any of the nine interior decoration stages runs', () => {
    const sampled = [], decorated = [];
    const result = generateDecorationDraft({ chunkX: -1, chunkZ: 2,
        sampleChunk(x, z) { sampled.push([x, z]); return new VanillaChunk(x, z, 0, 16).serialize(); },
        decorateChunk({ chunks, chunkX, chunkZ }) {
            assert.equal(sampled.length, 25);
            assert.equal(chunks.size, 25);
            decorated.push([chunkX, chunkZ]);
            return { results: [], ticks: [] };
        }
    });
    assert.deepEqual(sampled[0], [-3, 0]);
    assert.deepEqual(sampled.at(-1), [1, 4]);
    assert.deepEqual(decorated[0], [-2, 1]);
    assert.deepEqual(decorated.at(-1), [0, 3]);
    assert.equal(result.reports.length, 9);
    assert.equal(result.chunk.chunkX, -1);
    assert.equal(result.publication, 'draft-only');
    assert.equal(result.nativeOrderVerified, false);
});

test('neighbor feature writes reach the target, while caller terrain buffers stay immutable', () => {
    const base = new Map();
    const sampleChunk = (x, z) => {
        const key = `${x},${z}`;
        if (!base.has(key)) base.set(key, new VanillaChunk(x, z, 0, 16).serialize());
        return base.get(key);
    };
    const draft = () => generateDecorationDraft({ chunkX: 0, chunkZ: 0, sampleChunk,
        decorateChunk({ chunks, chunkX, chunkZ }) {
            if (chunkX === -1 && chunkZ === 0) chunks.get('0,0').setBlock(0, 10, 0, 1);
            return { results: [{ succeeded: true }], ticks: [] };
        }
    });
    const first = draft();
    assert.equal(first.chunk.blocks[10 * 256], 1);
    assert.equal(base.get('0,0').blocks[10 * 256], 0);
    assert.deepEqual(first, draft());
});

test('adjacent decoration drafts share terrain and source stages without mutating sampled chunks', () => {
    const base = new Map();
    const sampled = [], decorated = [];
    const results = generateDecorationDraftBatch({ coords: [[0, 0], [1, 0]],
        sampleChunk(x, z) {
            sampled.push(`${x},${z}`);
            const key = `${x},${z}`;
            if (!base.has(key)) base.set(key, new VanillaChunk(x, z, 0, 16).serialize());
            return base.get(key);
        },
        decorateChunk({ chunks, chunkX, chunkZ }) {
            decorated.push(`${chunkX},${chunkZ}`);
            chunks.get(`${chunkX},${chunkZ}`).setBlock(0, 10, 0, 1);
            return { results: [], ticks: [] };
        }
    });
    assert.equal(sampled.length, 30);
    assert.equal(new Set(sampled).size, 30);
    assert.equal(decorated.length, 12);
    assert.equal(new Set(decorated).size, 12);
    assert.equal(results.length, 2);
    for (const result of results) {
        assert.equal(result.chunk.blocks[10 * 256], 1);
        assert.equal(result.reports.length, 9);
        assert.equal(result.nativeOrderVerified, false);
    }
    assert.equal(base.get('0,0').blocks[10 * 256], 0);
    assert.equal(base.get('1,0').blocks[10 * 256], 0);
});

test('a streamed chunk waits for every canonical neighboring feature source that can write into it', () => {
    const coords = [];
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) coords.push([x, z]);
    const calls = [], streamed = [];
    const result = generateDecorationDraftBatch({ coords,
        sampleChunk: (x, z) => new VanillaChunk(x, z, 0, 16).serialize(),
        decorateChunk({ chunks, chunkX, chunkZ }) {
            calls.push(`${chunkX},${chunkZ}`);
            if (Math.abs(chunkX) <= 1 && Math.abs(chunkZ) <= 1) {
                chunks.get('0,0').setBlock(chunkX + 1, 5, chunkZ + 1, calls.length);
            }
            return { results: [], ticks: [] };
        },
        onChunkReady(chunk) { streamed.push({ chunk, executedSources: calls.length }); }
    });
    const center = streamed.find(({ chunk }) => chunk.chunkX === 0 && chunk.chunkZ === 0);
    assert.ok(center);
    assert.deepEqual([...center.chunk.blocks.slice(5 * 256, 6 * 256)].filter(Boolean), [7, 8, 9, 12, 13, 14, 17, 18, 19]);
    assert.equal(center.executedSources, 19);
    assert.equal(streamed.length, 9);
    assert.equal(result.find(entry => entry.chunk.chunkX === 0 && entry.chunk.chunkZ === 0).chunk.blocks[5 * 256], center.chunk.blocks[5 * 256]);
});

test('experimental progressive reuse executes expanded source chunks once and preserves cross-boundary writes', () => {
    const session = createProgressiveDecorationSession();
    const calls = [];
    const options = {
        session,
        sampleChunk: (x, z) => new VanillaChunk(x, z, 0, 16).serialize(),
        decorateChunk({ chunks, chunkX, chunkZ }) {
            calls.push(`${chunkX},${chunkZ}`);
            const targetX = chunkX === 0 ? 16 : chunkX * 16;
            chunks.get('0,0').setBlock(targetX & 15, 5, 0, calls.length);
            return { results: [], ticks: [] };
        }
    };
    const initial = generateProgressiveDecorationDraft({ ...options, coords: [[0, 0]] });
    assert.equal(initial[0].sourceExecutionsThisRequest, 9);
    assert.equal(initial[0].sourceReusesThisRequest, 0);
    const expandedCoords = [];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (x || z) expandedCoords.push([x, z]);
    const expanded = generateProgressiveDecorationDraft({ ...options, coords: expandedCoords });
    assert.equal(expanded[0].sourceExecutionsThisRequest, 16);
    assert.equal(expanded[0].sourceReusesThisRequest, 9);
    assert.equal(calls.length, 25);
    assert.equal(new Set(calls).size, 25);
    assert.equal(session.chunks.get('0,0').getBlock(0, 5, 0), 25);
    assert.equal(expanded.length, 8);
});

test('canonical progressive source order matches the clean 5x5 batch including cross-chunk writes', () => {
    const coords = [];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) coords.push([x, z]);
    const rest = coords.filter(([x, z]) => x || z);
    const decorate = calls => ({ chunks, chunkX, chunkZ }) => {
        calls.push(`${chunkX},${chunkZ}`);
        const target = chunks.get(`${chunkX + 1},${chunkZ}`);
        if (target) target.setBlock(0, 4, 0, calls.length);
        return { results: [], ticks: [] };
    };
    const cleanCalls = [];
    const clean = generateDecorationDraftBatch({ coords, sampleChunk: (x, z) => new VanillaChunk(x, z, 0, 16).serialize(),
        decorateChunk: decorate(cleanCalls) });
    const session = createProgressiveDecorationSession(), progressiveCalls = [], progressiveSamples = new Set();
    const options = { session, sampleChunk: (x, z) => {
        progressiveSamples.add(`${x},${z}`);
        return new VanillaChunk(x, z, 0, 16).serialize();
    }, decorateChunk: decorate(progressiveCalls) };
    const initial = generateProgressiveDecorationDraft({ ...options, coords: [[0, 0]], sourcePlanCoords: coords, executeThroughCenter: [0, 0] });
    const initialTerrainCount = progressiveSamples.size;
    const initialSessionCount = session.chunks.size;
    const expanded = generateProgressiveDecorationDraft({ ...options, coords: rest, sourcePlanCoords: coords });
    const final = coords.map(([x, z]) => session.chunks.get(`${x},${z}`).serialize());
    assert.equal(initial[0].sourceExecutionsThisRequest, 19);
    assert.equal(initial[0].sourceExecutionsDeferred, 6);
    assert.equal(initialTerrainCount, 41);
    assert.equal(initialSessionCount, 41);
    assert.equal(expanded[0].sourceExecutionsThisRequest, 6);
    assert.equal(expanded[0].sourceReusesThisRequest, 19);
    assert.equal(progressiveSamples.size, 49);
    assert.equal(session.chunks.size, 49);
    assert.deepEqual(progressiveCalls, cleanCalls);
    assert.deepEqual(final.map(chunk => chunk.blocks), clean.map(result => result.chunk.blocks));
});

test('failed decoration cannot publish partial writes or corrupt reusable terrain', () => {
    const base = new Map();
    assert.throws(() => generateDecorationDraft({ chunkX: 0, chunkZ: 0,
        sampleChunk(x, z) { const chunk = new VanillaChunk(x, z, 0, 16).serialize(); base.set(`${x},${z}`, chunk); return chunk; },
        decorateChunk({ chunks }) { chunks.get('0,0').setBlock(0, 10, 0, 1); throw new Error('Unported feature'); }
    }), /Unported feature/);
    assert.equal(base.get('0,0').blocks[10 * 256], 0);
});

test('draft validates boundary margins, terrain coordinates and synchronous feature stages', () => {
    const sampleChunk = (x, z) => new VanillaChunk(x, z, 0, 16).serialize();
    assert.throws(() => generateDecorationDraft({ chunkX: -134217728, chunkZ: 0, sampleChunk, decorateChunk() {} }), /neighborhood/);
    assert.throws(() => generateDecorationDraft({ chunkX: 0, chunkZ: 0, sampleChunk: () => sampleChunk(0, 0), decorateChunk() {} }), /context mismatch/);
    assert.throws(() => generateDecorationDraft({ chunkX: 0, chunkZ: 0, sampleChunk, decorateChunk: () => Promise.resolve() }), /synchronous/);
});

async function assets() {
    const json = async name => JSON.parse(await readFile(new URL(`../generated/${name}.json`, import.meta.url)));
    return { bytes: await readFile(new URL('../generated/worldgen.wasm', import.meta.url)),
        climate: await json('climate'), data: await json('vanilla-data'), registry: await json('block-states') };
}

test('seed one executes all nine actual decoration stages with native rules without mutating cached terrain', { timeout: 90000 }, async () => {
    const input = await assets();
    input.stateRules = JSON.parse(await readFile(new URL('../generated/block-rules.json', import.meta.url)));
    const service = await createChunkService(input);
    try {
        const request = { seed: '1', coords: [[0, 0]] };
        const before = service.generate(request);
        const draft = service.generate({ ...request, mode: 'decoration_draft' });
        assert.equal(draft.decorationDraft[0].reports.length, 9);
        assert.ok(draft.decorationDraft[0].reports.every(report => report.featureCount > 0));
        assert.notDeepEqual(draft.chunks[0].blocks, before.chunks[0].blocks);
        const mapped = new Set(input.registry.states.filter(state => ['minecraft:water', 'minecraft:lava'].includes(state.name)).map(state => state.id));
        for (const b of [...terrainRender.blocks, ...treeRender.blocks, ...featureRender.blocks]) for (const id of b.stateIds ?? [b.stateId]) mapped.add(id);
        for (const s of input.registry.states) if (['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(s.name)) mapped.add(s.id);
        for (const id of new Set(draft.chunks[0].blocks)) assert.ok(mapped.has(id), `Missing draft render state ${id}`);
        assert.deepEqual(service.generate(request).chunks, before.chunks);
        assert.equal(draft.playable, false);
    } finally { service.dispose(); }
});

test('generation service drafts are transferable, isolated from terrain cache, and never claim full decoration', async () => {
    const input = await assets();
    // Empty feature fixture exercises the real WASM terrain/worker service contract;
    // it does not represent vanilla decorated-biome output.
    for (const [path, biome] of Object.entries(input.data)) if (path.startsWith('data/minecraft/worldgen/biome/')) input.data[path] = { ...biome, features: [] };
    const service = await createChunkService({ ...input, maxCachedChunks: 32 });
    try {
        const request = { seed: '1', coords: [[0, 0]] };
        const base = service.generate(request);
        const draft = service.generate({ ...request, mode: 'decoration_draft' });
        assert.equal(draft.decorationDraft[0].reports.length, 9);
        assert.equal(draft.decorationDraft[0].publication, 'draft-only');
        assert.equal(draft.playable, false);
        assert.ok(draft.pendingStages.includes('decoration'));
        assert.ok(!draft.stages.includes('decoration'));
        const transferred = structuredClone(draft, { transfer: chunkTransferList(draft) });
        assert.deepEqual(transferred.chunks, base.chunks);
        const terrainCoords = [];
        for (let z = -2; z <= 2; z++) for (let x = -2; x <= 3; x++) terrainCoords.push([x, z]);
        const preloadedChunks = [];
        for (let index = 0; index < terrainCoords.length; index += 4) {
            preloadedChunks.push(...service.generate({ seed: '1', coords: terrainCoords.slice(index, index + 4) }).chunks);
        }
        assert.equal(service.preloadTerrainChunks({ seed: '1', chunks: preloadedChunks }), terrainCoords.length);
        const adjacentRequest = { seed: '1', coords: [[0, 0], [1, 0]], mode: 'decoration_draft' };
        const adjacent = service.generate({ ...adjacentRequest, profile: true });
        assert.equal(adjacent.chunks.length, 2);
        assert.deepEqual(adjacent.decorationDraft.map(entry => entry.reports.length), [9, 9]);
        assert.deepEqual(adjacent.decorationDraft.map(entry => entry.order), ['shared-z-then-x', 'shared-z-then-x']);
        assert.equal(adjacent.profile.terrainCacheMisses, 0);
        assert.equal(adjacent.profile.terrainCacheHits, terrainCoords.length);
        assert.equal(adjacent.terrainCacheKeys.length, terrainCoords.length);
        const streamed = [];
        const streamedAdjacent = service.generate({ ...adjacentRequest, profile: true }, { onChunkReady: chunk => streamed.push(chunk) });
        assert.deepEqual(streamed.map(chunk => [chunk.chunkX, chunk.chunkZ]).sort(), [[0, 0], [1, 0]]);
        assert.deepEqual(streamed, streamedAdjacent.chunks);
        const cachedAdjacent = service.generate(adjacentRequest);
        assert.deepEqual(structuredClone(cachedAdjacent, { transfer: chunkTransferList(cachedAdjacent) }).chunks, adjacent.chunks);
        assert.deepEqual(service.generate(request).chunks, base.chunks);
        assert.throws(() => service.generate({ ...request, mode: 'unknown' }), /generation mode/);
    } finally { service.dispose(); }
});

test('real vanilla draft reports unported context instead of skipping it and leaves terrain reusable', async () => {
    const service = await createChunkService(await assets());
    try {
        const request = { seed: '1', coords: [[0, 0]] };
        const before = service.generate(request);
        assert.throws(() => service.generate({ ...request, mode: 'decoration_draft' }), /Decoration draft 0,0:/);
        assert.deepEqual(service.generate(request).chunks, before.chunks);
    } finally { service.dispose(); }
});
