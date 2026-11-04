import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeMangroveRoots, getRootTrunkOrigin } from '../root-placer.mjs';

const rootPlacer = (overrides = {}) => ({
    type: 'minecraft:mangrove_root_placer',
    trunk_offset_y: { type: 'minecraft:uniform', min_inclusive: 2, max_inclusive: 2 },
    root_provider: { id: 'minecraft:mangrove_roots', properties: { waterlogged: 'false' } },
    above_root_placement: {
        above_root_provider: { id: 'minecraft:moss_carpet' },
        above_root_placement_chance: 1
    },
    mangrove_root_placement: {
        can_grow_through: '#minecraft:mangrove_roots_can_grow_through',
        muddy_roots_in: ['minecraft:mud'],
        muddy_roots_provider: { id: 'minecraft:muddy_mangrove_roots' },
        max_root_width: 1,
        max_root_length: 8,
        random_skew_chance: 1
    },
    ...overrides
});

test('26.3 mangrove root samples its raised trunk origin after feature height inputs', () => {
    const bounds = [];
    const root = rootPlacer({ trunk_offset_y: { type: 'minecraft:uniform', min_inclusive: 1, max_inclusive: 3 } });
    assert.deepEqual(getRootTrunkOrigin(root, { x: 4, y: 10, z: -2 }, {
        nextInt(bound) { bounds.push(bound); return 2; }
    }), { x: 4, y: 13, z: -2 });
    assert.deepEqual(bounds, [3]);
});

test('26.3 mangrove roots simulate four ordered branches before writing waterlogged and muddy states', () => {
    const writes = [];
    const providerCalls = [];
    const root = rootPlacer();
    const random = { nextFloat: () => 0, nextBoolean: () => false };
    const result = placeMangroveRoots(root, { x: 0, y: 10, z: 0 }, { x: 0, y: 12, z: 0 }, random, {
        isValidTreePos: pos => pos.y >= 8 && Math.abs(pos.x) + Math.abs(pos.z) <= 2,
        canGrowThrough: (_pos, tag) => {
            assert.equal(tag, '#minecraft:mangrove_roots_can_grow_through');
            return false;
        },
        isMuddyRootsIn: pos => pos.x === 0 && pos.y === 11 && pos.z === 0,
        isWater: () => true,
        isAir: () => true,
        sampleState(provider, pos) {
            providerCalls.push([provider.id, pos]);
            return { name: provider.id, stateId: 1, properties: provider.properties ?? {} };
        },
        stateIdFor: (_name, properties) => properties.waterlogged === 'true' ? 2 : 1,
        setBlock(state, pos, flags) { writes.push({ state, pos, flags }); }
    });

    assert.equal(result, true);
    assert.equal(providerCalls[0][0], 'minecraft:muddy_mangrove_roots');
    assert.deepEqual(providerCalls[0][1], { x: 0, y: 11, z: 0 });
    assert.ok(writes.some(({ state }) => state.name === 'minecraft:mangrove_roots' && state.properties.waterlogged === 'true'));
    assert.ok(writes.some(({ state }) => state.name === 'minecraft:moss_carpet'));
    assert.ok(writes.every(({ flags }) => flags === 19));
});

test('26.3 mangrove root simulation fails closed without writing when a required trunk column is blocked', () => {
    const writes = [];
    const root = rootPlacer();
    const result = placeMangroveRoots(root, { x: 0, y: 10, z: 0 }, { x: 0, y: 12, z: 0 }, {
        nextFloat: () => 0, nextBoolean: () => false
    }, {
        isValidTreePos: pos => pos.y !== 11,
        canGrowThrough: () => false,
        isMuddyRootsIn: () => false,
        isWater: () => false,
        isAir: () => true,
        sampleState: () => ({ name: 'minecraft:mangrove_roots', properties: {} }),
        stateIdFor: () => 1,
        setBlock: (...args) => writes.push(args)
    });
    assert.equal(result, false);
    assert.deepEqual(writes, []);
});
