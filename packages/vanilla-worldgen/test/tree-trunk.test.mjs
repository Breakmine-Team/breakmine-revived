import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../generated/vanilla-data.json' with { type: 'json' };
import {
    placeBendingTrunk,
    placeCherryTrunk,
    placeDarkOakTrunk,
    placeForkingTrunk,
    placeFancyTrunk,
    placeGiantTrunk,
    placeMegaJungleTrunk,
    placePoplarTrunk,
    placeStraightTrunk,
    placeUpwardsBranchingTrunk,
    sampleTrunkHeight
} from '../tree-trunk.mjs';

test('26.3 straight trunk height consumes both bounded draws in base-height order', () => {
    const bounds = [];
    const values = [2, 0];
    const height = sampleTrunkHeight({
        type: 'minecraft:straight_trunk_placer', base_height: 4, height_rand_a: 2, height_rand_b: 0
    }, { nextInt(bound) { bounds.push(bound); return values.shift(); } });
    assert.equal(height, 6);
    assert.deepEqual(bounds, [3, 1]);
});

test('26.3 straight trunk places optional below block, valid logs, and top attachment', () => {
    const sampled = [];
    const writes = [];
    const tree = {
        trunk_provider: { id: 'minecraft:oak_log' },
        below_trunk_provider: 'minecraft:soil_beneath_tree',
        trunk_placer: { type: 'minecraft:straight_trunk_placer', base_height: 4, height_rand_a: 2, height_rand_b: 0 }
    };
    const attachments = placeStraightTrunk(tree, { x: 5, y: 10, z: -2 }, 4, {}, {
        sampleBelowTrunkState(provider, pos) {
            sampled.push([provider, pos]);
            return { name: 'minecraft:podzol' };
        },
        sampleTrunkState(provider, pos) {
            sampled.push([provider, pos]);
            return { name: 'minecraft:oak_log' };
        },
        isValidTreePos: pos => pos.y !== 12,
        setBlock: (state, pos, flags) => writes.push({ state, pos, flags })
    });
    assert.deepEqual(writes.map(write => [write.state.name, write.pos.y, write.flags]), [
        ['minecraft:podzol', 9, 19], ['minecraft:oak_log', 10, 19],
        ['minecraft:oak_log', 11, 19], ['minecraft:oak_log', 13, 19]
    ]);
    assert.equal(sampled.length, 4);
    assert.deepEqual(attachments, [{ position: { x: 5, y: 14, z: -2 }, radius: 0, doubleTrunk: false }]);
});

test('26.3 forking trunk retains branch draws, successful endpoints, and distinct direction handling', () => {
    const bounds = [];
    const writes = [];
    const values = [0, 0, 2, 1, 0, 0];
    const tree = {
        trunk_provider: { id: 'minecraft:oak_log' },
        trunk_placer: { type: 'minecraft:forking_trunk_placer' }
    };
    const attachments = placeForkingTrunk(tree, { x: 0, y: 10, z: 0 }, 5, {
        nextInt(bound) { bounds.push(bound); return values.shift(); }
    }, {
        sampleTrunkState: () => ({ name: 'minecraft:oak_log' }),
        isValidTreePos: () => true,
        setBlock: (state, pos) => writes.push(pos)
    });

    assert.deepEqual(bounds, [4, 4, 3, 4, 2, 3]);
    assert.deepEqual(writes, [
        { x: 0, y: 10, z: 0 }, { x: 0, y: 11, z: 0 }, { x: 0, y: 12, z: 0 },
        { x: 0, y: 13, z: 0 }, { x: 0, y: 14, z: -1 }, { x: 1, y: 13, z: 0 }
    ]);
    assert.deepEqual(attachments, [
        { position: { x: 0, y: 15, z: -1 }, radiusOffsetXZ: 1, foliageHeightOffset: 0, doubleTrunk: false },
        { position: { x: 1, y: 14, z: 0 }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false }
    ]);
});

test('26.3 bending trunk keeps per-layer direction gates and inclusive bend length', () => {
    const bounds = [];
    const writes = [];
    const tree = {
        trunk_provider: { id: 'minecraft:oak_log' },
        trunk_placer: {
            type: 'minecraft:bending_trunk_placer', min_height_for_leaves: 1,
            bend_length: { type: 'minecraft:uniform', min_inclusive: 1, max_inclusive: 1 }
        }
    };
    const attachments = placeBendingTrunk(tree, { x: 0, y: 5, z: 0 }, 3, {
        nextInt(bound) { bounds.push(bound); return bound === 4 ? 1 : 0; }
    }, {
        sampleTrunkState: () => ({ name: 'minecraft:oak_log' }),
        isValidTreePos: () => true,
        setBlock: (state, pos) => writes.push(pos)
    });

    assert.deepEqual(bounds, [4, 2, 2, 2, 1]);
    assert.deepEqual(writes, [
        { x: 0, y: 5, z: 0 }, { x: 1, y: 6, z: 0 }, { x: 2, y: 7, z: 0 },
        { x: 2, y: 8, z: 0 }, { x: 3, y: 8, z: 0 }
    ]);
    assert.equal(attachments.length, 4);
});

test('26.3 giant trunk places four roots and a double-width trunk in vanilla order', () => {
    const writes = [];
    const below = [];
    const tree = {
        trunk_provider: { id: 'minecraft:dark_oak_log' },
        below_trunk_provider: 'minecraft:soil_beneath_tree',
        trunk_placer: { type: 'minecraft:giant_trunk_placer' }
    };
    const attachments = placeGiantTrunk(tree, { x: 3, y: 8, z: 4 }, 2, { nextInt: () => 0 }, {
        sampleTrunkState: () => ({ name: 'minecraft:dark_oak_log' }),
        sampleBelowTrunkState: (_provider, pos) => { below.push(pos); return { name: 'minecraft:dirt' }; },
        isValidTreePos: () => true,
        isLog: () => false,
        setBlock: (state, pos) => writes.push([state.name, pos])
    });

    assert.deepEqual(below, [
        { x: 3, y: 7, z: 4 }, { x: 4, y: 7, z: 4 },
        { x: 3, y: 7, z: 5 }, { x: 4, y: 7, z: 5 }
    ]);
    assert.deepEqual(writes.slice(4).map(([, pos]) => pos), [
        { x: 3, y: 8, z: 4 }, { x: 4, y: 8, z: 4 }, { x: 4, y: 8, z: 5 }, { x: 3, y: 8, z: 5 },
        { x: 3, y: 9, z: 4 }
    ]);
    assert.deepEqual(attachments[0], { position: { x: 3, y: 10, z: 4 }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: true });
});

test('26.3 upwards branching trunk requires its tag adapter and keeps last trunk attachment', () => {
    const floats = [];
    const writes = [];
    const tree = {
        trunk_provider: { id: 'minecraft:mangrove_log' },
        trunk_placer: {
            type: 'minecraft:upwards_branching_trunk_placer',
            extra_branch_steps: { type: 'minecraft:uniform', min_inclusive: 1, max_inclusive: 1 },
            extra_branch_length: { type: 'minecraft:uniform', min_inclusive: 0, max_inclusive: 1 },
            place_branch_per_log_probability: 0
        }
    };
    const attachments = placeUpwardsBranchingTrunk(tree, { x: 0, y: 2, z: 0 }, 3, {
        nextFloat() { floats.push(0); return 0; }, nextInt: () => 0
    }, {
        sampleTrunkState: () => ({ name: 'minecraft:mangrove_log' }),
        isValidTreePos: () => true,
        canGrowThrough: () => false,
        setBlock: (state, pos) => writes.push(pos)
    });

    assert.deepEqual(writes, [{ x: 0, y: 2, z: 0 }, { x: 0, y: 3, z: 0 }, { x: 0, y: 4, z: 0 }]);
    assert.equal(floats.length, 2);
    assert.deepEqual(attachments, [{ position: { x: 0, y: 5, z: 0 }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false }]);
});

test('26.3 dark-oak trunk places the bent 2x2 stem and shuffled perimeter branches', () => {
    const writes = [];
    const bounds = [];
    const tree = {
        trunk_placer: { type: 'minecraft:dark_oak_trunk_placer' },
        trunk_provider: { id: 'minecraft:dark_oak_log' }
    };
    const attachments = placeDarkOakTrunk(tree, { x: 4, y: 12, z: -3 }, 4, {
        nextInt(bound) { bounds.push(bound); return 0; }
    }, {
        sampleTrunkState: () => ({ name: 'minecraft:dark_oak_log' }),
        isValidTreePos: () => true,
        setBlock(state, pos) { writes.push({ state, pos }); }
    });
    assert.deepEqual(bounds.slice(0, 3), [4, 4, 3]);
    assert.equal(writes.filter(write => write.pos.y >= 12 && write.pos.y < 16).length, 40);
    assert.equal(attachments[0].doubleTrunk, true);
    assert.equal(attachments.length, 13);
});

test('26.3 mega-jungle trunk reuses giant placement and adds sampled surface roots', () => {
    const writes = [];
    const bounds = [];
    const tree = {
        trunk_placer: { type: 'minecraft:mega_jungle_trunk_placer' },
        trunk_provider: { id: 'minecraft:jungle_log' }
    };
    const attachments = placeMegaJungleTrunk(tree, { x: 0, y: 10, z: 0 }, 8, {
        nextInt(bound) { bounds.push(bound); return 0; },
        nextFloat: () => 0
    }, {
        sampleTrunkState: () => ({ name: 'minecraft:jungle_log' }),
        isValidTreePos: () => true,
        isLog: () => false,
        setBlock(state, pos) { writes.push({ state, pos }); }
    });
    assert.equal(bounds[0], 4);
    assert.equal(writes.filter(write => write.pos.y >= 10 && write.pos.y < 17).length, 33);
    assert.ok(writes.some(write => write.pos.y === 13));
    assert.ok(attachments.some(attachment => attachment.foliageHeightOffset === -2));
});

test('26.3 fancy oak trunk checks branch limbs, writes oriented logs, and returns trimmed foliage points', () => {
    const writes = [];
    const tree = {
        trunk_provider: 'oak_log',
        trunk_placer: { type: 'minecraft:fancy_trunk_placer' }
    };
    const attachments = placeFancyTrunk(tree, { x: 0, y: 10, z: 0 }, 8, {
        nextFloat: () => 0.5, nextInt: () => 0
    }, {
        sampleTrunkState: () => ({ name: 'minecraft:oak_log', stateId: 1, properties: { axis: 'y' } }),
        stateIdFor: (_name, properties) => properties.axis === 'y' ? 1 : 2,
        isValidTreePos: () => true,
        setBlock(state, pos) { writes.push({ state, pos }); }
    });

    assert.ok(writes.some(({ state }) => state.properties.axis === 'y'));
    assert.ok(writes.some(({ state }) => state.properties.axis !== 'y'));
    assert.ok(attachments.length > 1);
    assert.ok(attachments.every(({ position }) => position.y >= 10));
});

test('26.3 cherry trunk builds sampled branches and rotates horizontal logs on the block state', () => {
    const writes = [];
    const tree = {
        trunk_provider: { id: 'minecraft:cherry_log' },
        trunk_placer: {
            type: 'minecraft:cherry_trunk_placer',
            branch_start_offset_from_top: { type: 'minecraft:uniform', min_inclusive: 0, max_inclusive: 0 },
            second_branch_start_offset_from_top: 0,
            branch_count: 1,
            branch_end_offset_from_top: 0,
            branch_horizontal_length: 2
        }
    };
    const attachments = placeCherryTrunk(tree, { x: 4, y: 10, z: 7 }, 4, {
        nextInt: bound => bound === 1 ? 0 : 1,
        nextFloat: () => 0.5
    }, {
        sampleTrunkState: () => ({ name: 'minecraft:cherry_log', stateId: 1, properties: { axis: 'y' } }),
        stateIdFor: (_name, properties) => properties.axis === 'y' ? 1 : 2,
        isValidTreePos: () => true,
        setBlock: (state, pos) => writes.push({ axis: state.properties.axis, pos })
    });
    assert.equal(writes.filter(write => write.axis === 'y').length, 4);
    assert.ok(writes.some(write => write.axis === 'x' && write.pos.x > 4));
    assert.deepEqual(attachments, [{ position: { x: 6, y: 14, z: 7 }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false }]);
});

test('pinned 26.3 cherry tree config omits the second offset and derives its range from the first offset', () => {
    const config = data['data/minecraft/worldgen/feature/cherry.json'];
    assert.equal(config.trunk_placer.second_branch_start_offset_from_top, undefined);
    const writes = [];
    const random = { nextInt: () => 0, nextFloat: () => 0.5 };
    assert.doesNotThrow(() => placeCherryTrunk({ trunk_provider: config.trunk_provider, trunk_placer: config.trunk_placer },
        { x: 0, y: 64, z: 0 }, 8, random, {
            sampleTrunkState: () => ({ name: 'minecraft:cherry_log', properties: { axis: 'y' } }),
            stateIdFor: () => 1,
            isValidTreePos: () => true,
            setBlock: (state, pos) => writes.push({ state, pos })
        }));
    assert.ok(writes.length > 0);
});

test('26.3 poplar trunk shuffles the six vanilla directions on every layer and branches at its configured height', () => {
    const bounds = [];
    const writes = [];
    const tree = {
        trunk_provider: { id: 'minecraft:oak_log' },
        trunk_placer: {
            type: 'minecraft:poplar_trunk_placer',
            trunk_height_above_branches: 1,
            branch_amount: 2
        }
    };
    const attachments = placePoplarTrunk(tree, { x: 0, y: 8, z: 0 }, 4, {
        nextInt(bound) { bounds.push(bound); return 0; }
    }, {
        sampleTrunkState: () => ({ name: 'minecraft:oak_log', properties: { axis: 'y' } }),
        stateIdFor: (_name, properties) => properties.axis === 'y' ? 1 : 2,
        isValidTreePos: () => true,
        setBlock: (state, pos) => writes.push({ axis: state.properties.axis, pos })
    });
    assert.deepEqual(bounds, [6, 5, 4, 3, 2, 6, 5, 4, 3, 2, 6, 5, 4, 3, 2, 6, 5, 4, 3, 2]);
    assert.equal(writes.filter(write => write.axis !== 'y').length, 2);
    assert.deepEqual(attachments, [{ position: { x: 0, y: 11, z: 0 }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false }]);
});
