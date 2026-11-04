import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorldgenFeatureRegistry } from '../feature-resources.mjs';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));

test('all imported 26.3 placed features resolve to configured feature data in order', () => {
    const registry = createWorldgenFeatureRegistry(data);
    assert.deepEqual(registry.validatePlacedFeatures(), { features: 240, placedFeatures: 273 });
    const flower = registry.getPlacedFeature('minecraft:flower_default');
    assert.equal(flower.feature.type, 'minecraft:simple_block');
    assert.deepEqual(flower.placement.map(modifier => modifier.type), [
        'minecraft:rarity_filter',
        'minecraft:in_square',
        'minecraft:heightmap',
        'minecraft:biome',
        'minecraft:count',
        'minecraft:offset',
        'minecraft:block_predicate_filter'
    ]);
    assert.throws(() => registry.getPlacedFeature('minecraft:missing'), /Missing vanilla placed-feature/);
    assert.throws(() => registry.getPlacedFeature('other:oak'), /Unsupported worldgen namespace/);
});
