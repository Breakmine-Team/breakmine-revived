import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfiguredFeaturePlacer, createBlockStateProviderSampler } from '../features.mjs';
import { createBlockPredicateTester, manhattanPositions } from '../feature-world.mjs';

const origin = { x: 0, y: 10, z: 0 };
const fixedRandom = { nextInt: () => 0, nextFloat: () => 0, nextBoolean: () => false };
const state = (name, properties = {}) => ({ name: `minecraft:${name}`, properties });
function fixture(context = {}) {
    const writes = [], blocks = new Map();
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    const world = {
        minY: 0, maxY: 64,
        getBlockState: pos => blocks.get(key(pos)) ?? state('air'),
        isAir: pos => world.getBlockState(pos).name === 'minecraft:air',
        ...context
    };
    const place = createConfiguredFeaturePlacer({}, {
        stateIdFor: () => 1, canSurvive: () => true,
        setBlock(value, pos, flags) { blocks.set(key(pos), value); writes.push({ value, pos, flags }); }
    });
    return { world, writes, place: (feature, random = fixedRandom, pos = origin) => place('<test>', feature, pos, random, world) };
}

test('block columns probe one block ahead and trim base versus tip without extra provider draws', () => {
    for (const prioritize_tip of [false, true]) {
        const probes = [];
        const f = fixture({ testBlockPredicate: (_predicate, pos) => { probes.push(pos.y); return pos.y < 13; } });
        assert.equal(f.place({ type: 'minecraft:block_column', direction: 'up', allowed_placement: {}, prioritize_tip,
            layers: [{ height: 3, provider: { id: 'minecraft:cactus' } }, { height: 1, provider: { id: 'minecraft:cactus_flower' } }] }), true);
        assert.deepEqual(probes, [11, 12, 13]);
        assert.deepEqual(f.writes.map(w => [w.pos.y, w.value.name]), prioritize_tip
            ? [[10, 'minecraft:cactus'], [11, 'minecraft:cactus_flower']]
            : [[10, 'minecraft:cactus'], [11, 'minecraft:cactus']]);
    }
});

test('block columns retain vanilla success semantics for empty and completely obstructed columns', () => {
    const f = fixture({ testBlockPredicate: () => false });
    const feature = { type: 'minecraft:block_column', direction: 'down', allowed_placement: {}, layers: [{ height: 2, provider: { id: 'minecraft:stone' } }] };
    assert.equal(f.place(feature), true);
    assert.equal(f.writes.length, 0);
    assert.equal(f.place({ ...feature, layers: [{ ...feature.layers[0], height: 0 }] }), false);
});

test('disk scans top down, samples optional states and marks two non-air blocks above each new run', () => {
    const marks = [];
    const f = fixture({
        getBlockState: () => state('dirt'), isAir: () => false,
        markPosForPostProcessing: pos => marks.push(pos.y)
    });
    assert.equal(f.place({ type: 'minecraft:disk', radius: 0, half_height: 1,
        target: { type: 'minecraft:matching_blocks', blocks: 'minecraft:dirt' }, state_provider: { id: 'minecraft:clay' } }), true);
    assert.deepEqual(f.writes.map(w => w.pos.y), [11, 10, 9]);
    assert.deepEqual(marks, [12, 13]);
    const nullProvider = { type: 'minecraft:rule_based', rules: [] };
    assert.equal(f.place({ type: 'minecraft:disk', radius: 0, half_height: 0, target: { type: 'minecraft:true' }, state_provider: nullProvider }), false);
});

test('disk optional null states preserve the previous run marker and never become air writes', () => {
    const marks = [];
    const f = fixture({ isAir: () => false, testBlockPredicate: (predicate, pos) => predicate.allow ?? pos.y !== 10,
        markPosForPostProcessing: pos => marks.push(pos.y) });
    assert.equal(f.place({ type: 'minecraft:disk', radius: 0, half_height: 1, target: { allow: true }, state_provider: {
        type: 'minecraft:rule_based', rules: [{ if_true: {}, then: { id: 'minecraft:clay' } }]
    } }), true);
    assert.deepEqual(f.writes.map(w => w.pos.y), [11, 9]);
    assert.deepEqual(marks, [12, 13]);
});

test('block piles reject low origins before consuming RNG and keep their vanilla empty success', () => {
    const f = fixture();
    assert.equal(f.place({ type: 'minecraft:block_pile' }, { nextInt: () => assert.fail('Low pile consumes no RNG') }, { x: 0, y: 4, z: 0 }), false);
    const empty = fixture({ isAir: () => false });
    assert.equal(empty.place({ type: 'minecraft:block_pile', state_provider: { id: 'minecraft:stone' } }), true);
    assert.equal(empty.writes.length, 0);
});

test('forest blobs descend to predicate support and write three lobes with update flags', () => {
    const f = fixture({ testBlockPredicate: (_p, pos) => pos.y === 8 });
    assert.equal(f.place({ type: 'minecraft:block_blob', can_place_on: {}, state: 'minecraft:mossy_cobblestone' }), true);
    assert.deepEqual(f.writes.map(w => [w.pos, w.flags]), [
        [{ x: 0, y: 9, z: 0 }, 3], [{ x: -1, y: 9, z: -1 }, 3], [{ x: -2, y: 9, z: -2 }, 3]
    ]);
});

test('replacement blobs use the depth-ordered positive/negative Z mirrored Manhattan iterator', () => {
    assert.deepEqual([...manhattanPositions({ x: 0, y: 0, z: 0 }, 1, 1, 1, 1)], [
        { x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }
    ]);
    const f = fixture({ getBlockState: () => state('netherrack') });
    assert.equal(f.place({ type: 'minecraft:netherrack_replace_blobs', radius: 1, target: 'minecraft:netherrack', state: 'minecraft:magma_block' }), true);
    assert.equal(f.writes.length, 7);
});

test('spring checks five rocks/holes and places the fluid legacy state before scheduling an immediate tick', () => {
    const ticks = [];
    const f = fixture({ getBlockState: pos => pos.x === 1 ? state('air') : state('stone'), isAir: pos => pos.x === 1,
        scheduleFluidTick: (fluid, pos, delay) => ticks.push([fluid.id, pos, delay]) });
    assert.equal(f.place({ type: 'minecraft:spring_feature', valid_blocks: ['minecraft:stone'], state: { id: 'minecraft:water', properties: { falling: 'true' } } }), true);
    assert.deepEqual(f.writes[0].value.properties, { level: '0' });
    assert.deepEqual(ticks, [['minecraft:water', origin, 0]]);
    assert.equal(f.place({ type: 'minecraft:spring_feature', valid_blocks: ['minecraft:stone'], state: { id: 'minecraft:water' }, hole_count: 2 }), false);
});

test('vines select the first acceptable UP/NORTH/SOUTH/WEST/EAST face only', () => {
    const checked = [];
    const f = fixture({ isAcceptableVineNeighbour: (_pos, direction) => { checked.push(direction); return direction === 'south'; } });
    assert.equal(f.place({ type: 'minecraft:vines' }), true);
    assert.deepEqual(checked, ['up', 'north', 'south']);
    assert.deepEqual(f.writes[0].value.properties, { up: 'false', north: 'false', south: 'true', west: 'false', east: 'false' });
});

test('neighbor spread writes its origin even when no attempts follow', () => {
    const f = fixture();
    assert.equal(f.place({ type: 'minecraft:random_neighbor_spread', block: { id: 'minecraft:glowstone' }, attempts: 0 }), true);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value.name, 'minecraft:glowstone');
});

test('End islands shrink by the JAR half-step draws and retain X/Z order and update flags', () => {
    const bounds = [], f = fixture();
    assert.equal(f.place({ type: 'minecraft:end_island' }, { nextInt: bound => { bounds.push(bound); return 0; } }), true);
    assert.deepEqual(bounds, [3, 2, 2, 2, 2, 2, 2, 2]);
    assert.deepEqual(f.writes[0].pos, { x: -4, y: 10, z: -3 });
    assert.equal(Math.min(...f.writes.map(w => w.pos.y)), 4);
    assert.ok(f.writes.every(w => w.flags === 3 && w.value.name === 'minecraft:end_stone'));
});

test('single-block replacement uses the first matching rule and succeeds even when nothing matches', () => {
    const f = fixture({ getBlockState: () => state('stone') });
    const targets = ['dirt', 'stone', 'stone'].map((name, index) => ({
        target: { predicate_type: 'minecraft:block_match', block: `minecraft:${name}` }, state: index === 1 ? 'minecraft:diamond_ore' : 'minecraft:gold_ore'
    }));
    assert.equal(f.place({ type: 'minecraft:replace_single_block', targets }), true);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value.name, 'minecraft:diamond_ore');
    assert.equal(f.place({ type: 'minecraft:replace_single_block', targets: [targets[0]] }), true);
    assert.equal(f.writes.length, 1);
});

test('freeze-top-layer visits 256 columns in X/Z order, freezes first, then snow and snowy soil', () => {
    const heights = [], decisions = [];
    const f = fixture({
        getHeight: (type, x, z) => { assert.equal(type, 'MOTION_BLOCKING'); heights.push([x, z]); return 11; },
        shouldFreeze: (pos, edge, biomePos) => { assert.equal(edge, false); assert.equal(biomePos.y, 11); decisions.push('freeze'); return pos.x === 0 && pos.z === 0; },
        shouldSnow: pos => { decisions.push('snow'); return pos.x === 0 && pos.z === 1; },
        getBlockState: () => state('grass_block', { snowy: 'false' })
    });
    assert.equal(f.place({ type: 'minecraft:freeze_top_layer' }), true);
    assert.equal(heights.length, 256);
    assert.deepEqual(heights.slice(0, 3), [[0, 0], [0, 1], [0, 2]]);
    assert.deepEqual(heights.at(-1), [15, 15]);
    assert.deepEqual(decisions.slice(0, 4), ['freeze', 'snow', 'freeze', 'snow']);
    assert.deepEqual(f.writes.map(w => w.value.name), ['minecraft:ice', 'minecraft:snow', 'minecraft:grass_block']);
    assert.equal(f.writes[2].value.properties.snowy, 'true');
});

test('overlay executes every child, sequence stops on failure, and neither rolls back previous writes', () => {
    for (const type of ['overlay', 'sequence']) {
        const calls = [];
        const place = createConfiguredFeaturePlacer({}, { stateIdFor: () => 1, canSurvive: () => true, setBlock: () => {},
            handlers: { 'minecraft:probe': (_name, feature) => { calls.push(feature.id); return feature.id !== 'fail'; } } });
        const features = ['ok', 'fail', 'later'].map(id => ({ feature: { type: 'minecraft:probe', id }, placement: [] }));
        assert.equal(place('<test>', { type: `minecraft:${type}`, features }, origin, fixedRandom, {}), type === 'overlay');
        assert.deepEqual(calls, type === 'overlay' ? ['ok', 'fail', 'later'] : ['ok', 'fail']);
        assert.equal(place('<test>', { type: `minecraft:${type}`, features: [] }, origin, fixedRandom, {}), type === 'sequence');
    }
    assert.equal(fixture().place({ type: 'minecraft:no_op' }), true);
});

test('rule-based providers distinguish optional failure from mandatory current-state fallback', () => {
    const current = state('stone');
    const sampler = createBlockStateProviderSampler({}, { stateIdFor: () => 1, random: fixedRandom, context: { getBlockState: () => current } });
    const provider = { type: 'minecraft:rule_based', rules: [] };
    assert.equal(sampler.sampleOptional(provider, origin), null);
    assert.equal(sampler.sample(provider, origin), current);
    const nested = { type: 'minecraft:rule_based', rules: [
        { if_true: { type: 'minecraft:true' }, then: provider },
        { if_true: { type: 'minecraft:true' }, then: { id: 'minecraft:dirt' } }
    ] };
    assert.equal(sampler.sampleOptional(nested, origin).name, 'minecraft:dirt');
    assert.equal(fixture().place({ type: 'minecraft:simple_block', to_place: provider }), false);
});

test('block predicates preserve short-circuit order, offsets and strict missing world adapters', () => {
    const reads = [];
    const testPredicate = createBlockPredicateTester({ getBlockState: pos => { reads.push(pos); return state('stone'); } });
    assert.equal(testPredicate({ type: 'minecraft:all_of', predicates: [
        { type: 'minecraft:matching_blocks', blocks: 'minecraft:dirt' }, { type: 'minecraft:solid' }
    ] }, origin), false);
    assert.deepEqual(reads, [origin]);
    assert.equal(testPredicate({ type: 'minecraft:matching_blocks', blocks: ['minecraft:stone'], offset: [1, -2, 3] }, origin), true);
    assert.deepEqual(reads.at(-1), { x: 1, y: 8, z: 3 });
    assert.throws(() => testPredicate({ type: 'minecraft:solid' }, origin), /context.isSolid/);
});

test('configured feature predicate fallback retains prototype methods and the original world instance', () => {
    class World {
        constructor() { this.reads = 0; }
        getBlockState() { this.reads++; return state('air'); }
    }
    const world = new World(), writes = [];
    const place = createConfiguredFeaturePlacer({}, { stateIdFor: () => 1, canSurvive: () => true, setBlock: (...args) => writes.push(args) });
    assert.equal(place('<test>', { type: 'minecraft:block_column', direction: 'up',
        allowed_placement: { type: 'minecraft:matching_blocks', blocks: 'minecraft:air' }, layers: [{ height: 1, provider: { id: 'minecraft:stone' } }]
    }, origin, fixedRandom, world), true);
    assert.equal(world.reads, 1);
    assert.equal(writes[0][3], world);
});

test('imported column/pile/disk/blob/spread configs are executable without custom feature handlers', async () => {
    const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));
    const writes = [];
    const place = createConfiguredFeaturePlacer(data, { stateIdFor: () => 1, canSurvive: () => true, setBlock: (...args) => writes.push(args) });
    const context = { minY: 0, maxY: 128, getBlockState: () => state('air'), isAir: () => true,
        testBlockPredicate: () => true, isFaceSturdy: () => true, markPosForPostProcessing: () => {} };
    for (const name of ['cactus', 'kelp', 'sugar_cane', 'cave_vine', 'cave_vine_in_moss', 'twisting_vines', 'pile_hay', 'pile_pumpkin', 'disk_clay', 'disk_sand', 'forest_rock', 'glowstone_extra']) {
        assert.equal(place(name, data[`data/minecraft/worldgen/feature/${name}.json`], { x: 0, y: 20, z: 0 }, fixedRandom, context), true, name);
    }
    assert.ok(writes.length > 50);
});
