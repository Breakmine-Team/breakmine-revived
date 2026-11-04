import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBlockStateProviderSampler, createConfiguredFeaturePlacer, placeSimpleBlock } from '../features.mjs';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));

test('simple-block providers resolve fixed states and referenced block-state resources', () => {
    const sampler = createBlockStateProviderSampler(data, {
        stateIdFor: (name, properties) => name === 'minecraft:stone' ? 1 : name === 'minecraft:cave_vines_plant' ? (properties.berries === 'true' ? 3 : 2) : null,
        random: { nextInt: () => 4 }
    });
    assert.deepEqual(sampler.sample({ id: 'minecraft:stone' }, { x: 0, y: 1, z: 0 }), {
        stateId: 1, name: 'minecraft:stone', properties: {}
    });
    assert.equal(sampler.sample('minecraft:cave_vines_body', { x: 0, y: 1, z: 0 }).stateId, 3);
    assert.throws(() => sampler.sample('minecraft:missing_provider', {}), /Missing vanilla block-state provider/);
});

test('configured scattered-ore features reach the ore executor', () => {
    const place = createConfiguredFeaturePlacer(data, { stateIdFor: () => 1, canSurvive: () => true, setBlock() {} });
    assert.equal(place('<fixture>', { type: 'minecraft:scattered_ore', size: 0, targets: [] },
        { x: 0, y: 8, z: 0 }, { nextInt: bound => { assert.equal(bound, 1); return 0; } },
        { getBlockState: () => ({ name: 'minecraft:stone', properties: {} }) }), true);
});

test('weighted and randomized-int providers preserve bounded random choices and properties', () => {
    const draws = [];
    const sampler = createBlockStateProviderSampler(data, {
        stateIdFor: (name, properties) => name === 'minecraft:grass_block'
            ? Number(properties.snowy === 'true' ? 20 : 10)
            : name === 'minecraft:sea_pickle' ? Number(properties.pickles) : null,
        random: { nextInt(bound) { draws.push(bound); return bound - 1; } }
    });
    const weighted = sampler.sample({ type: 'minecraft:weighted', entries: [
        { data: 'minecraft:grass_block', weight: 1 },
        { data: { id: 'minecraft:grass_block', properties: { snowy: 'true' } }, weight: 2 }
    ] }, {});
    assert.equal(weighted.stateId, 20);
    const randomized = sampler.sample({
        type: 'minecraft:randomized_int',
        property: 'pickles',
        source: { id: 'minecraft:sea_pickle', properties: { pickles: '1' } },
        values: { type: 'minecraft:uniform', min_inclusive: 1, max_inclusive: 4 }
    }, {});
    assert.equal(randomized.stateId, 4);
    assert.deepEqual(draws, [3, 4]);
    assert.throws(() => sampler.sample({ type: 'minecraft:noise', states: ['minecraft:stone'] }, {}), /Malformed noise block-state provider/);
});

test('26.3 noise block-state provider selects a registered state from positional noise without feature RNG', () => {
    const samples = [];
    const states = ['minecraft:dandelion', 'minecraft:poppy', 'minecraft:allium'];
    const provider = { type: 'minecraft:noise', seed: 2345,
        noise: { base_octave: 0, base_amplitude: 0.955388882960065 }, scale: 0.020833334, states };
    const sampler = createBlockStateProviderSampler(data, {
        stateIdFor: name => states.indexOf(name) + 10,
        random: { nextInt: () => assert.fail('noise provider must not consume feature RNG') },
        context: { sampleNoiseProvider(value, pos) {
            assert.equal(value, provider);
            samples.push(pos);
            return 0.2;
        } }
    });
    const result = sampler.sample(provider, { x: 7, y: 68, z: -11 });
    assert.equal(result.name, 'minecraft:poppy');
    assert.deepEqual(samples, [{ x: 7, y: 68, z: -11 }]);
});

test('26.3 flower_flower_forest imported provider resolves through native positional noise', () => {
    const provider = data['data/minecraft/worldgen/block_state_provider/flower_flower_forest.json'];
    assert.equal(provider?.type, 'minecraft:noise');
    const position = { x: 48, y: 71, z: -33 };
    const chosen = provider.states[Math.floor(provider.states.length / 2)];
    let sampled = false;
    const sampler = createBlockStateProviderSampler(data, {
        stateIdFor: (name, properties) => name === chosen && Object.keys(properties).length === 0 ? 72 : null,
        random: { nextInt: () => assert.fail('positional noise provider must not consume feature RNG') },
        context: { sampleNoiseProvider(value, pos) {
            assert.equal(value, provider);
            assert.deepEqual(pos, position);
            sampled = true;
            return 0;
        } }
    });

    const result = sampler.sample(provider, position);
    assert.equal(sampled, true);
    assert.equal(result.name, chosen);
    assert.equal(result.stateId, 72);
});

test('noise-threshold provider uses positional noise and makes only the selected state draws', () => {
    const draws = [];
    let noise = -0.9, roll = 0.2;
    const states = new Map([['minecraft:dandelion', 1], ['minecraft:poppy', 2], ['minecraft:orange_tulip', 3]]);
    const sampler = createBlockStateProviderSampler(data, {
        stateIdFor: name => states.get(name) ?? null,
        random: { nextFloat: () => { draws.push('float'); return roll; }, nextInt: bound => { draws.push(bound); return bound - 1; } },
        context: { sampleNoiseProvider(provider, pos) {
            assert.equal(provider.type, 'minecraft:noise_threshold');
            assert.deepEqual(pos, { x: 32, y: 65, z: -8 });
            return noise;
        } }
    });
    const provider = { type: 'minecraft:noise_threshold', noise: { base_octave: 0, base_amplitude: 0.95 }, scale: 0.005,
        threshold: -0.8, high_chance: 0.333, default_state: 'minecraft:dandelion',
        low_states: ['minecraft:orange_tulip'], high_states: ['minecraft:poppy'] };
    const pos = { x: 32, y: 65, z: -8 };
    assert.equal(sampler.sample(provider, pos).stateId, 1);
    assert.deepEqual(draws, []);
    noise = -0.7;
    assert.equal(sampler.sample(provider, pos).stateId, 2);
    assert.deepEqual(draws, ['float', 1]);
    noise = 0.1;
    roll = 0.9;
    assert.equal(sampler.sample(provider, pos).stateId, 3);
    assert.deepEqual(draws, ['float', 1, 'float', 1]);
});

test('dual-noise provider builds the vanilla slow-noise candidate set and selects it with base noise', () => {
    const calls = [];
    const states = ['minecraft:dandelion', 'minecraft:poppy', 'minecraft:azure_bluet', 'minecraft:allium'];
    const provider = { type: 'minecraft:dual_noise', seed: 2345, variety: [1, 3], scale: 1,
        slow_scale: 1, noise: { base_octave: -3 }, slow_noise: { base_octave: -10 }, states };
    let slowIndex = 0;
    const sampler = createBlockStateProviderSampler(data, {
        stateIdFor: name => states.indexOf(name) + 1,
        random: { nextInt: () => assert.fail('dual-noise provider must not consume feature RNG') },
        context: { sampleDualNoiseProvider(_provider, pos, channel) {
            calls.push([channel, pos.x, pos.y, pos.z]);
            if (channel === 'slow') return [1, -1, -0.5, 0, 0.75][slowIndex++];
            return 0.75;
        } }
    });
    const result = sampler.sample(provider, { x: 8, y: 64, z: -2 });
    assert.equal(result.name, 'minecraft:allium');
    assert.deepEqual(calls, [
        ['slow', 8, 64, -2],
        ['slow', 8, 64, -2],
        ['slow', 54553, 64, 34232],
        ['slow', 109098, 64, 68466],
        ['slow', 163643, 64, 102700],
        ['fast', 8, 64, -2]
    ]);
});

test('simple-block feature follows state selection, survival, placement flags and scheduled ticks', () => {
    const calls = [];
    const state = { name: 'minecraft:closed_eyeblossom' };
    const placed = placeSimpleBlock({ type: 'minecraft:simple_block', schedule_tick: true, to_place: 'minecraft:closed_eyeblossom' }, { x: 1, y: 2, z: 3 }, {
        sampleState: provider => { calls.push(['sample', provider]); return state; },
        canSurvive: (value, position) => { calls.push(['survive', value, position]); return true; },
        setBlock: (value, position, flags) => calls.push(['set', value, position, flags]),
        scheduleTick: (value, position, delay) => calls.push(['tick', value, position, delay])
    });
    assert.equal(placed, true);
    assert.deepEqual(calls.map(call => call[0]), ['sample', 'survive', 'set', 'tick']);
    assert.equal(calls[2][3], 2);
    assert.equal(calls[3][3], 1);

    const failed = placeSimpleBlock({ type: 'minecraft:simple_block', to_place: 'minecraft:stone' }, { x: 0, y: 0, z: 0 }, {
        sampleState: () => state,
        canSurvive: () => false,
        setBlock: () => assert.fail('should not place')
    });
    assert.equal(failed, false);
});

test('26.3 selectors retain their draw order and invoke the selected nested placed feature', () => {
    const cases = [
        {
            type: 'minecraft:random_selector',
            feature: { default: { feature: { type: 'minecraft:probe', id: 'default' }, placement: [] }, features: [
                { chance: 0.3, feature: { feature: { type: 'minecraft:probe', id: 'first' }, placement: [] } },
                { chance: 0.7, feature: { feature: { type: 'minecraft:probe', id: 'second' }, placement: [] } }
            ] },
            random: { values: [0.5, 0.2], nextFloat() { return this.values.shift(); } },
            expected: 'second', calls: 2
        },
        {
            type: 'minecraft:simple_random_selector',
            feature: { features: ['first', 'second', 'third'].map(id => ({ feature: { type: 'minecraft:probe', id }, placement: [] })) },
            random: { nextInt(bound) { assert.equal(bound, 3); return 1; } },
            expected: 'second', calls: 1
        },
        {
            type: 'minecraft:weighted_random_selector',
            feature: { features: [
                { data: { feature: { type: 'minecraft:probe', id: 'light' }, placement: [] }, weight: 2 },
                { data: { feature: { type: 'minecraft:probe', id: 'heavy' }, placement: [] }, weight: 5 }
            ] },
            random: { nextInt(bound) { assert.equal(bound, 7); return 2; } },
            expected: 'heavy', calls: 1
        },
        {
            type: 'minecraft:random_boolean_selector',
            feature: {
                feature_true: { feature: { type: 'minecraft:probe', id: 'true' }, placement: [] },
                feature_false: { feature: { type: 'minecraft:probe', id: 'false' }, placement: [] }
            },
            random: { nextBoolean: () => true },
            expected: 'true', calls: 1
        }
    ];
    for (const entry of cases) {
        const selected = [];
        let draws = 0;
        const random = new Proxy(entry.random, {
            get(target, key) {
                const value = target[key];
                if (key === 'nextInt' && typeof value !== 'function') return () => 0;
                if (typeof value !== 'function') return value;
                return (...args) => { draws++; return value.apply(target, args); };
            }
        });
        const place = createConfiguredFeaturePlacer({
            'data/minecraft/worldgen/feature/test.json': entry.feature
        }, {
            stateIdFor: () => 1,
            canSurvive: () => true,
            setBlock: () => {},
            handlers: { 'minecraft:probe': (_name, feature) => { selected.push(feature.id); return true; } }
        });
        assert.equal(place('minecraft:test', { ...entry.feature, type: entry.type }, { x: 0, y: 10, z: 0 }, random, {}), true);
        assert.deepEqual(selected, [entry.expected], entry.type);
        assert.equal(draws, entry.calls, entry.type);
    }
});

test('26.3 vegetation patch follows radius, edge, surface, depth and nested vegetation order', () => {
    const world = new Map();
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    const writes = [];
    let edgeDraws = 0, vegetationDraws = 0, radiusDraws = 0;
    const random = {
        nextInt(bound) { assert.equal(bound, 1); radiusDraws++; return 0; },
        nextFloat() {
            if (edgeDraws < 4) { edgeDraws++; return 0; }
            vegetationDraws++;
            return 0;
        }
    };
    const getBlockState = pos => world.get(key(pos)) || (pos.y === 10
        ? { name: 'minecraft:air' }
        : { name: 'minecraft:dirt' });
    const placer = createConfiguredFeaturePlacer(data, {
        stateIdFor: name => name === 'minecraft:stone' ? 1 : name === 'minecraft:short_grass' ? 2 : 3,
        canSurvive: () => true,
        setBlock(state, pos, flags) {
            assert.equal(flags, 2);
            world.set(key(pos), state);
            writes.push([state.name, pos]);
        }
    });
    const result = placer('minecraft:test_patch', {
        type: 'minecraft:vegetation_patch',
        replaceable: '#minecraft:test_replaceable',
        ground_state: { id: 'minecraft:stone' },
        vegetation_feature: {
            feature: { type: 'minecraft:simple_block', to_place: { id: 'minecraft:short_grass' } },
            placement: []
        },
        surface: 'floor', depth: 1, extra_bottom_block_chance: 0,
        vertical_range: 4, vegetation_chance: 1,
        xz_radius: { type: 'minecraft:uniform', min_inclusive: 0, max_inclusive: 0 },
        extra_edge_column_chance: 1
    }, { x: 0, y: 10, z: 0 }, random, {
        getBlockState,
        isAir: pos => getBlockState(pos).name === 'minecraft:air',
        isEmptyBlock: pos => getBlockState(pos).name === 'minecraft:air',
        matchesBlockTag: (state, tag) => tag === '#minecraft:test_replaceable' && state.name === 'minecraft:dirt',
        isFaceSturdy: () => true
    });
    assert.equal(result, true);
    assert.equal(radiusDraws, 2);
    assert.equal(edgeDraws, 4);
    assert.equal(vegetationDraws, 5);
    assert.equal(writes.filter(([name]) => name === 'minecraft:stone').length, 5);
    assert.equal(writes.filter(([name]) => name === 'minecraft:short_grass').length, 5);
    assert.ok(writes.some(([name, pos]) => name === 'minecraft:short_grass' && pos.y === 10));
});

test('26.3 waterlogged vegetation patches fill enclosed ground and waterlog successful plants', () => {
    const world = new Map();
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    const writes = [];
    const planted = [];
    let edgeDraws = 0;
    const random = {
        nextInt(bound) { assert.equal(bound, 1); return 0; },
        nextFloat() { edgeDraws++; return 0; }
    };
    const getBlockState = pos => world.get(key(pos)) || (pos.y === 10
        ? { name: 'minecraft:air' }
        : { name: 'minecraft:dirt' });
    const place = createConfiguredFeaturePlacer(data, {
        stateIdFor: name => name === 'minecraft:clay' ? 1 : 2,
        canSurvive: () => true,
        setBlock(state, pos, flags) {
            assert.equal(flags, 2);
            world.set(key(pos), state);
            writes.push({ state, pos });
        },
        handlers: {
            'minecraft:probe'(_name, _feature, pos) {
                planted.push(pos);
                world.set(key(pos), { name: 'minecraft:dripleaf', properties: { waterlogged: false } });
                return true;
            }
        }
    });
    const result = place('minecraft:clay_pool_with_dripleaves', {
        type: 'minecraft:waterlogged_vegetation_patch',
        replaceable: '#minecraft:test_replaceable',
        ground_state: { id: 'minecraft:clay' },
        vegetation_feature: { feature: { type: 'minecraft:probe' }, placement: [] },
        surface: 'floor', depth: 1, extra_bottom_block_chance: 0,
        vertical_range: 4, vegetation_chance: 1,
        xz_radius: { type: 'minecraft:uniform', min_inclusive: 0, max_inclusive: 0 },
        extra_edge_column_chance: 1
    }, { x: 0, y: 10, z: 0 }, random, {
        getBlockState,
        isAir: pos => getBlockState(pos).name === 'minecraft:air',
        isEmptyBlock: pos => getBlockState(pos).name === 'minecraft:air',
        matchesBlockTag: (state, tag) => tag === '#minecraft:test_replaceable' && state.name === 'minecraft:dirt',
        isFaceSturdy: (_state, pos, face) => !(pos.x + face.x === 1 && pos.y + face.y === 9 && pos.z + face.z === 0),
        getWaterState: () => ({ name: 'minecraft:water' }),
        hasProperty: (state, property) => Object.hasOwn(state?.properties ?? {}, property),
        getProperty: (state, property) => state.properties[property],
        withProperty: (state, property, value) => ({ ...state, properties: { ...state.properties, [property]: value } })
    });

    assert.equal(result, true);
    assert.equal(edgeDraws, 8);
    assert.equal(writes.filter(write => write.state.name === 'minecraft:water').length, 4);
    assert.equal(planted.length, 4);
    assert.ok(planted.every(pos => pos.y === 9));
    assert.equal([...world.values()].filter(state => state.name === 'minecraft:dripleaf' && state.properties.waterlogged).length, 4);
    assert.equal(world.get('1,9,0').name, 'minecraft:clay');
    assert.equal(world.get('0,9,0').properties.waterlogged, true);
});
