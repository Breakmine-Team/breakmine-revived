import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getBlobFoliageHeight,
    getFoliageHeight,
    placeAcaciaFoliage,
    placeBlobFoliage,
    placeBushFoliage,
    placeCherryFoliage,
    placeDarkOakFoliage,
    placeFancyFoliage,
    placeMegaJungleFoliage,
    placeMegaPineFoliage,
    placePineFoliage,
    placePoplarFoliage,
    placeRandomSpreadFoliage,
    placeSpruceFoliage,
    sampleBlobFoliageRadius,
    sampleFoliageRadius
} from '../tree-foliage.mjs';

const attachment = (overrides = {}) => ({ position: { x: 0, y: 10, z: 0 }, foliageHeightOffset: 0, radiusOffsetXZ: 0, doubleTrunk: false, ...overrides });
const collect = () => {
    const leaves = [];
    return { leaves, callbacks: { canPlaceLeaf: () => true, placeLeaf: pos => leaves.push(pos) } };
};

test('26.3 foliage height and radius providers follow the JAR sampling order', () => {
    const draws = [];
    const random = { nextInt(bound) { draws.push(bound); return 1; } };
    const placer = { type: 'minecraft:pine_foliage_placer', radius: { type: 'minecraft:uniform', min_inclusive: 1, max_inclusive: 2 }, offset: 0, height: { type: 'minecraft:uniform', min_inclusive: 2, max_inclusive: 3 } };
    const height = getFoliageHeight(placer, random, 8);
    const radius = sampleFoliageRadius(placer, random, 8 - height);
    assert.deepEqual(draws, [2, 2, 6]);
    assert.equal(height, 3);
    assert.equal(radius, 3);
});

test('26.3 acacia foliage places three offset layers and preserves per-corner draws', () => {
    const { leaves, callbacks } = collect();
    const bounds = [];
    const count = placeAcaciaFoliage({ type: 'minecraft:acacia_foliage_placer', radius: 2, offset: 0 }, attachment(), 0, 2, {
        nextInt(bound) { bounds.push(bound); return 0; }
    }, callbacks);
    assert.equal(count, leaves.length);
    assert.ok(leaves.some(pos => pos.y === 9));
    assert.ok(leaves.some(pos => pos.y === 10));
    assert.deepEqual(bounds, []);
});

test('26.3 bush and fancy foliage use their distinct layer profiles', () => {
    const bush = collect();
    placeBushFoliage({ type: 'minecraft:bush_foliage_placer', radius: 2, offset: 0, height: 2 }, attachment(), 2, 2, { nextInt: () => 0 }, bush.callbacks);
    assert.deepEqual([...new Set(bush.leaves.map(pos => pos.y))], [10, 9, 8]);

    const fancy = collect();
    placeFancyFoliage({ type: 'minecraft:fancy_foliage_placer', radius: 2, offset: 0, height: 3 }, attachment(), 3, 2, { nextInt: () => 0 }, fancy.callbacks);
    assert.deepEqual([...new Set(fancy.leaves.map(pos => pos.y))], [10, 9, 8, 7]);
    assert.ok(fancy.leaves.length > 0);
});

test('26.3 dark-oak foliage distinguishes 2x2 trunk attachments and optional crown layer', () => {
    const single = collect();
    placeDarkOakFoliage({ type: 'minecraft:dark_oak_foliage_placer', radius: 0, offset: 0 }, attachment(), 4, 0, {
        nextBoolean: () => assert.fail('single trunk does not sample the crown layer')
    }, single.callbacks);
    assert.deepEqual([...new Set(single.leaves.map(pos => pos.y))], [9, 10]);

    const double = collect();
    placeDarkOakFoliage({ type: 'minecraft:dark_oak_foliage_placer', radius: 0, offset: 0 }, attachment({ doubleTrunk: true }), 4, 0, {
        nextBoolean: () => true
    }, double.callbacks);
    assert.deepEqual([...new Set(double.leaves.map(pos => pos.y))], [9, 10, 11, 12]);
    assert.ok(double.leaves.some(pos => pos.x === 1 && pos.z === 1));
});

test('26.3 pine and spruce foliage retain vanilla layer growth and RNG draws', () => {
    const pine = collect();
    placePineFoliage({ type: 'minecraft:pine_foliage_placer', radius: 1, offset: 0, height: 3 }, attachment(), 3, 2, { nextInt: () => 0 }, pine.callbacks);
    assert.deepEqual([...new Set(pine.leaves.map(pos => pos.y))], [10, 9, 8, 7]);

    const spruce = collect();
    const bounds = [];
    placeSpruceFoliage({ type: 'minecraft:spruce_foliage_placer', radius: 1, offset: 0, trunk_height: 2 }, attachment(), 2, 2, {
        nextInt(bound) { bounds.push(bound); return 0; }
    }, spruce.callbacks);
    assert.deepEqual(bounds, [2]);
    assert.deepEqual([...new Set(spruce.leaves.map(pos => pos.y))], [10, 9, 8]);
});

test('26.3 random-spread and mega-jungle foliage preserve sampling order', () => {
    const spread = collect();
    const bounds = [];
    placeRandomSpreadFoliage({ type: 'minecraft:random_spread_foliage_placer', radius: 3, offset: 0, foliage_height: 2, leaf_placement_attempts: 2 }, attachment(), 2, 3, {
        nextInt(bound) { bounds.push(bound); return 1; }
    }, spread.callbacks);
    assert.deepEqual(bounds, [3, 3, 2, 2, 3, 3, 3, 3, 2, 2, 3, 3]);
    assert.equal(spread.leaves.length, 2);

    const mega = collect();
    placeMegaJungleFoliage({ type: 'minecraft:jungle_foliage_placer', radius: 2, offset: 0, height: 3 }, attachment(), 3, 2, { nextInt: () => 1 }, mega.callbacks);
    assert.ok(mega.leaves.length > 0);
    assert.deepEqual([...new Set(mega.leaves.map(pos => pos.y))], [10, 9, 8]);
});

test('26.3 mega-pine samples crown height and alternates the expanded crown rows by world-Y parity', () => {
    const draws = [];
    const placer = {
        type: 'minecraft:mega_pine_foliage_placer', radius: 0, offset: 0,
        crown_height: { type: 'minecraft:uniform', min_inclusive: 5, max_inclusive: 5 }
    };
    const crownHeight = getFoliageHeight(placer, { nextInt(bound) { draws.push(bound); return 0; } }, 24);
    assert.equal(crownHeight, 5);
    assert.deepEqual(draws, [1]);
    assert.equal(sampleFoliageRadius(placer, { nextInt: () => assert.fail('constant radius must not draw') }, 1), 0);

    const evenBase = collect();
    placeMegaPineFoliage(placer, attachment({ position: { x: 0, y: 10, z: 0 } }), crownHeight, 0,
        { nextInt: () => 0 }, evenBase.callbacks);
    const oddBase = collect();
    placeMegaPineFoliage(placer, attachment({ position: { x: 0, y: 11, z: 0 } }), crownHeight, 0,
        { nextInt: () => 0 }, oddBase.callbacks);

    assert.ok(!evenBase.leaves.some(pos => pos.y === 7 && Math.abs(pos.x) === 3));
    assert.ok(oddBase.leaves.some(pos => pos.y === 8 && Math.abs(pos.x) === 3));
    assert.ok(evenBase.leaves.every(pos => Math.abs(pos.x) + Math.abs(pos.z) < 7));
});

test('26.3 blob foliage samples radius separately and uses configured foliage height', () => {
    const placer = { type: 'minecraft:blob_foliage_placer', radius: 2, offset: 0, height: 3 };
    assert.equal(getBlobFoliageHeight(placer), 3);
    assert.equal(sampleBlobFoliageRadius(placer, { nextInt: () => assert.fail('constant radius should not draw') }), 2);
});

test('26.3 blob foliage rows apply offset, radius curve, corner draws and leaf checks in order', () => {
    const placer = { type: 'minecraft:blob_foliage_placer', radius: 1, offset: 0, height: 3 };
    const draws = [];
    const leaves = [];
    const placed = placeBlobFoliage(placer, {
        position: { x: 4, y: 20, z: -3 }, foliageHeightOffset: 0, radiusOffsetXZ: 0, doubleTrunk: false
    }, getBlobFoliageHeight(placer), sampleBlobFoliageRadius(placer, { nextInt: () => 1 }), {
        nextInt(bound) { draws.push(bound); return 1; }
    }, {
        canPlaceLeaf: () => true,
        placeLeaf: pos => leaves.push(pos)
    });

    assert.equal(placed, 19);
    assert.equal(draws.length, 10);
    assert.ok(draws.every(bound => bound === 2));
    assert.equal(leaves.length, 19);
    assert.ok(!leaves.some(pos => pos.y === 20));
    assert.equal(leaves.filter(pos => pos.y === 19).length, 1);
    assert.equal(leaves.filter(pos => pos.y === 18).length, 9);
    assert.equal(leaves.filter(pos => pos.y === 17).length, 9);
});

test('26.3 blob foliage expands and mirrors the canopy bounds for double trunks', () => {
    const leaves = [];
    const placer = { type: 'minecraft:blob_foliage_placer', radius: 1, offset: 0, height: 0 };
    placeBlobFoliage(placer, {
        position: { x: 0, y: 10, z: 0 }, foliageHeightOffset: 0, radiusOffsetXZ: 0, doubleTrunk: true
    }, 0, 2, { nextInt: () => 0 }, {
        canPlaceLeaf: () => true,
        placeLeaf: pos => leaves.push(pos)
    });
    assert.equal(leaves.length, 12);
    assert.deepEqual(
        [Math.min(...leaves.map(pos => pos.x)), Math.max(...leaves.map(pos => pos.x)), Math.min(...leaves.map(pos => pos.z)), Math.max(...leaves.map(pos => pos.z))],
        [-1, 2, -1, 2]
    );
});

test('26.3 cherry foliage makes the tiered crown and applies bottom/corner hole draws', () => {
    const canopy = collect();
    const draws = [];
    const placer = {
        type: 'minecraft:cherry_foliage_placer', radius: 2, offset: 0, height: 5,
        wide_bottom_layer_hole_chance: 0.5, corner_hole_chance: 0,
        hanging_leaves_chance: 0, hanging_leaves_extension_chance: 0
    };
    const count = placeCherryFoliage(placer, attachment(), 5, 2, {
        nextFloat() { draws.push(0.25); return 0.25; }
    }, canopy.callbacks);
    assert.equal(count, canopy.leaves.length);
    assert.ok(canopy.leaves.some(pos => pos.y === 11));
    assert.ok(canopy.leaves.some(pos => pos.y === 10));
    assert.ok(draws.length > 0);
});

test('26.3 cherry hanging-leaf extensions start below a placed bottom-row leaf', () => {
    const canopy = collect();
    placeCherryFoliage({
        type: 'minecraft:cherry_foliage_placer', radius: 4, offset: 0, height: 6,
        wide_bottom_layer_hole_chance: 0, corner_hole_chance: 0,
        hanging_leaves_chance: 1, hanging_leaves_extension_chance: 1
    }, attachment(), 6, 4, { nextFloat: () => 0 }, canopy.callbacks);
    assert.ok(canopy.leaves.some(pos => pos.y === 8));
    assert.ok(canopy.leaves.some(pos => pos.y === 7));
});

test('26.3 poplar foliage keeps the layered rhombus, side-hole draws and exact leaf-to-log state check', () => {
    const leaves = [];
    const replaced = [];
    const foliageState = { name: 'minecraft:oak_leaves', stateId: 21, properties: { distance: '7' } };
    const placer = {
        type: 'minecraft:poplar_foliage_placer', radius: 5, offset: 0,
        height: 5, side_hole_chance: 0
    };
    placePoplarFoliage(placer, attachment(), 5, 5, {
        nextBoolean: () => false,
        nextFloat: () => 0.5
    }, {
        canPlaceLeaf: () => true,
        placeLeaf: pos => leaves.push(pos),
        sampleFoliageState: () => foliageState,
        getBlockState: pos => pos.x === 0 && pos.y === 11 && pos.z === 0 ? foliageState : { name: 'minecraft:air' },
        replaceLeafWithLog: (pos, axis) => replaced.push({ pos, axis })
    });
    assert.deepEqual([...new Set(leaves.map(pos => pos.y))], [14, 13, 12, 11, 10, 9]);
    assert.deepEqual(replaced, [{ pos: { x: 0, y: 11, z: 0 }, axis: 'x' }]);
});
