import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfiguredFeaturePlacer, createBlockStateProviderSampler } from '../features.mjs';
import { placeShapeFeature, SHAPE_FEATURE_TYPES } from '../shape-features.mjs';
import { createBlockPredicateTester } from '../feature-world.mjs';
import { sampleHeightProvider, resolveVerticalAnchor } from '../value-providers.mjs';
import { placeVanillaPlacedFeature } from '../placed-features.mjs';
import { createVanillaKernel } from '../runtime.mjs';
import { oracleFeature } from './feature-fixtures.mjs';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));
const origin = { x: 0, y: 20, z: 0 };
const state = (name, properties = {}) => ({ name: `minecraft:${name}`, properties });
const noRandom = { nextInt: () => assert.fail('Unexpected integer draw'), nextFloat: () => assert.fail('Unexpected float draw') };
const zeroRandom = { nextInt: () => 0, nextFloat: () => 0 };
function world(base = p => state(p.y < 20 ? 'stone' : 'air')) {
    const writes = [], destroyed = [], blocks = new Map();
    const key = p => `${p.x},${p.y},${p.z}`;
    const tags = name => {
        const resource = data[`data/minecraft/tags/block/${name.replace(/^minecraft:/, '')}.json`];
        if (!resource) throw new Error(`Missing test tag ${name}`);
        return resource.values.flatMap(value => {
            const id = typeof value === 'string' ? value : value.id;
            return id.startsWith('#') ? tags(id.slice(1)) : [id];
        });
    };
    const context = {
        minY: 0, maxY: 64, seaLevel: 32, generationDepth: 64,
        getBlockState: p => blocks.get(key(p)) ?? base(p),
        isAir: p => context.getBlockState(p).name === 'minecraft:air',
        isReplaceable: p => context.isAir(p),
        resolveBlockTag: tags, isBlockInTag: (s, tag) => tags(tag).includes(s.name),
        isBiomeFeature: () => assert.fail('Nested feature must use normal placement'),
        getDefaultBlockState: name => ({ name, properties: /_(stem|log)$|:basalt$/.test(name) ? { axis: 'y' }
            : name.endsWith('_wall_fan') ? { facing: 'north', waterlogged: 'true' } : name.endsWith('_coral') || name.endsWith('_fan') ? { waterlogged: 'true' } : {} }),
        destroyBlock: (p, drop) => { destroyed.push({ ...p, drop }); if (!context.isAir(p)) setBlock(state('air'), p, 3); },
        getHeight: () => 20, isInsideWorldBounds: p => p.y >= 0 && p.y < 64
    };
    const setBlock = (s, p, flags) => { blocks.set(key(p), s); writes.push({ state: s, pos: { ...p }, flags }); };
    context.testBlockPredicate = createBlockPredicateTester(context);
    const place = createConfiguredFeaturePlacer(data, { stateIdFor: () => 1, canSurvive: () => true, setBlock });
    return { context, writes, destroyed, setBlock, place: (feature, random = zeroRandom, pos = origin) => place('<test>', feature, pos, random, context) };
}

test('pillar cap runs one step opposite the direction even when zero pillar blocks fit', () => {
    const caps = [];
    assert.equal(placeShapeFeature(oracleFeature('pillar_blocked'), origin, noRandom, {
        context: { minY: 0, maxY: 64, getBlockState: () => state('stone') },
        placeNested: (feature, p) => { caps.push(p); return false; }, setBlock: () => assert.fail('No pillar writes')
    }), true);
    assert.deepEqual(caps, [{ ...origin, y: 19 }]);
});

test('pillar draws continuation before its outside-height gate and caps the final in-bounds block', () => {
    let floats = 0;
    const writes = [], caps = [];
    assert.equal(placeShapeFeature({ ...oracleFeature('pillar_cap'), chance_to_continue: 1 }, origin, { nextFloat: () => { floats++; return 0; } }, {
        context: { minY: 0, maxY: 23, getBlockState: () => state('air') }, sampleState: () => state('basalt'),
        setBlock: (s, p, flags) => writes.push([p.y, flags]), placeNested: (_, p) => caps.push(p.y)
    }), true);
    assert.equal(floats, 4); assert.deepEqual(writes, [[20, 2], [21, 2], [22, 2]]); assert.deepEqual(caps, [22]);
});

test('projected patch checks the block below and moves once even with projection height zero', () => {
    const w = world(() => state('air'));
    assert.equal(w.place({ ...oracleFeature('patch_zero'), size: 1 }), true);
    assert.equal(w.writes.length, 9);
    assert.ok(w.writes.every(v => v.pos.y === 19 && v.flags === 2));
});

test('stepped-column center with zero surface-search budget does not place a column', () => {
    const w = world(); const bounds = [];
    assert.equal(w.place({ ...oracleFeature('stepped'), height: 5, cluster_reach: 0, column_count: 1, column_reach: 0 }, {
        nextInt: bound => { bounds.push(bound); return 0; }
    }), false);
    assert.deepEqual(bounds, [1, 1, 1]); assert.equal(w.writes.length, 0);
});

test('coral trunk failure has distinct tree/claw return values and RNG gates', () => {
    let draws = 0;
    const options = { context: {}, placeNested: () => false, setBlock: () => assert.fail('No coral writes') };
    assert.equal(placeShapeFeature(oracleFeature('coral_tree'), origin, { nextInt: b => { assert.equal(b, 3); draws++; return 0; } }, options), true);
    assert.equal(draws, 1); assert.equal(placeShapeFeature(oracleFeature('coral_claw'), origin, noRandom, options), false);
});

test('fungus height rejection uses generator depth and stops before huge-stem probability or writes', () => {
    const w = world(p => state(p.y < 20 ? 'crimson_nylium' : 'air')); const draws = [];
    w.context.generationDepth = 25;
    assert.equal(w.place(oracleFeature('fungus_crimson'), { nextInt: b => { draws.push(b); return b === 12 ? 1 : 0; }, nextFloat: noRandom.nextFloat }), false);
    assert.deepEqual(draws, [10, 12]); assert.equal(w.writes.length, 0);
});

test('planted fungus skips huge-stem RNG, retains destruction calls and decodes default stem axis', () => {
    const w = world(p => state(p.y < 20 ? 'crimson_nylium' : 'air')); const draws = [];
    const feature = { ...oracleFeature('fungus_planted'), stem_state: 'minecraft:crimson_stem' };
    assert.equal(w.place(feature, { nextInt: b => { draws.push(b); return b === 12 ? 1 : 0; }, nextFloat: () => 0.99 }), true);
    assert.deepEqual(draws.slice(0, 3), [10, 12, 2]);
    assert.equal(w.writes[0].flags, 260);
    const stems = w.writes.filter(v => v.state.name === 'minecraft:crimson_stem');
    assert.equal(stems.length, 4); assert.ok(stems.every(v => v.state.properties.axis === 'y' && v.flags === 3));
    assert.ok(w.destroyed.length >= 4 && w.destroyed.every(v => v.drop));
});

test('chorus checks its support tag before RNG and refreshes connected branch states', () => {
    assert.equal(world().place(oracleFeature('chorus'), noRandom), false);
    const w = world(p => state(p.y < 20 ? 'end_stone' : 'air'));
    assert.equal(w.place(oracleFeature('chorus')), true);
    assert.equal(w.writes[0].state.properties.down, 'true');
    assert.ok(w.writes.some(v => v.state.name === 'minecraft:chorus_flower' && v.state.properties.age === '5'));
    assert.ok(w.writes.some(v => v.state.properties.north === 'true'));
    assert.ok(w.writes.every(v => v.flags === 2));
});

test('random-block tags preserve caller registry order and empty optional providers consume no RNG', () => {
    const calls = [];
    const context = { resolveBlockTag: tag => { calls.push(tag); return ['minecraft:stone', 'minecraft:basalt']; },
        getDefaultBlockState: name => ({ name, properties: { axis: 'y' } }), getBlockState: () => state('dirt') };
    const sampler = createBlockStateProviderSampler({}, { stateIdFor: () => 1, context, random: { nextInt: b => { assert.equal(b, 2); return 1; } } });
    assert.deepEqual(sampler.sample({ type: 'minecraft:random_block', blocks: '#minecraft:test' }, origin), { stateId: 1, ...state('basalt', { axis: 'y' }) });
    assert.deepEqual(calls, ['minecraft:test']);
    const empty = createBlockStateProviderSampler({}, { stateIdFor: () => 1, context, random: noRandom });
    assert.equal(empty.sampleOptional({ type: 'minecraft:random_block', blocks: [] }, origin), null);
    assert.equal(empty.sample({ type: 'minecraft:random_block', blocks: [] }, origin).name, 'minecraft:dirt');
});

test('height predicates use generation bounds and relative sea-level anchors inclusively', () => {
    const testPredicate = createBlockPredicateTester({ minY: -64, maxY: 320, seaLevel: 63, generationContext: { minY: 0, maxY: 128, seaLevel: 8 } });
    const predicate = { type: 'minecraft:height_range', min_inclusive: { above_bottom: 0 }, max_inclusive: { relative_to_sea_level: 0 } };
    for (const [y, expected] of [[-1, false], [0, true], [8, true], [9, false]]) assert.equal(testPredicate(predicate, { ...origin, y }), expected);
    assert.throws(() => resolveVerticalAnchor({ above_bottom: 0 }, {}), /minY/);
});

test('biased heights retain inner-dependent two-draw bounds and empty-range no-draw behavior', () => {
    const context = { minY: 0, maxY: 64, seaLevel: 32 }, bounds = [], values = [7, 9];
    const provider = { type: 'minecraft:biased_to_bottom', min_inclusive: { absolute: 2 }, max_inclusive: { absolute: 50 }, inner: 3 };
    assert.equal(sampleHeightProvider(provider, { nextInt: b => { bounds.push(b); return values.shift(); } }, context), 11);
    assert.deepEqual(bounds, [46, 10]);
    assert.equal(sampleHeightProvider({ ...provider, min_inclusive: { absolute: 50 }, max_inclusive: { absolute: 51 } }, noRandom, context), 50);
    assert.throws(() => sampleHeightProvider({ ...provider, inner: 0 }, noRandom, context), /inner/);
});

test('cuboid faces omit shared edges and interior, with X/Y/Z encounter order', () => {
    const positions = [];
    placeVanillaPlacedFeature({ feature: { type: 'minecraft:test' }, placement: [{ type: 'minecraft:cuboid', xz_size: 3, y_size: 3, include_edges: false, include_interior: false }] }, origin, {
        random: noRandom, placeFeature: (_, __, p) => { positions.push(p); return true; }
    });
    assert.equal(positions.length, 24);
    assert.deepEqual(positions.slice(0, 2), [{ x: 0, y: 21, z: 1 }, { x: 0, y: 21, z: 2 }]);
});

test('random-chance endpoint filters still consume a float, and selected placement shares its RNG', () => {
    const calls = [], random = { nextInt: b => { calls.push(b); return 0; }, nextFloat: () => { calls.push('float'); return 0; } };
    const modifier = { type: 'minecraft:randomly_selected', placements: [{ type: 'minecraft:random_chance', chance: 0 }] };
    const result = placeVanillaPlacedFeature({ feature: { type: 'minecraft:test' }, placement: [modifier] }, origin, { random, placeFeature: () => assert.fail('Chance zero') });
    assert.equal(result.attempted, 0); assert.deepEqual(calls, [1, 'float']);
});

test('all 25 imported instances of the seven new feature types reach the executor', async () => {
    const features = [];
    const types = new Set([...SHAPE_FEATURE_TYPES, 'minecraft:huge_fungus', 'minecraft:chorus_plant']);
    const visit = value => { if (!value || typeof value !== 'object') return; if (types.has(value.type)) features.push(value); for (const child of Object.values(value)) visit(child); };
    for (const [path, value] of Object.entries(data)) if (path.startsWith('data/minecraft/worldgen/feature/')) visit(value);
    assert.equal(features.length, 25);
    const kernel = await createVanillaKernel(await readFile(new URL('../generated/worldgen.wasm', import.meta.url)), JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url), 'utf8')));
    try {
        for (const feature of features) {
            const base = p => state(p.y < 20 ? feature.type === 'minecraft:chorus_plant' ? 'end_stone' : feature.type === 'minecraft:huge_fungus' ? feature.valid_base_block.slice(10) : 'stone'
                : feature.type.includes('coral_') ? 'water' : 'air');
            const w = world(base), random = kernel.random('8');
            try { assert.equal(typeof w.place(feature, random), 'boolean', feature.type); }
            finally { random.dispose(); }
        }
    } finally { kernel.dispose(); }
});

test('nine imported Nether, coral and End parent configs run their complete nested placement pipelines', async () => {
    const names = ['basalt_pillar', 'small_basalt_columns', 'large_basalt_columns', 'warm_ocean_vegetation',
        'crimson_fungus', 'crimson_fungus_planted', 'warped_fungus', 'warped_fungus_planted', 'chorus_plant'];
    const kernel = await createVanillaKernel(await readFile(new URL('../generated/worldgen.wasm', import.meta.url)), JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url), 'utf8')));
    try {
        for (const name of names) for (const seed of ['0', '8', '912337']) {
            const feature = data[`data/minecraft/worldgen/feature/${name}.json`];
            const base = p => state(p.y < 20 ? name === 'chorus_plant' ? 'end_stone' : feature.valid_base_block?.slice(10) ?? 'stone' : name === 'warm_ocean_vegetation' ? 'water' : 'air');
            const w = world(base), random = kernel.random(seed);
            try {
                assert.equal(w.place(feature, random), true, `${name}, seed=${seed}`);
                assert.ok(w.writes.length > 0, `${name}, seed=${seed}: expected actual block writes`);
            } finally { random.dispose(); }
        }
    } finally { kernel.dispose(); }
});
