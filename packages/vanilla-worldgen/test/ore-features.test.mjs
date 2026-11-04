import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVanillaKernel } from '../runtime.mjs';
import { createConfiguredFeaturePlacer } from '../features.mjs';
import { testOreRule, canPlaceOre } from '../ore-features.mjs';
import { runFeatureFixture } from './feature-fixtures.mjs';
import { STRUCTURE_FEATURE_MODES } from './structure-feature-fixtures.mjs';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));
const stone = { name: 'minecraft:stone', properties: {} };
const pos = { x: 0, y: 20, z: 0 };
const rule = { predicate_type: 'minecraft:block_match', block: 'minecraft:stone' };

test('ore rules use the actual 26.3 rules/rule fields and inclusive height limits', () => {
    const nested = { predicate_type: 'minecraft:all_of', rules: [rule,
        { predicate_type: 'minecraft:height_match', min_inclusive: 0, max_inclusive: 20 },
        { predicate_type: 'minecraft:not', rule: { predicate_type: 'minecraft:block_match', block: 'minecraft:dirt' } }
    ] };
    assert.equal(testOreRule(nested, stone, pos, {}, {}), true);
    assert.equal(testOreRule(nested, stone, { ...pos, y: 21 }, {}, {}), false);
    assert.equal(testOreRule({ predicate_type: 'minecraft:any_of', rules: [] }, stone, pos, {}, {}), false);
    assert.equal(testOreRule({ predicate_type: 'minecraft:all_of', rules: [] }, stone, pos, {}, {}), true);
});

test('ore target failure consumes no air-discard RNG, and exposure checks retain vanilla short circuits', () => {
    const calls = [], random = { nextFloat: () => { calls.push('random'); return 0.6; } };
    const context = { isAir: p => { calls.push([p.x, p.y, p.z]); return p.y === 21; } };
    const target = { target: rule };
    assert.equal(canPlaceOre(target, { name: 'minecraft:dirt' }, pos, 0.5, random, context), false);
    assert.deepEqual(calls, []);
    assert.equal(canPlaceOre(target, stone, pos, 0, random, context), true);
    assert.deepEqual(calls, []);
    assert.equal(canPlaceOre(target, stone, pos, 0.5, random, context), true);
    assert.deepEqual(calls, ['random']);
    calls.length = 0;
    assert.equal(canPlaceOre(target, stone, pos, 1, random, context), false);
    assert.deepEqual(calls, [[0, 19, 0], [0, 21, 0]]);
});

test('all 30 imported ore configs resolve nested tag and height rule tests', () => {
    const context = { isBlockInTag: (state, tag) => tag.includes('stone_ore') && state.name === 'minecraft:stone' };
    const ores = Object.values(data).filter(feature => feature?.type === 'minecraft:ore');
    assert.equal(ores.length, 30);
    for (const feature of ores) for (const target of feature.targets) for (const y of [-64, 0, 8, 20]) {
        assert.equal(typeof testOreRule(target.target, stone, { ...pos, y }, {}, context), 'boolean');
    }
});

test('scattered ore draws all six coordinates at span zero and returns success with zero targets placed', () => {
    let floats = 0;
    const place = createConfiguredFeaturePlacer({}, { stateIdFor: () => 1, canSurvive: () => true, setBlock: () => assert.fail('No targets should place') });
    const feature = { type: 'minecraft:scattered_ore', size: 1, targets: [] };
    assert.equal(place('<test>', feature, pos, { nextInt: () => 1, nextFloat: () => { floats++; return 0; } }, { getBlockState: () => stone }), true);
    assert.equal(floats, 6);
});

test('ore height gate rejects before sphere-radius draws and section access', () => {
    let ints = 0, heights = 0;
    const place = createConfiguredFeaturePlacer({}, { stateIdFor: () => 1, canSurvive: () => true, setBlock: () => assert.fail('Ore must not use world writes') });
    const result = place('<test>', { type: 'minecraft:ore', size: 4, targets: [] }, pos, {
        nextFloat: () => 0, nextInt: () => { ints++; return 0; }, nextDouble: () => assert.fail('No radius draws above heightmap')
    }, { getBlockState: () => stone, getHeight: () => { heights++; return -64; } });
    assert.equal(result, false);
    assert.equal(ints, 2);
    assert.equal(heights, 25);
});

test('ore direct section writes are explicit and cannot silently fall back to normal block updates', () => {
    const place = createConfiguredFeaturePlacer({}, { stateIdFor: () => 1, canSurvive: () => true, setBlock: () => assert.fail('Normal updates forbidden') });
    assert.throws(() => place('<test>', { type: 'minecraft:ore', size: 4, targets: [] }, pos,
        { nextFloat: () => 0, nextInt: () => 0, nextDouble: () => 0.5 }, { minY: 0, maxY: 64, getBlockState: () => stone, getHeight: () => 64 }), /context.ensureCanWrite/);
});

test('terrain, ore, environment, lake and tree placements match original 26.3 JAR ordered writes and RNG continuation', async () => {
    const fixture = JSON.parse(await readFile(new URL('../generated/feature-oracle.json', import.meta.url), 'utf8'));
    const lock = JSON.parse(await readFile(new URL('../source-lock.json', import.meta.url), 'utf8'));
    assert.equal(fixture.sourceSha256, lock.sha256);
    assert.equal(fixture.cases.length, 748 + STRUCTURE_FEATURE_MODES.length * 6);
    const kernel = await createVanillaKernel(await readFile(new URL('../generated/worldgen.wasm', import.meta.url)), JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url), 'utf8')));
    try {
        for (const entry of fixture.cases) {
            const random = kernel.random(entry.seed);
            try {
                assert.deepEqual(runFeatureFixture(entry.mode, random, entry.seed), { succeeded: entry.succeeded, writes: entry.writes, marks: entry.marks, ticks: entry.ticks, destroyed: entry.destroyed, gatewayExits: entry.gatewayExits, effects: entry.effects, nextLong: entry.nextLong }, `${entry.mode}, seed=${entry.seed}`);
            } finally { random.dispose(); }
        }
    } finally { kernel.dispose(); }
});
