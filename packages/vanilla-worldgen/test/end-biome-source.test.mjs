import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEndBiomeSource, createSeededEndBiomeSource, END_BIOMES } from '../end-biome-source.mjs';

test('End center biome uses section coordinates and includes the radius boundary', () => {
    let calls = 0;
    const source = createEndBiomeSource(() => { calls++; return 1; });
    assert.equal(source.biomeAtQuart(256, -4, 0), END_BIOMES.center);
    assert.equal(source.biomeAtQuart(260, 80, 0), END_BIOMES.highlands);
    assert.equal(source.biomeAtQuart(256, -4, 0), END_BIOMES.center);
    assert.equal(calls, 1);
});

test('End outer biome erosion thresholds preserve the JAR boundary comparisons', () => {
    const source = createEndBiomeSource((_x, _y, _z) => 0);
    assert.equal(createEndBiomeSource(() => 0.250001).biomeAtQuart(260, 0, 0), END_BIOMES.highlands);
    assert.equal(createEndBiomeSource(() => 0.25).biomeAtQuart(260, 0, 0), END_BIOMES.midlands);
    assert.equal(createEndBiomeSource(() => -0.0625).biomeAtQuart(260, 0, 0), END_BIOMES.midlands);
    assert.equal(createEndBiomeSource(() => -0.062501).biomeAtQuart(260, 0, 0), END_BIOMES.barrens);
    assert.equal(createEndBiomeSource(() => -0.21875).biomeAtQuart(260, 0, 0), END_BIOMES.barrens);
    assert.equal(createEndBiomeSource(() => -0.218751).biomeAtQuart(260, 0, 0), END_BIOMES.islands);
    assert.equal(source.biomes.length, 5);
});

test('End biome source samples erosion at section centers and quart Y in blocks', () => {
    const positions = [];
    const source = createEndBiomeSource((...position) => { positions.push(position); return 0; });
    assert.equal(source.biomeAtQuart(260, -17, -257), END_BIOMES.midlands);
    assert.deepEqual(positions, [[1048, -68, -1032]]);
});

test('End biome source rejects invalid sampler results and coordinates', () => {
    assert.throws(() => createEndBiomeSource(null), TypeError);
    assert.throws(() => createEndBiomeSource(() => 0).biomeAtQuart(536870912, 0, 0), RangeError);
    assert.throws(() => createEndBiomeSource(() => NaN).biomeAtQuart(260, 0, 0), TypeError);
    assert.throws(() => createEndBiomeSource(() => 0, { ...END_BIOMES, islands: null }), TypeError);
});

test('seeded End biome source wires the JAR End island sampler into biome selection', () => {
    const source = createSeededEndBiomeSource('123456789');
    assert.equal(source.biomeAtQuart(256, 0, 0), END_BIOMES.center);
    assert.ok(source.biomes.includes(source.biomeAtQuart(260, 0, 0)));
});
