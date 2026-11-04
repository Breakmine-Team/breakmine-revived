import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectDecorationBiomes, createBiomeFeatureSorter, decorateVanillaChunk, getDecorationSeed } from '../biome-decoration.mjs';

const vanilla = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));

function stubKernel(values = [3n, 5n]) {
    const seeds = [];
    return {
        seeds,
        random(seed) {
            seeds.push(BigInt(seed));
            const draws = [...values];
            return { nextLong: () => draws.shift(), nextInt: bound => Math.min(0, bound - 1), dispose() {} };
        }
    };
}

test('26.3 feature sorter covers all biomes and keeps duplicate placed features in their separate steps', () => {
    const biomeOrder = Object.keys(vanilla)
        .filter(path => path.startsWith('data/minecraft/worldgen/biome/'))
        .map(path => `minecraft:${path.split('/').at(-1).slice(0, -5)}`);
    const sorter = createBiomeFeatureSorter(vanilla, biomeOrder);
    assert.equal(sorter.biomeOrder.length, 67);
    assert.equal(sorter.featureCount, 211);
    assert.equal(sorter.stages.length, 11);
    assert.deepEqual(sorter.droppedBiomes, []);
    assert.ok(sorter.stages[8].includes('minecraft:spring_lava'));
    assert.ok(sorter.stages[9].includes('minecraft:spring_lava'));

    for (const biomeId of biomeOrder) {
        const resource = vanilla[`data/minecraft/worldgen/biome/${biomeId.slice('minecraft:'.length)}.json`];
        for (let step = 0; step < resource.features.length; step++) {
            const expected = resource.features[step];
            const actual = sorter.stages[step].filter(name => sorter.featuresForBiomeStep(biomeId, step).has(name));
            assert.deepEqual(actual, [...new Set(expected)], `${biomeId} generation step ${step}`);
        }
    }
});

test('decoration seed uses signed 64-bit wrap and odd Java long multipliers', () => {
    const kernel = stubKernel([-8n, 12n]);
    assert.equal(getDecorationSeed(kernel, -99n, 32, -48), BigInt.asIntN(64, (32n * -7n + -48n * 13n) ^ -99n));
    assert.deepEqual(kernel.seeds, [-99n]);
});

test('decoration biome collection uses the complete 3 by 3 chunk neighborhood', () => {
    const chunks = [];
    const biomes = collectDecorationBiomes(4, -2, (x, z) => {
        chunks.push([x, z]);
        return [`minecraft:${x}:${z}`, 'minecraft:plains'];
    });
    assert.equal(chunks.length, 9);
    assert.deepEqual(chunks[0], [3, -3]);
    assert.deepEqual(chunks.at(-1), [5, -1]);
    assert.equal(biomes.length, 10);
    assert.ok(biomes.includes('minecraft:plains'));
});

test('chunk decoration unions observed biomes, follows sorted stage order and seeds each feature index', () => {
    const data = {
        'data/minecraft/worldgen/biome/a.json': { features: [['minecraft:a', 'minecraft:b'], ['minecraft:c']] },
        'data/minecraft/worldgen/biome/b.json': { features: [['minecraft:a', 'minecraft:b']] },
        'data/minecraft/worldgen/placed_feature/a.json': { feature: 'minecraft:a', placement: [] },
        'data/minecraft/worldgen/placed_feature/b.json': { feature: 'minecraft:b', placement: [] },
        'data/minecraft/worldgen/placed_feature/c.json': { feature: 'minecraft:c', placement: [] },
        'data/minecraft/worldgen/feature/a.json': { type: 'minecraft:test' },
        'data/minecraft/worldgen/feature/b.json': { type: 'minecraft:test' },
        'data/minecraft/worldgen/feature/c.json': { type: 'minecraft:test' }
    };
    const sorter = createBiomeFeatureSorter(data, ['minecraft:a', 'minecraft:b']);
    const kernel = stubKernel([7n, 9n]);
    const placed = [];
    const result = decorateVanillaChunk({
        kernel, worldSeed: 41n, chunkX: 2, chunkZ: -3,
        neighborBiomeIds: ['minecraft:a', 'minecraft:b', 'minecraft:a'],
        sorter,
        featureRegistry: { getPlacedFeature(id) {
            return { name: id, featureName: id, feature: { type: 'minecraft:test' }, placement: [] };
        } },
        context: { minY: -64 },
        biomeAtBlock: () => 'minecraft:a',
        placeFeature(name) { placed.push(name); return true; }
    });
    assert.deepEqual(placed, ['minecraft:a', 'minecraft:b', 'minecraft:c']);
    assert.deepEqual(result.results.map(({ step, id }) => [step, id]), [
        [0, 'minecraft:a'], [0, 'minecraft:b'], [1, 'minecraft:c']
    ]);
    assert.deepEqual(result.origin, { x: 32, y: -64, z: -48 });
    assert.deepEqual(kernel.seeds.slice(1), result.results.map(({ step, index }) =>
        BigInt.asIntN(64, result.decorationSeed + BigInt(index) + BigInt(Math.imul(step, 10000)))));
});
