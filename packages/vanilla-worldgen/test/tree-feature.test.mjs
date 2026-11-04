import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfiguredFeaturePlacer } from '../features.mjs';
import { placeStraightBlobTree } from '../tree-feature.mjs';
import {
    placeAlterGroundDecorator,
    placeAttachedToLeavesDecorator,
    placeCocoaDecorator,
    placeCreakingHeartDecorator,
    placeLeaveVineDecorator,
    placeOnGroundDecorator,
    placePaleMossDecorator,
    placeShelfMushroomDecorator,
    placeTrunkVineDecorator
} from '../tree-decorators.mjs';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));

test('tree soil uses native rule-based optional providers without a caller sampling override', () => {
    const writes = [];
    const place = createConfiguredFeaturePlacer(data, { stateIdFor: () => 1, canSurvive: () => true,
        setBlock: (state, pos, flags) => writes.push({ state, pos, flags }) });
    assert.equal(place('minecraft:oak', data['data/minecraft/worldgen/feature/oak.json'], { x: 0, y: 10, z: 0 }, { nextInt: () => 0 }, {
        minY: 0, maxY: 128, isValidTreePos: () => true, isTreeFreePos: () => true, isVine: () => false,
        isAirOrLeaves: () => true, isWater: () => false,
        getBlockState: () => ({ name: 'minecraft:air', properties: {} }), isBlockInTag: () => false
    }), true);
    assert.deepEqual(writes.find(w => w.state.name === 'minecraft:dirt').pos, { x: 0, y: 9, z: 0 });
});

test('26.3 oak tree connects straight trunk, two-layer clearance, and blob foliage', () => {
    const world = new Map();
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    const writes = [];
    const stateAt = pos => world.get(key(pos)) ?? { name: 'minecraft:air', properties: {} };
    const isValidTreePos = pos => ['minecraft:air', 'minecraft:oak_leaves'].includes(stateAt(pos).name);
    const randomBounds = [];
    const random = { nextInt(bound) { randomBounds.push(bound); return bound === 3 ? 1 : 0; } };
    const place = createConfiguredFeaturePlacer(data, {
        stateIdFor: () => 1,
        canSurvive: () => true,
        setBlock(state, pos, flags) {
            writes.push({ state, pos, flags });
            world.set(key(pos), state);
        }
    });

    const result = place('minecraft:oak', data['data/minecraft/worldgen/feature/oak.json'], { x: 0, y: 10, z: 0 }, random, {
        minY: 0,
        maxY: 128,
        isValidTreePos,
        isTreeFreePos: pos => isValidTreePos(pos) || stateAt(pos).name === 'minecraft:oak_log',
        isVine: () => false,
        isAirOrLeaves: pos => ['minecraft:air', 'minecraft:oak_leaves'].includes(stateAt(pos).name),
        isWater: () => false,
        sampleOptionalBlockState(provider, pos) {
            assert.equal(provider, 'minecraft:soil_beneath_tree');
            assert.deepEqual(pos, { x: 0, y: 9, z: 0 });
            return { name: 'minecraft:dirt', stateId: 1, properties: {} };
        }
    });

    assert.equal(result, true);
    assert.deepEqual(randomBounds.slice(0, 2), [3, 1]);
    assert.ok(randomBounds.slice(2).every(bound => bound === 2));
    assert.equal(writes.find(write => write.state.name === 'minecraft:dirt').flags, 19);
    assert.equal(writes.filter(write => write.state.name === 'minecraft:oak_log').length, 5);
    assert.ok(writes.some(write => write.state.name === 'minecraft:oak_leaves'));
    assert.ok(writes.every(write => write.flags === 19));
});

test('26.3 imported acacia, bush, dark-oak, fancy oak, mega-jungle, mega pine, pine, spruce and azalea trees use their configured placers', () => {
    const place = createConfiguredFeaturePlacer(data, {
        stateIdFor: () => 1,
        canSurvive: () => true,
        setBlock: () => {}
    });
    const contexts = {
        minY: 0,
        maxY: 256,
        isValidTreePos: () => true,
        isTreeFreePos: () => true,
        isVine: () => false,
        isAirOrLeaves: () => true,
        isAir: () => true,
        isWater: () => false,
        isLog: () => true,
        canGrowThrough: () => true,
        sampleOptionalBlockState: () => ({ name: 'minecraft:dirt', stateId: 1, properties: {} })
    };
    const treeNames = ['acacia', 'jungle_bush', 'dark_oak', 'fancy_oak', 'mega_jungle_tree', 'mega_pine', 'mega_spruce', 'pine', 'spruce', 'azalea_tree'];
    for (const name of treeNames) {
        const config = data[`data/minecraft/worldgen/feature/${name}.json`];
        assert.equal(config?.type, 'minecraft:tree', `${name} resolves from the pinned JAR`);
        assert.equal(place(`minecraft:${name}`, config, { x: 0, y: 20, z: 0 }, {
            nextInt: bound => Math.max(0, bound - 1),
            nextFloat: () => 0,
            nextBoolean: () => true
        }, contexts), true, `${name} places its trunk and foliage`);
    }
});

test('26.3 mangrove configured tree raises its trunk, simulates roots, then places roots before its trunk', () => {
    const writes = [];
    const place = createConfiguredFeaturePlacer(data, {
        stateIdFor: (_name, properties) => properties.waterlogged === 'true' ? 2 : 1,
        canSurvive: () => true,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });
    const result = place('minecraft:mangrove', data['data/minecraft/worldgen/feature/mangrove.json'], { x: 0, y: 20, z: 0 }, {
        nextInt: () => 0,
        nextFloat: () => 0.99,
        nextBoolean: () => false
    }, {
        minY: 0,
        maxY: 128,
        isValidTreePos: pos => pos.y >= 10,
        isTreeFreePos: () => true,
        isVine: () => false,
        isAirOrLeaves: () => true,
        isWater: () => false,
        isAir: () => true,
        canGrowThrough: () => true,
        canMangroveRootGrowThrough: () => false,
        isMuddyRootsIn: () => false,
        sampleOptionalBlockState: () => ({ name: 'minecraft:dirt', stateId: 1, properties: {} })
    });

    assert.equal(result, true);
    const firstRoot = writes.findIndex(({ state }) => state.name === 'minecraft:mangrove_roots');
    const firstLog = writes.findIndex(({ state }) => state.name === 'minecraft:mangrove_log');
    assert.ok(firstRoot >= 0 && firstLog > firstRoot);
    assert.ok(writes.some(({ state, pos }) => state.name === 'minecraft:mangrove_roots' && pos.y < 20));
    assert.ok(writes.every(({ flags }) => flags === 19));
});

test('26.3 poplar tree connects shuffled trunk branches, foliage rows and provider-matched horizontal logs', () => {
    const world = new Map();
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    const writes = [];
    const leafState = { name: 'minecraft:oak_leaves', stateId: 2, properties: { distance: '7' } };
    const feature = {
        type: 'minecraft:tree',
        trunk_placer: {
            type: 'minecraft:poplar_trunk_placer', base_height: 4, height_rand_a: 0, height_rand_b: 0,
            trunk_height_above_branches: 1, branch_amount: 1
        },
        foliage_placer: {
            type: 'minecraft:poplar_foliage_placer', radius: 5, offset: 0, height: 5, side_hole_chance: 0
        },
        trunk_provider: 'trunk', foliage_provider: 'foliage',
        minimum_size: { type: 'minecraft:two_layers_feature_size', limit: 0, lower_size: 0, upper_size: 0 }
    };
    const result = placeStraightBlobTree(feature, { x: 0, y: 20, z: 0 }, {
        nextInt: () => 0, nextFloat: () => 0.5, nextBoolean: () => false
    }, {
        stateIdFor: (_name, properties) => properties.axis === 'x' ? 3 : properties.axis === 'z' ? 4 : 1,
        sampleState(provider) {
            return provider === 'trunk'
                ? { name: 'minecraft:oak_log', stateId: 1, properties: { axis: 'y' } }
                : leafState;
        },
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); world.set(key(pos), state); },
        context: {
            minY: 0, maxY: 128, isValidTreePos: () => true, isTreeFreePos: () => true,
            isVine: () => false, isAirOrLeaves: () => true, isWater: () => false,
            getBlockState: pos => world.get(key(pos)) ?? { name: 'minecraft:air' }
        }
    });
    assert.equal(result, true);
    assert.ok(writes.some(({ state, pos }) => state.name === 'minecraft:oak_log' && state.properties.axis === 'x' && pos.y === 24));
    assert.ok(writes.some(({ state }) => state.name === 'minecraft:oak_leaves'));
});

test('26.3 bee-tree decorator places a south-facing nest and stores vanilla bee ages', () => {
    const world = new Map();
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    const writes = [];
    const beeStores = [];
    const bounds = [];
    const random = {
        nextFloat: () => 0,
        nextInt(bound) { bounds.push(bound); return 0; }
    };
    const place = createConfiguredFeaturePlacer(data, {
        stateIdFor: (_name, properties) => properties.facing === 'south' ? 2 : 1,
        canSurvive: () => true,
        setBlock(state, pos, flags) {
            writes.push({ state, pos, flags });
            world.set(key(pos), state);
        }
    });
    const config = data['data/minecraft/worldgen/feature/oak_bees_005.json'];
    const result = place('minecraft:oak_bees_005', config, { x: 0, y: 10, z: 0 }, random, {
        minY: 0,
        maxY: 128,
        isValidTreePos: () => true,
        isTreeFreePos: () => true,
        isVine: () => false,
        isAirOrLeaves: () => true,
        isWater: () => false,
        isAir: () => true,
        hasBeeNestBlockEntity: () => true,
        storeBeeOccupants(pos, ages) { beeStores.push({ pos, ages }); },
        sampleOptionalBlockState: () => ({ name: 'minecraft:dirt', stateId: 1, properties: {} })
    });

    assert.equal(result, true);
    const nest = writes.find(write => write.state.name === 'minecraft:bee_nest');
    assert.ok(nest);
    assert.equal(nest.state.properties.facing, 'south');
    assert.equal(nest.flags, 19);
    assert.deepEqual(bounds.slice(-5), [3, 2, 2, 599, 599]);
    assert.equal(beeStores.length, 1);
    assert.equal(beeStores[0].ages.length, 2);
});

test('26.3 place_on_ground decorator samples top-leaf bounds and checks placement in vanilla order', () => {
    const events = [];
    const bounds = [];
    const random = { nextInt(bound) { bounds.push(bound); return bound - 1; } };
    const placed = placeOnGroundDecorator({
        type: 'minecraft:place_on_ground', tries: 2, radius: 1, height: 1,
        block_state_provider: { id: 'minecraft:leaf_litter' }
    }, [
        { x: 0, y: 5, z: 1 }, { x: 2, y: 5, z: 1 }, { x: 8, y: 6, z: 8 }
    ], random, {
        context: {
            isAirOrVine(pos) { events.push(['above', pos]); return events.filter(([name]) => name === 'above').length === 1; },
            isSolidRender(pos) { events.push(['solid-render', pos]); return true; },
            getMotionBlockingNoLeavesHeight(pos) { events.push(['heightmap', pos]); return 7; }
        },
        sampleState(provider, pos, source) {
            assert.equal(provider.id, 'minecraft:leaf_litter');
            assert.equal(source, random);
            events.push(['sample', pos]);
            return { name: 'minecraft:leaf_litter', stateId: 12, properties: {} };
        },
        setBlock(state, pos, flags) { events.push(['write', state, pos, flags]); }
    });

    assert.equal(placed, 1);
    assert.deepEqual(bounds, [5, 3, 3, 5, 3, 3]);
    assert.deepEqual(events.map(event => event[0]), ['above', 'solid-render', 'heightmap', 'sample', 'write', 'above']);
    assert.deepEqual(events[0][1], { x: 3, y: 7, z: 2 });
    assert.deepEqual(events[1][1], { x: 3, y: 6, z: 2 });
    assert.deepEqual(events[4].slice(2), [{ x: 3, y: 7, z: 2 }, 19]);
});

test('26.3 place_on_ground rejects an air base even when it is replaceable', () => {
    let sampled = false;
    const placed = placeOnGroundDecorator({ type: 'minecraft:place_on_ground', tries: 1, radius: 0, height: 0,
        block_state_provider: { id: 'minecraft:leaf_litter' } }, [{ x: 0, y: 5, z: 0 }], { nextInt: () => 0 }, {
        context: { isAirOrVine: () => true, isSolidRender: () => false,
            getMotionBlockingNoLeavesHeight: () => { assert.fail('Heightmap should not be read for a non-solid base'); } },
        sampleState() { sampled = true; return { name: 'minecraft:leaf_litter', stateId: 12, properties: {} }; },
        setBlock() { assert.fail('Leaf litter cannot be placed over an air base'); }
    });
    assert.equal(placed, 0);
    assert.equal(sampled, false);
});

test('26.3 imported oak leaf-litter tree places its configured decorator after foliage', () => {
    const writes = [];
    const place = createConfiguredFeaturePlacer(data, {
        stateIdFor: () => 1,
        canSurvive: () => true,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });
    const config = data['data/minecraft/worldgen/feature/oak_leaf_litter.json'];
    const result = place('minecraft:oak_leaf_litter', config, { x: 0, y: 10, z: 0 }, { nextInt: () => 0 }, {
        minY: 0,
        maxY: 128,
        isValidTreePos: () => true,
        isTreeFreePos: () => true,
        isVine: () => false,
        isAirOrLeaves: () => true,
        isWater: () => false,
        isAirOrVine: () => true,
        isSolidRender: () => true,
        isReplaceable: () => true,
        getMotionBlockingNoLeavesHeight: () => 0,
        sampleOptionalBlockState: () => ({ name: 'minecraft:dirt', stateId: 1, properties: {} })
    });

    assert.equal(result, true);
    const decoratorWrites = writes.slice(-config.decorators[0].tries);
    assert.equal(decoratorWrites.length, config.decorators[0].tries);
    assert.ok(decoratorWrites.every(write => write.state.name === 'minecraft:leaf_litter' && write.flags === 19));
});

test('26.3 trunk_vine decorator draws each side in west-east-north-south order', () => {
    const draws = [];
    const writes = [];
    const airChecks = [];
    const sequence = [1, 0, 2, 1];
    const placed = placeTrunkVineDecorator([{ x: 4, y: 12, z: 8 }], {
        nextInt(bound) { draws.push(bound); return sequence.shift(); }
    }, {
        context: { isAir(pos) { airChecks.push(pos); return true; } },
        stateIdFor: (_name, properties) => Object.values(properties).filter(value => value === 'true').length,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });

    assert.equal(placed, 3);
    assert.deepEqual(draws, [3, 3, 3, 3]);
    assert.deepEqual(airChecks, [
        { x: 3, y: 12, z: 8 }, { x: 4, y: 12, z: 7 }, { x: 4, y: 12, z: 9 }
    ]);
    assert.deepEqual(writes.map(({ state, pos, flags }) => [state.properties, pos, flags]), [
        [{ east: 'true', west: 'false', north: 'false', south: 'false', up: 'false' }, { x: 3, y: 12, z: 8 }, 19],
        [{ east: 'false', west: 'false', north: 'false', south: 'true', up: 'false' }, { x: 4, y: 12, z: 7 }, 19],
        [{ east: 'false', west: 'false', north: 'true', south: 'false', up: 'false' }, { x: 4, y: 12, z: 9 }, 19]
    ]);
});

test('26.3 leave_vine decorator rolls every leaf side and hangs vines at most four blocks', () => {
    const bounds = [];
    const writes = [];
    const airChecks = [];
    const placed = placeLeaveVineDecorator({ type: 'minecraft:leave_vine', probability: 1 }, [
        { x: 0, y: 10, z: 0 }
    ], { nextFloat() { bounds.push('float'); return 0; } }, {
        context: { isAir(pos) { airChecks.push(pos); return pos.y >= 6; } },
        stateIdFor: () => 5,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });

    assert.equal(placed, 16);
    assert.equal(bounds.length, 4);
    assert.deepEqual(writes.slice(0, 4).map(write => write.pos.y), [10, 9, 8, 7]);
    assert.deepEqual(writes.slice(0, 4).map(write => write.state.properties.east), ['true', 'true', 'true', 'true']);
    assert.deepEqual(writes.slice(4, 8).map(write => write.state.properties.west), ['true', 'true', 'true', 'true']);
    assert.equal(airChecks.filter(pos => pos.y === 6).length, 4);
    assert.ok(writes.every(write => write.state.name === 'minecraft:vine' && write.flags === 19));
});

test('26.3 cocoa decorator only checks the first three trunk layers and uses horizontal direction order', () => {
    const writes = [];
    const floats = [];
    const random = { nextFloat() { floats.push(true); return 0; }, nextInt: () => 2 };
    const placed = placeCocoaDecorator({ type: 'minecraft:cocoa', probability: 1 }, [
        { x: 0, y: 4, z: 0 }, { x: 0, y: 7, z: 0 }
    ], random, {
        context: { isAir: () => true },
        stateIdFor: () => 3,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });

    assert.equal(placed, 4);
    assert.equal(floats.length, 5);
    assert.deepEqual(writes.map(write => write.state.properties.facing), ['north', 'east', 'south', 'west']);
    assert.deepEqual(writes.map(write => write.state.properties.age), ['2', '2', '2', '2']);
    assert.ok(writes.every(write => write.flags === 19));
});

test('26.3 shelf_mushroom decorator selects perpendicular sides and places only one per standing log', () => {
    const writes = [];
    const bounds = [];
    const floats = [];
    const random = {
        nextFloat() { floats.push(0); return 0; },
        nextInt(bound) { bounds.push(bound); return 0; }
    };
    const placed = placeShelfMushroomDecorator({ type: 'minecraft:shelf_mushroom', probability: 1 }, [
        { x: 0, y: 10, z: 0 }, { x: 0, y: 11, z: 0 }, { x: 0, y: 12, z: 0 }
    ], random, {
        context: {
            isReplaceable: () => true,
            isWaterOrWaterNearby: () => false,
            hasShelfMushroomAt: () => false
        },
        stateIdFor: () => 4,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });

    assert.equal(placed, 2);
    assert.deepEqual(bounds, [4, 2, 2]);
    assert.deepEqual(floats, [0, 0, 0]);
    assert.deepEqual(writes.map(write => [write.pos, write.state.properties]), [
        [{ x: 0, y: 11, z: -1 }, { age: '0', facing: 'north' }],
        [{ x: 0, y: 12, z: -1 }, { age: '0', facing: 'north' }]
    ]);
});

test('26.3 attached_to_leaves decorator shuffles, checks air distance, and excludes nearby targets', () => {
    const bounds = [];
    const writes = [];
    const random = { nextInt(bound) { bounds.push(bound); return 0; }, nextFloat: () => 0 };
    const placed = placeAttachedToLeavesDecorator({
        type: 'minecraft:attached_to_leaves', probability: 1,
        exclusion_radius_xz: 0, exclusion_radius_y: 0, required_empty_blocks: 2,
        block_provider: { id: 'minecraft:mangrove_propagule' }, directions: ['down']
    }, [{ x: 0, y: 10, z: 0 }, { x: 3, y: 10, z: 0 }], random, {
        context: { isAir: () => true },
        sampleState: provider => ({ name: provider.id, stateId: 6, properties: {} }),
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });

    assert.equal(placed, 2);
    assert.deepEqual(bounds, [2, 1, 1]);
    assert.deepEqual(writes.map(write => write.pos), [{ x: 3, y: 9, z: 0 }, { x: 0, y: 9, z: 0 }]);
    assert.ok(writes.every(write => write.state.name === 'minecraft:mangrove_propagule' && write.flags === 19));
});

test('26.3 alter_ground decorator places provider states in the vanilla ring and scan order', () => {
    const bounds = [];
    const writes = [];
    const samples = [];
    const placed = placeAlterGroundDecorator({ type: 'minecraft:alter_ground', provider: 'minecraft:podzol_beneath_tree' }, [
        { x: 0, y: 10, z: 0 }, { x: 0, y: 11, z: 0 }
    ], { nextInt(bound) { bounds.push(bound); return 0; } }, {
        context: { isAir: () => true },
        sampleOptionalState(provider, pos) {
            samples.push([provider, pos]);
            return { name: 'minecraft:podzol', stateId: 7, properties: {} };
        },
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });

    assert.equal(placed, 189);
    assert.deepEqual(bounds, [64, 64, 64, 64, 64]);
    assert.deepEqual(samples[0], ['minecraft:podzol_beneath_tree', { x: -3, y: 12, z: -2 }]);
    assert.ok(writes.every(write => write.state.name === 'minecraft:podzol' && write.flags === 19));
});

test('26.3 pale_moss decorator invokes the configured patch and builds stochastic hanging tips', () => {
    const writes = [];
    const patches = [];
    const floats = [0, 0, 0.25, 0, 0.75, 0.25];
    const placed = placePaleMossDecorator({
        type: 'minecraft:pale_moss', ground_probability: 1,
        trunk_probability: 1, leaves_probability: 1
    }, [{ x: 2, y: 10, z: 3 }], [{ x: 2, y: 12, z: 3 }], {
        nextInt: () => 0,
        nextFloat() { return floats.shift(); }
    }, {
        context: { isAir: () => true },
        stateIdFor: () => 8,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); },
        placeFeature(name, pos) { patches.push({ name, pos }); }
    });

    assert.equal(placed, 3);
    assert.deepEqual(patches, [{ name: 'minecraft:pale_moss_patch', pos: { x: 2, y: 11, z: 3 } }]);
    assert.deepEqual(writes.map(write => [write.state.properties.tip, write.pos.y]), [['true', 9], ['false', 11], ['true', 10]]);
    assert.equal(floats.length, 0);
});

test('26.3 creaking_heart decorator shuffles candidates and requires a six-sided log surround', () => {
    const writes = [];
    const checks = [];
    const placed = placeCreakingHeartDecorator({ type: 'minecraft:creaking_heart', probability: 1 }, [
        { x: 0, y: 10, z: 0 }, { x: 0, y: 11, z: 0 }
    ], { nextFloat: () => 0, nextInt: () => 0 }, {
        context: { isLog(pos) { checks.push(pos); return true; } },
        stateIdFor: (_name, properties) => properties.axis === 'y' && properties.state === 'dormant' && properties.natural === 'true' ? 9 : -1,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });

    assert.deepEqual(placed, { x: 0, y: 11, z: 0 });
    assert.equal(checks.length, 6);
    assert.deepEqual(writes[0].state.properties, { axis: 'y', natural: 'true', state: 'dormant' });
    assert.equal(writes[0].flags, 19);
});

test('tree feature refuses unsupported decorators and missing world adapters', () => {
    const place = createConfiguredFeaturePlacer(data, {
        stateIdFor: () => 1,
        canSurvive: () => true,
        setBlock: () => {}
    });
    const decorated = data['data/minecraft/worldgen/feature/oak.json'];
    assert.throws(() => place('oak', { ...decorated, decorators: [{ type: 'minecraft:unsupported' }] }, { x: 0, y: 0, z: 0 }, { nextInt: () => 0 }, {}), /unsupported decorator/);
    assert.throws(() => place('oak', decorated, { x: 0, y: 0, z: 0 }, { nextInt: () => 0 }, {}), /context.isValidTreePos/);
});
