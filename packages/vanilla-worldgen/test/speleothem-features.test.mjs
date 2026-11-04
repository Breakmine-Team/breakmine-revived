import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfiguredFeaturePlacer } from '../features.mjs';
import { createBlockPredicateTester, blockName } from '../feature-world.mjs';
import { scanWorldgenColumn } from '../column-scan.mjs';
import { createSpeleothemTools, SPELEOTHEM_FEATURE_TYPES, isEmptyOrWater, speleothemHeight } from '../speleothem-utils.mjs';
import { intProviderBounds, sampleFloatProvider } from '../value-providers.mjs';
import { createVanillaKernel } from '../runtime.mjs';
import { oracleFeature } from './feature-fixtures.mjs';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));
const origin = { x: 0, y: 20, z: 0 };
const state = (name, properties = {}) => ({ name: `minecraft:${name}`, properties });
const noRandom = Object.fromEntries(['nextInt', 'nextFloat', 'nextDouble', 'nextBoolean', 'nextGaussian'].map(name => [name, () => assert.fail(`Unexpected ${name}`)]));
const zeroRandom = { nextInt: () => 0, nextFloat: () => 0, nextDouble: () => 0, nextBoolean: () => true, nextGaussian: () => 0 };
const tagCache = new Map();
function resolveTag(name) {
    if (!tagCache.has(name)) {
        const resource = data[`data/minecraft/tags/block/${name.replace(/^minecraft:/, '')}.json`];
        assert.ok(resource, `Missing imported tag ${name}`);
        tagCache.set(name, resource.values.flatMap(entry => {
            const id = typeof entry === 'string' ? entry : entry.id;
            return id.startsWith('#') ? resolveTag(id.slice(1)) : [id];
        }));
    }
    return tagCache.get(name);
}
function world(base = p => state(p.y <= 17 || p.y >= 27 ? 'stone' : 'air')) {
    const blocks = new Map(), writes = [], heightQueries = [];
    const key = p => `${p.x},${p.y},${p.z}`;
    const context = {
        minY: 0, maxY: 64, seaLevel: 32,
        getBlockState: p => blocks.get(key(p)) ?? base(p),
        getDefaultBlockState: name => ({ name, properties: name === 'minecraft:sulfur_spike' || name === 'minecraft:pointed_dripstone'
            ? { vertical_direction: 'up', thickness: 'tip', waterlogged: 'false' } : {} }),
        resolveBlockTag: resolveTag, isBlockInTag: (s, tag) => resolveTag(tag).includes(blockName(s)),
        blockFluidIsInTag: (s, tag) => tag === 'minecraft:water' && (blockName(s) === 'minecraft:water' || s.properties?.waterlogged === 'true'),
        isSolid: p => !isEmptyOrWater(context.getBlockState(p)) && blockName(context.getBlockState(p)) !== 'minecraft:lava',
        getHeight: (type, x, z) => { heightQueries.push({ type, x, z }); return 64; },
        isBiomeFeature: () => assert.fail('Unexpected top-level biome check')
    };
    const setBlock = (s, p, flags) => { blocks.set(key(p), s); writes.push({ state: s, pos: { ...p }, flags }); };
    const directState = value => typeof value === 'string' ? { name: value, properties: {} } : { name: value.id, properties: { ...value.properties } };
    context.testBlockPredicate = createBlockPredicateTester(context);
    const place = createConfiguredFeaturePlacer(data, { stateIdFor: () => 1, canSurvive: () => assert.fail('Unexpected survival callback'), setBlock });
    return { context, writes, heightQueries, options: { context, setBlock, directState },
        place: (feature, random = zeroRandom, pos = origin) => place('<test>', feature, pos, random, context) };
}
const smallCluster = overrides => ({ ...oracleFeature('cluster'), height: 4, radius: 0,
    speleothem_block_layer_thickness: 1, density: 1, wetness: 0, height_deviation: 0,
    chance_of_speleothem_at_max_distance_from_center: 1, ...overrides });
const smallLarge = overrides => ({ ...oracleFeature('large'), column_radius: 3, height_scale: 1,
    stalactite_bluntness: 0.5, stalagmite_bluntness: 0.5, min_radius_for_wind: 16, ...overrides });
const largeWorld = () => world(p => state(p.y <= 10 || p.y >= 35 ? 'stone' : 'air'));

test('column scan walks up before down and includes the search-range endpoint', () => {
    const reads = [];
    const read = p => { reads.push(p.y); return state(p.y === 23 || p.y === 18 ? 'stone' : 'air'); };
    assert.deepEqual(scanWorldgenColumn(origin, 4, read, isEmptyOrWater, s => !isEmptyOrWater(s)), { ceiling: 23, floor: 18, height: 4 });
    assert.deepEqual(reads, [20, 20, 21, 22, 23, 20, 19, 18, 18]);
    assert.deepEqual(scanWorldgenColumn(origin, 3, read, isEmptyOrWater, s => !isEmptyOrWater(s)), { ceiling: null, floor: 18, height: null });
});

test('column scan distinguishes rejected starts, open rays and wholly open lines', () => {
    assert.equal(scanWorldgenColumn(origin, 4, () => state('stone'), isEmptyOrWater, () => true), null);
    assert.deepEqual(scanWorldgenColumn(origin, 4, p => state(p.y <= 18 ? 'stone' : 'air'), isEmptyOrWater, s => !isEmptyOrWater(s)), { ceiling: null, floor: 18, height: null });
    assert.deepEqual(scanWorldgenColumn(origin, 1, () => state('air'), isEmptyOrWater, () => false), { ceiling: null, floor: null, height: null });
    assert.throws(() => scanWorldgenColumn(origin, 0, () => state('air'), isEmptyOrWater, () => false), /range/);
});

test('pointed speleothems reject missing support before consuming random values', () => {
    const w = world(() => state('air'));
    assert.equal(w.place(oracleFeature('pointed_floor'), noRandom), false);
    assert.equal(w.writes.length, 0);
});

test('two-sided pointed support draws a boolean before spread and selects its direction', () => {
    for (const [value, direction] of [[true, 'down'], [false, 'up']]) {
        const calls = [], w = world(p => state(p.y === 20 ? 'air' : 'stone'));
        w.place(oracleFeature('pointed_both'), { ...noRandom,
            nextBoolean: () => { calls.push('boolean'); return value; }, nextFloat: () => { calls.push('float'); return 0.99; } });
        assert.deepEqual(calls, ['boolean', 'float', 'float', 'float', 'float', 'float']);
        assert.equal(w.writes.at(-1).state.properties.vertical_direction, direction);
    }
});

test('spread probabilities are inclusive, but taller-generation probability is strict', () => {
    const w = world(p => state(p.y < 20 ? 'stone' : 'air'));
    const feature = { ...oracleFeature('pointed_floor'), chance_of_directional_spread: 0,
        chance_of_spread_radius2: 0, chance_of_spread_radius3: 0, chance_of_taller_generation: 0 };
    const bounds = [];
    assert.equal(w.place(feature, { ...zeroRandom, nextInt: b => { bounds.push(b); return 0; } }), true);
    assert.deepEqual(bounds, Array(8).fill(6));
    assert.equal(w.writes.filter(v => v.state.name === 'minecraft:pointed_dripstone').length, 1);
    assert.deepEqual(w.writes.slice(1, 4).map(v => v.pos), [{ x: 0, y: 19, z: -1 }, { x: 0, y: 18, z: -1 }, { x: 0, y: 17, z: -1 }]);
});

test('speleothem bases use block defaults, not configured state properties', () => {
    const w = world(p => state(p.y < 20 ? 'stone' : 'air'));
    const tools = createSpeleothemTools({ ...oracleFeature('pointed_floor'), base_block: { id: 'minecraft:dripstone_block', properties: { bogus: 'true' } } }, w.options);
    assert.equal(tools.placeBase({ ...origin, y: 19 }), true);
    assert.deepEqual(w.writes[0].state.properties, {});
    assert.equal(w.writes[0].flags, 2);
    assert.equal(tools.placeBase({ ...origin, y: 19 }), false);
});

for (const [height, thicknesses] of [[0, []], [1, ['tip']], [2, ['frustum', 'tip']],
    [3, ['base', 'frustum', 'tip']], [5, ['base', 'middle', 'middle', 'frustum', 'tip']]]) {
    test(`pointed growth preserves the ${height}-block thickness sequence and direction`, () => {
        for (const direction of ['up', 'down']) {
            const w = world(p => state(p.y === (direction === 'up' ? 19 : 21) ? 'stone' : 'air'));
            createSpeleothemTools(oracleFeature('pointed_floor'), w.options).grow(origin, direction, height, false);
            assert.deepEqual(w.writes.map(v => v.state.properties.thickness), thicknesses);
            assert.deepEqual(w.writes.map(v => v.pos.y), thicknesses.map((_, i) => 20 + i * (direction === 'up' ? 1 : -1)));
            assert.ok(w.writes.every(v => v.state.properties.vertical_direction === direction && v.flags === 2));
        }
    });
}

test('sulfur tips merge and inherit waterlogging from actual fluid states', () => {
    const w = world(p => p.y === 19 ? state('stone') : state('oak_slab', { waterlogged: 'true' }));
    createSpeleothemTools(oracleFeature('pointed_sulfur'), w.options).grow(origin, 'up', 2, true);
    assert.deepEqual(w.writes.map(v => v.state.properties.thickness), ['frustum', 'tip_merge']);
    assert.ok(w.writes.every(v => v.state.name === 'minecraft:sulfur_spike' && v.state.properties.waterlogged === 'true'));
});

test('pointed growth does not guess missing default-state or fluid adapters', () => {
    const w = world(p => state(p.y === 19 ? 'stone' : 'air'));
    delete w.context.blockFluidIsInTag;
    assert.throws(() => createSpeleothemTools(oracleFeature('pointed_floor'), w.options).grow(origin, 'up', 1, false), /blockFluidIsInTag/);
    delete w.context.getDefaultBlockState;
    assert.throws(() => createSpeleothemTools(oracleFeature('pointed_floor'), w.options).placeBase({ ...origin, y: 19 }), /getDefaultBlockState/);
    assert.equal(w.writes.length, 0);
});

test('cluster start rejection and open-column scans avoid per-column random draws', () => {
    assert.equal(world(() => state('stone')).place(smallCluster(), noRandom), false);
    const w = world(() => state('air'));
    assert.equal(w.place(smallCluster(), noRandom), true);
    assert.equal(w.writes.length, 0);
});

test('cluster samples height, wetness, density, X radius and Z radius in that order', () => {
    const calls = [], w = world(() => state('air'));
    const uniform = (min, max) => ({ type: 'minecraft:uniform', min_inclusive: min, max_inclusive: max });
    const feature = smallCluster({ height: uniform(3, 6), radius: uniform(2, 4),
        wetness: { type: 'minecraft:clamped_normal', mean: 0.1, deviation: 0.3, min: 0.1, max: 0.9 },
        density: { type: 'minecraft:uniform', min_inclusive: 0.3, max_exclusive: 0.7 } });
    w.place(feature, { ...noRandom, nextInt: b => { calls.push(b); return 0; },
        nextGaussian: () => { calls.push('gaussian'); return 0; }, nextFloat: () => { calls.push('float'); return 0; } });
    assert.deepEqual(calls, [4, 'gaussian', 'float', 3, 3]);
});

test('wet clusters lower their growth floor after replacing an enclosed floor with water', () => {
    const w = world();
    w.place(smallCluster({ wetness: 1 }));
    assert.deepEqual(w.writes[0], { state: { stateId: 1, ...state('water', { level: '0' }) }, pos: { ...origin, y: 17 }, flags: 2 });
    const up = w.writes.filter(v => v.state.properties.vertical_direction === 'up');
    assert.equal(up[0].pos.y, 17); assert.equal(up[0].state.properties.waterlogged, 'true');
});

test('pool creation requires a non-waterlogged cell above and enclosure on all five sides', () => {
    for (const base of [p => p.y === 18 ? state('water') : state(p.y <= 17 || p.y >= 27 ? 'stone' : 'air'),
        p => p.y === 17 && p.x === 1 ? state('air') : state(p.y <= 17 || p.y >= 27 ? 'stone' : 'air')]) {
        const w = world(base);
        w.place(smallCluster({ wetness: 1 }));
        assert.ok(w.writes.every(v => v.state.name !== 'minecraft:water'));
    }
});

test('cluster density uses an inclusive gate and merge consumes a boolean even without tips', () => {
    let gaussian = 0, bools = 0;
    const w = world();
    w.place(smallCluster({ density: 0 }), { ...zeroRandom,
        nextGaussian: () => { gaussian++; return 0; }, nextBoolean: () => { bools++; return false; } });
    assert.equal(gaussian, 1); assert.equal(bools, 1);
    assert.ok(w.writes.some(v => v.state.name === 'minecraft:pointed_dripstone'));
    const empty = world();
    empty.place(smallCluster({ density: 0 }), { ...zeroRandom,
        nextFloat: () => 0.5, nextBoolean: () => { bools++; return true; }, nextGaussian: noRandom.nextGaussian });
    assert.equal(bools, 2);
    assert.equal(empty.writes.filter(v => v.state.name === 'minecraft:pointed_dripstone').length, 0);
});

test('overlapping clusters split the column inclusively and merge only meeting nonempty tips', () => {
    const bounds = [], w = world(p => state(p.y <= 19 || p.y >= 22 ? 'stone' : 'air'));
    w.place(smallCluster({ height: 8, height_deviation: 3 }), { ...zeroRandom,
        nextInt: b => { bounds.push(b); return b === 3 && bounds.length === 2 ? 1 : 0; }, nextGaussian: () => 100 });
    assert.deepEqual(bounds, [3, 3]);
    const tips = w.writes.filter(v => v.state.name === 'minecraft:pointed_dripstone');
    assert.deepEqual(tips.map(v => [v.pos.y, v.state.properties.thickness]), [[21, 'tip_merge'], [20, 'tip_merge']]);
});

test('large dripstone rejects open, shallow and blocked columns before any random draw', () => {
    for (const base of [() => state('stone'), p => state(p.y <= 10 ? 'stone' : 'air'), p => state(p.y <= 19 || p.y >= 23 ? 'stone' : 'air')]) {
        const w = world(base);
        assert.equal(w.place(smallLarge(), noRandom), false); assert.equal(w.writes.length, 0);
    }
});

test('large radius selection uses provider bounds, not the configured provider distribution', () => {
    const bounds = [], w = largeWorld();
    w.place(smallLarge({ column_radius: { type: 'minecraft:weighted_list', distribution: [
        { weight: 1, data: 3 }, { weight: 100, data: 16 }] } }),
    { ...zeroRandom, nextInt: b => { bounds.push(b); return 0; } });
    assert.deepEqual(bounds, [5]);
    assert.ok(w.writes.length > 0);
});

test('radius-one large columns return success without placement or wind draws', () => {
    const bounds = [], w = largeWorld();
    assert.equal(w.place(smallLarge({ column_radius: 1 }), { ...noRandom, nextInt: b => { bounds.push(b); return 0; } }), true);
    assert.deepEqual(bounds, [1]); assert.equal(w.writes.length, 0);
});

test('wind samples speed before angle only when both column thresholds qualify', () => {
    for (const [threshold, expected] of [[0, ['int:1', 'float', 'float']], [0.6, ['int:1']]]) {
        const calls = [], w = largeWorld();
        w.place(smallLarge({ column_radius: 1, min_radius_for_wind: 0, min_bluntness_for_wind: threshold }), {
            ...noRandom, nextInt: bound => { calls.push(`int:${bound}`); return 0; },
            nextFloat: () => { calls.push('float'); return 0.5; }
        });
        assert.deepEqual(calls, expected);
        assert.equal(w.writes.length, 0);
    }
});

test('wind displaces final blocks relative to origin height, not just the embedding probes', () => {
    const w = largeWorld();
    w.place(smallLarge({ column_radius: 6, min_radius_for_wind: 0, min_bluntness_for_wind: 0, wind_speed: 0.3 }),
        { ...zeroRandom, nextFloat: () => 0.5 });
    assert.ok(w.writes.some(v => v.pos.z < -6));
    const bottom = w.writes.filter(v => v.pos.y === 11).map(v => v.pos.z);
    assert.ok(bottom.length > 0);
    assert.ok(Math.min(...bottom) + Math.max(...bottom) > 0);
    assert.ok(w.writes.every(v => v.state.name === 'minecraft:dripstone_block' && v.flags === 2));
});

test('large embedding search retries with halved radii without resampling', () => {
    const w = world(p => state((p.y <= 10 || p.y >= 35) && Math.abs(p.x) <= 3 && Math.abs(p.z) <= 3 ? 'stone' : 'air'));
    const draws = [];
    w.place(smallLarge({ column_radius: 8 }), { ...zeroRandom, nextInt: b => { draws.push(b); return 0; } });
    assert.deepEqual(draws, [1]); assert.ok(w.writes.length > 0);
    assert.ok(w.writes.every(v => Math.abs(v.pos.x) <= 2 && Math.abs(v.pos.z) <= 2));
});

test('lava is a column boundary, not scan-through air, and disables the upward root', () => {
    const w = world(p => state(p.y <= 10 ? 'lava' : p.y >= 35 ? 'stone' : 'air'));
    assert.equal(w.place(smallLarge()), true);
    assert.ok(w.writes.length > 0); assert.equal(w.heightQueries.length, 0);
});

test('large upward growth uses WORLD_SURFACE_WG and stops at the exclusive heightmap', () => {
    const w = largeWorld(), queries = [];
    w.context.getHeight = (type, x, z) => { queries.push([type, x, z]); return 11; };
    w.place(smallLarge());
    assert.ok(queries.length > 0 && queries.every(([type]) => type === 'WORLD_SURFACE_WG'));
    assert.ok(w.writes.length > 0 && w.writes.every(v => v.pos.y > 11));
});

test('clamped-normal floats retain float rounding and draw Gaussian even with zero deviation', () => {
    const provider = { type: 'minecraft:clamped_normal', mean: 0.1, deviation: 0.3, min: 0.1, max: 0.9 };
    let calls = 0;
    const random = { nextGaussian: () => { calls++; return 0.876543210123; } };
    const expected = Math.fround(Math.fround(0.1) + Math.fround(Math.fround(0.876543210123) * Math.fround(0.3)));
    assert.equal(sampleFloatProvider(provider, random), expected);
    assert.equal(sampleFloatProvider({ ...provider, deviation: 0 }, random), Math.fround(0.1));
    assert.equal(calls, 2);
    assert.equal(sampleFloatProvider(provider, { nextGaussian: () => 100 }), Math.fround(0.9));
    assert.throws(() => sampleFloatProvider({ ...provider, min: 1 }, random), /Invalid/);
});

test('integer provider metadata intersects clamps and spans weighted entries without sampling', () => {
    assert.deepEqual(intProviderBounds({ type: 'minecraft:clamped', min_inclusive: 3, max_inclusive: 16,
        source: { type: 'minecraft:uniform', min_inclusive: 5, max_inclusive: 19 } }), { min: 5, max: 16 });
    assert.deepEqual(intProviderBounds({ type: 'minecraft:weighted_list', distribution: [
        { weight: 1, data: 7 }, { weight: 99, data: { type: 'minecraft:trapezoid', min: 2, max: 10, plateau: 1 } }] }), { min: 2, max: 10 });
    assert.deepEqual(intProviderBounds({ type: 'minecraft:clamped', source: 1, min_inclusive: 3, max_inclusive: 16 }), { min: 3, max: 1 });
    assert.throws(() => intProviderBounds({ type: 'minecraft:weighted_list', distribution: [] }), /entries/);
    assert.throws(() => intProviderBounds(1.5), /Malformed/);
});

test('large column height curves stay nonnegative and clamp their distance by bluntness', () => {
    assert.equal(speleothemHeight(0, 8, 1, 0.5), speleothemHeight(0.5, 8, 1, 0.5));
    assert.ok(speleothemHeight(0, 8, 1, 0.5) > speleothemHeight(8, 8, 1, 0.5));
    assert.equal(speleothemHeight(8, 8, 0, 0.5), 0);
});

test('all seven imported cave instances and five nested parent configs execute with WASM RNG', async () => {
    const instances = [];
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (SPELEOTHEM_FEATURE_TYPES.has(value.type)) instances.push(value);
        for (const child of Object.values(value)) visit(child);
    };
    for (const [path, value] of Object.entries(data)) if (path.startsWith('data/minecraft/worldgen/feature/')) visit(value);
    assert.equal(instances.length, 7);
    const parents = ['pointed_dripstone', 'sulfur_spike', 'dripstone_cluster', 'sulfur_spike_cluster', 'large_dripstone']
        .map(name => data[`data/minecraft/worldgen/feature/${name}.json`]);
    const kernel = await createVanillaKernel(await readFile(new URL('../generated/worldgen.wasm', import.meta.url)),
        JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url), 'utf8')));
    try {
        for (const feature of [...instances, ...parents]) for (const seed of ['0', '8', '912337']) {
            const sulfur = JSON.stringify(feature).includes('minecraft:sulfur');
            const w = world(p => state(p.y <= (feature.type === 'minecraft:large_dripstone' ? 10 : 17)
                || p.y >= (feature.type === 'minecraft:large_dripstone' ? 35 : 27) ? sulfur ? 'cinnabar' : 'stone' : 'air'));
            const random = kernel.random(seed);
            try {
                const succeeded = w.place(feature, random, feature.type === 'minecraft:speleothem' ? { ...origin, y: 18 } : origin);
                if (feature.type === 'minecraft:simple_random_selector') assert.equal(typeof succeeded, 'boolean', `${feature.type}, seed=${seed}`);
                else assert.equal(succeeded, true, `${feature.type}, seed=${seed}`);
                if (succeeded) assert.ok(w.writes.length > 0, `${feature.type}, seed=${seed}: no actual block writes`);
                assert.ok(w.writes.every(v => v.flags === 2));
                if (sulfur) assert.ok(w.writes.every(v => v.state.name === 'minecraft:sulfur' || v.state.name === 'minecraft:sulfur_spike'));
            } finally { random.dispose(); }
        }
    } finally { kernel.dispose(); }
});
