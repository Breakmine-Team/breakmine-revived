import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVanillaKernel, parseSeed } from '../runtime.mjs';
import { VanillaChunk } from '../chunk.mjs';
import { createNoiseRegistry } from '../noise-registry.mjs';
import { assertWorldGeneratorReady, summarizeVanillaWorldgenError } from '../../../src/js/net/minecraft/client/world/generator/VanillaWorldgenStatus.js';

const bytes = await readFile(new URL('../generated/worldgen.wasm', import.meta.url));
const climate = JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url)));
const manifest = JSON.parse(await readFile(new URL('../generated/manifest.json', import.meta.url)));

test('terrain HUD summarizes long render-mapping failures without losing logged details', () => {
    const message = 'Unsupported render mappings for vanilla states: 5562 (minecraft:chest), 5444 (minecraft:spawner), 3344 (minecraft:furnace), 22 (minecraft:barrel), 23 (minecraft:hopper)';
    assert.equal(summarizeVanillaWorldgenError(new Error(message)), '5 block render mappings missing: chest, spawner, furnace + 2 more');
    assert.equal(summarizeVanillaWorldgenError(new Error('Feature placement failed')), 'Feature placement failed');
});

test('kernel refuses climate data from a different JAR', async () => {
    await assert.rejects(createVanillaKernel(bytes, { ...climate, source: { version: '26.2' } }), /pinned 26.3 JAR/);
});

test('64-bit seeds survive the JS/WASM boundary without rounding', async () => {
    const kernel = await createVanillaKernel(bytes, climate);
    try {
        const left = kernel.random('9007199254740992');
        const right = kernel.random('9007199254740993');
        assert.notEqual(left.nextLong(), right.nextLong());
        assert.equal(parseSeed('-9223372036854775808'), -(1n << 63n));
        assert.throws(() => parseSeed(9007199254740992), RangeError);
        assert.throws(() => parseSeed('9223372036854775808'), RangeError);
        assert.throws(() => left.nextInt(0), RangeError);
    } finally { kernel.dispose(); }
});

test('WASM instances and handles do not share generator state', async () => {
    const a = await createVanillaKernel(bytes, climate);
    const b = await createVanillaKernel(bytes, climate);
    try {
        const r1 = a.random('-1');
        const r2 = b.random('-1');
        for (let i=0; i<20; i++) assert.equal(r1.nextLong(), r2.nextLong());
        const noise = a.perlin(0);
        assert.ok(Number.isFinite(noise.sample(-15.5, -64, 319)));
        noise.dispose();
        assert.throws(() => noise.sample(0,0,0), /disposed/);
        a.dispose();
        assert.throws(() => r1.nextLong(), /disposed/);
        assert.equal(typeof r2.nextLong(), 'bigint');
    } finally { a.dispose(); b.dispose(); }
});

test('climate lookup uses all exported presets and rejects unknown dimensions', async () => {
    const kernel = await createVanillaKernel(bytes, climate);
    try {
        assert.equal(manifest.registries.biome.length, 67);
        assert.equal(kernel.climate('overworld').biomes.length, 56);
        assert.equal(kernel.climate('nether').biomes.length, 5);
        const biome = kernel.climate('overworld').sample(0.2, 0.5, 0.3, -0.1, 0, 0.4);
        assert.ok(manifest.registries.biome.includes(biome));
        assert.throws(() => kernel.climate('end'), /No multi-noise preset/);
        assert.equal(kernel.capabilities.chunks, false);
        assert.throws(() => kernel.generateChunk(0,0), /not implemented/);
        assert.throws(() => assertWorldGeneratorReady('vanilla_26_3'), /in development/);
        assert.doesNotThrow(() => assertWorldGeneratorReady('normal'));
    } finally { kernel.dispose(); }
});

test('filtered overworld preset removes Pale Garden and Sulfur Caves without leaving dead branches', async () => {
    const kernel = await createVanillaKernel(bytes, climate);
    try {
        const excludedBiomes = ['minecraft:pale_garden', 'minecraft:sulfur_caves'];
        const source = kernel.climate('overworld');
        const filtered = kernel.climate('overworld', { excludeBiomes: excludedBiomes });
        assert.equal(filtered.biomes.length, source.biomes.length - 2);
        for (const biome of excludedBiomes) assert.ok(!filtered.biomes.includes(biome));
        for (const node of climate.presets.overworld.nodes.filter(node => node.biome >= 0 && excludedBiomes.includes(climate.presets.overworld.biomes[node.biome]))) {
            assert.ok(!filtered.biomes.includes(climate.presets.overworld.biomes[node.biome]));
        }
        for (let t = -4; t <= 4; t++) for (let h = -4; h <= 4; h++) for (let c = -3; c <= 3; c++) {
            const result = filtered.sample(t / 4, h / 4, c / 4, (t - c) / 6, 0, (h + c) / 7);
            assert.ok(!excludedBiomes.includes(result), `excluded biome sampled: ${result}`);
        }
        assert.equal(kernel.climate('nether', { excludeBiomes: excludedBiomes }).biomes.length, 5);
        filtered.dispose(); source.dispose();
    } finally { kernel.dispose(); }
});

test('chunk transport retains negative Y, high state IDs and underground biomes', () => {
    const chunk = new VanillaChunk(-1, -7);
    chunk.setBlock(0,-64,0,100000);
    chunk.setBlock(15,319,15,0xffffffff);
    chunk.setBiome(0,-64,0,55);
    chunk.setBiome(0,64,0,3);
    const packet = chunk.serialize();
    const restored = structuredClone(packet, { transfer: [packet.blocks.buffer,packet.biomes.buffer,packet.heightmap.buffer] });
    assert.equal(restored.blocks[0],100000);
    assert.equal(restored.blocks.at(-1),0xffffffff);
    assert.equal(restored.biomes[0],55);
    assert.equal(restored.biomes[32 * 16],3);
    assert.equal(restored.minY,-64);
    assert.equal(restored.height,384);
    assert.throws(() => new VanillaChunk(0,0).getBlock(0,320,0), RangeError);
});

test('positional factories have independent, repeatable child streams', async () => {
    const kernel = await createVanillaKernel(bytes, climate);
    try {
        const root = kernel.random(-1);
        const factory = root.forkPositional();
        root.dispose();
        for (const make of [() => factory.at(-30000000,-64,30000000), () => factory.fromHashOf('Монгол 🌍'), () => factory.fromSeed('-9223372036854775808')]) {
            const a = make(), b = make();
            for (let i=0; i<32; i++) assert.equal(a.nextLong(), b.nextLong());
            a.dispose(); b.dispose();
        }
        assert.throws(() => factory.at(2147483648,0,0), RangeError);
        assert.throws(() => factory.at(1.5,0,0), RangeError);
        assert.throws(() => factory.fromHashOf('\ud800'), TypeError);
        const surviving = factory.fromHashOf('octave_-5');
        factory.dispose();
        assert.throws(() => factory.fromHashOf('octave_-5'), /disposed/);
        assert.equal(typeof surviving.nextLong(), 'bigint');
        kernel.dispose();
        assert.throws(() => surviving.nextLong(), /disposed/);
    } finally { kernel.dispose(); }
});

test('normal noise validates JAR parameters and owns its sampler after source disposal', async () => {
    const kernel = await createVanillaKernel(bytes, climate);
    try {
        const random = kernel.random(0);
        const parameters = { base_octave: -10, octave_count: 4, amplitude_modifiers: [1,0,0.125,2] };
        const noise = random.normalNoise(parameters);
        const empty = random.normalNoise({ ...parameters, amplitude_modifiers: [0,0,0,0] });
        assert.equal(empty.sample(-1,-64,30000000), 0);
        for (const invalid of [{ base_octave: 33 }, { octave_count: 0 }, { normalize: 'bad' }, { amplitude_modifiers: [1] }, { amplitude_modifiers: [1,1,NaN,1] }, { base_amplitude: Infinity }]) {
            assert.throws(() => random.normalNoise({ ...parameters, ...invalid }));
        }
        const expected = noise.sample(123,-64,456);
        random.dispose();
        assert.equal(noise.sample(123,-64,456), expected);
        assert.throws(() => noise.sample(Infinity,0,0), RangeError);
        noise.dispose(); noise.dispose();
        assert.throws(() => noise.sample(0,0,0), /disposed/);
    } finally { kernel.dispose(); }
});

test('named noises are order independent and never substitute a missing definition', async () => {
    const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url)));
    const kernel = await createVanillaKernel(bytes, climate);
    const first = createNoiseRegistry(kernel, '9007199254740993', data);
    const second = createNoiseRegistry(kernel, '9007199254740993', data);
    try {
        const ids = [...manifest.registries.noise];
        const expected = new Map(ids.map(id => [id, first.sample(id, -1500.25, -64, 397.5)]));
        for (const id of ids.reverse()) assert.equal(second.sample(id, -1500.25, -64, 397.5), expected.get(id));
        assert.throws(() => first.sample('minecraft:missing',0,0,0), /Missing noise/);
        first.dispose();
        assert.throws(() => first.sample(ids[0],0,0,0), /disposed/);
    } finally { first.dispose(); second.dispose(); kernel.dispose(); }
});
