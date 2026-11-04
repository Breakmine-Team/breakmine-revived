import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChunkService, chunkTransferList, terrainStateIds } from '../chunk-service.mjs';
import { VanillaChunk } from '../chunk.mjs';
import { VanillaChunkStore, readVanillaChunk } from '../chunk-store.mjs';

async function inputs() {
    const json = async name => JSON.parse(await readFile(new URL(`../generated/${name}.json`, import.meta.url)));
    return { bytes: await readFile(new URL('../generated/worldgen.wasm', import.meta.url)),
        climate: await json('climate'), data: await json('vanilla-data'), registry: await json('block-states') };
}

test('material state resolver chooses exact properties, not first registry entry', () => {
    const states = terrainStateIds({ states: [
        { id: 8, name: 'minecraft:grass_block', properties: { snowy: 'true' } },
        { id: 9, name: 'minecraft:grass_block', properties: { snowy: 'false' } },
        { id: 10, name: 'minecraft:unknown', properties: { a: 'x' } },
        { id: 11, name: 'minecraft:unknown', properties: { a: 'y' } }
    ] });
    assert.equal(states['minecraft:grass_block'], 9);
    assert.equal(states['minecraft:unknown'], undefined);
});

test('modern chunk transfer/store preserves negative height, unsigned states, biomes and fluids', () => {
    const chunk = new VanillaChunk(-1, -1);
    chunk.setBlock(15, -64, 15, 0xf0000000);
    chunk.setBlock(15, 319, 15, 35722);
    chunk.setBiome(15, -64, 15, 66);
    chunk.heightmap[255] = 320;
    chunk.fluidUpdates = new Uint8Array(chunk.blocks.length);
    chunk.fluidUpdates[chunk.index(15, -64, 15)] = 1;
    const outgoing = { chunks: [chunk.serialize()] };
    const incoming = structuredClone(outgoing, { transfer: chunkTransferList(outgoing) });
    assert.equal(chunk.blocks.byteLength, 0);
    const store = new VanillaChunkStore();
    store.setBatch(incoming.chunks);
    assert.equal(store.getBlockState(-1, -64, -1), 0xf0000000);
    assert.equal(store.getBlockState(-1, 319, -1), 35722);
    assert.equal(store.getBlockState(-1, 320, -1), undefined);
    assert.equal(store.getBlockState(0, 0, 0), undefined);
    assert.equal(store.getChunk(-1, -1).biomes[3 * 4 + 3], 66);
    assert.equal(store.getChunk(-1, -1).heightmap[255], 320);
    incoming.chunks[0].blocks.fill(0);
    assert.equal(store.getBlockState(-1, 319, -1), 35722);
});

test('store rejects malformed batch atomically and does not collide distant coordinates', () => {
    const store = new VanillaChunkStore();
    const first = new VanillaChunk(65536, 0).serialize();
    const second = new VanillaChunk(0, 1).serialize();
    store.setBatch([first, second]);
    assert.equal(store.chunks.size, 2);
    const broken = { ...new VanillaChunk(1, 1).serialize(), blocks: new Uint16Array(1) };
    assert.throws(() => store.setBatch([new VanillaChunk(2, 2).serialize(), broken]), /Malformed/);
    assert.equal(store.getChunk(2, 2), undefined);
    assert.throws(() => readVanillaChunk({ ...first, format: 'old' }), /Unknown/);
    assert.throws(() => readVanillaChunk({ ...first, height: 2147483648 }), /bounds/);
});

test('real WASM service generates modern terrain and survives transferable cache replies', async () => {
    const assets = await inputs();
    const service = await createChunkService({ ...assets, maxCachedChunks: 1 });
    try {
        const request = { seed: '-9223372036854775808', coords: [[-1, 0]] };
        const first = service.generate(request);
        assert.equal(first.playable, false);
        assert.ok(first.pendingStages.includes('decoration'));
        assert.equal(first.chunks[0].minY, -64);
        assert.equal(first.chunks[0].height, 384);
        assert.equal(first.biomeNames.length, 65);
        assert.ok(!first.biomeNames.includes('minecraft:pale_garden'));
        assert.ok(!first.biomeNames.includes('minecraft:sulfur_caves'));
        const transferred = structuredClone(first, { transfer: chunkTransferList(first) });
        const repeated = service.generate(request);
        assert.deepEqual(repeated.chunks[0], transferred.chunks[0]);
        assert.ok(new Set(repeated.chunks[0].blocks).size > 4, 'material rules must be applied');
        const end = service.generate({ seed: '1', settings: 'end', coords: [[0, 0]] });
        assert.equal(end.chunks[0].minY, 0);
        assert.equal(end.chunks[0].height, 128);
        assert.equal(end.chunks[0].fluidUpdates, undefined);
        const nether = service.generate({ seed: '1', settings: 'nether', coords: [[-1, 0]] });
        assert.equal(nether.chunks[0].height, 128);
        assert.ok(nether.chunks[0].fluidUpdates instanceof Uint8Array);
        const restored = service.generate(request);
        assert.deepEqual(restored.chunks[0], transferred.chunks[0]);
        assert.throws(() => service.generate({ seed: '1', coords: [] }), /1..4/);
        assert.throws(() => service.generate({ seed: '1', coords: [[0, NaN]] }), /1..4/);
        assert.throws(() => service.generate({ seed: 9007199254740992, coords: [[0, 0]] }), /64-bit/);
        assert.throws(() => service.generate({ seed: '1', settings: 'flat', coords: [[0, 0]] }), /Unknown/);
    } finally { service.dispose(); }
    assert.throws(() => service.generate({ seed: '1', coords: [[0, 0]] }), /disposed/);
    await assert.rejects(createChunkService({ ...assets, registry: { ...assets.registry, source: { version: '26.3', sha256: 'wrong' } } }), /registry/);
});

test('cached quart biomes and batched material-density prototype preserve terrain payloads', { timeout: 90000 }, async () => {
    const assets = await inputs();
    assets.stateRules = JSON.parse(await readFile(new URL('../generated/block-rules.json', import.meta.url)));
    const direct = await createChunkService({ ...assets, cacheSurfaceBiomeSamples: false });
    const cached = await createChunkService(assets);
    const batched = await createChunkService({ ...assets, batchMaterialDensitySampling: true });
    try {
        const request = { seed: '1', coords: [[0, 0]] };
        const expected = direct.generate(request).chunks[0];
        for (const service of [cached, batched]) {
            const actual = service.generate(request).chunks[0];
            assert.deepEqual(actual.blocks, expected.blocks);
            assert.deepEqual(actual.biomes, expected.biomes);
            assert.deepEqual(actual.heightmap, expected.heightmap);
            assert.deepEqual(actual.fluidUpdates, expected.fluidUpdates);
        }
    } finally { direct.dispose(); cached.dispose(); batched.dispose(); }
});

test('opt-in scalar memo and density point batches preserve complete terrain payloads', { timeout: 90000 }, async () => {
    const assets = await inputs();
    const options = [
        {},
        { experimentalScalarMemoReuse: true },
        { experimentalBatchDensityQueries: true },
        { experimentalScalarMemoReuse: true, experimentalBatchDensityQueries: true }
    ];
    const services = await Promise.all(options.map(option => createChunkService({ ...assets, ...option })));
    try {
        const request = { seed: '6888349110149677383', coords: [[-1, 0]] };
        const expected = services[0].generate(request).chunks[0];
        for (const service of services.slice(1)) {
            const actual = service.generate(request).chunks[0];
            for (const field of ['blocks', 'biomes', 'heightmap', 'fluidUpdates']) assert.deepEqual(actual[field], expected[field], field);
        }
    } finally { services.forEach(service => service.dispose()); }
});

test('opt-in carver stage is applied once and survives cached chunk reads', { timeout: 120000 }, async () => {
    const assets = await inputs();
    assets.stateRules = JSON.parse(await readFile(new URL('../generated/block-rules.json', import.meta.url)));
    const service = await createChunkService({ ...assets, enableCarvers: true, maxCachedChunks: 1 });
    const baseline = await createChunkService(assets);
    try {
        const request = { seed: '1', coords: [[0, 0]] };
        const first = service.generate(request);
        const uncarved = baseline.generate(request).chunks[0];
        assert.ok(first.stages.includes('carvers'));
        assert.ok(!first.pendingStages.includes('carvers'));
        assert.ok(first.chunks[0].blocks.some((state, index) => state !== uncarved.blocks[index]), 'carver stage must modify terrain');
        const second = service.generate(request);
        for (const field of ['blocks', 'biomes', 'heightmap', 'fluidUpdates']) assert.deepEqual(second.chunks[0][field], first.chunks[0][field], field);
    } finally { service.dispose(); baseline.dispose(); }
});
