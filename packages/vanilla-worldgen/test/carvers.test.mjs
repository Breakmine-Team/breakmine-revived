import test from 'node:test';
import assert from 'node:assert/strict';
import { VanillaChunk } from '../chunk.mjs';
import { carveBiomeCarvers, carveCaveTunnel, carveConfiguredCanyon, carveConfiguredCave, carveEllipsoid, isCarverStartChunk } from '../carvers.mjs';

test('26.3 ellipsoid carving matches chunk-local bounds and center sampling', () => {
    const chunk = new VanillaChunk(-1, 2, -64, 384);
    const carved = [];
    const count = carveEllipsoid(chunk, {
        x: -8.5, y: 10.5, z: 40.5,
        radiusX: 1, radiusY: 1, radiusZ: 1,
        shouldSkip: (_dx, _dy, _dz, y) => y === 10,
        carve: (x, y, z) => carved.push([x, y, z])
    });
    assert.equal(count, 1);
    assert.deepEqual(carved, [[7, 11, 8]]);
});

test('ellipsoid visits the vanilla inclusive upper candidate before its strict ellipsoid test', () => {
    const chunk = new VanillaChunk(0, 0, 0, 128);
    const positions = [];
    carveEllipsoid(chunk, {
        x: 8.5, y: 10.8, z: 8.5,
        radiusX: 1, radiusY: 1, radiusZ: 1,
        carve: (x, y, z) => positions.push([x, y, z])
    });
    assert.ok(positions.some(position => position.join(',') === '8,12,8'));
});

test('ellipsoid carving clips to the target chunk and vertical range', () => {
    const chunk = new VanillaChunk(3, -2, 0, 128);
    const positions = [];
    assert.equal(carveEllipsoid(chunk, {
        x: 63.5, y: -400, z: -24.5,
        radiusX: 10, radiusY: 70, radiusZ: 10,
        carve: (x, y, z) => positions.push([x, y, z])
    }), 0);
    assert.equal(carveEllipsoid(chunk, {
        x: 56.5, y: 64.5, z: -24.5,
        radiusX: 80, radiusY: 80, radiusZ: 80,
        carve: (x, y, z) => positions.push([x, y, z])
    }), positions.length);
    assert.ok(positions.length > 0);
    assert.ok(positions.every(([x, y, z]) => x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < 128));
});

test('ellipsoid carving prunes distant chunks before visiting blocks', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    let calls = 0;
    const count = carveEllipsoid(chunk, {
        x: 1000, y: 0, z: 1000,
        radiusX: 2, radiusY: 2, radiusZ: 2,
        carve: () => calls++
    });
    assert.equal(count, 0);
    assert.equal(calls, 0);
});

test('26.3 cave tunnel follows a repeatable seeded path and forks wide tunnels', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    const makePath = () => {
        const blocks = [];
        const carved = carveCaveTunnel(chunk, {
            seed: 123456789n, x: 8, y: 30, z: 8,
            horizontalRadius: 1, verticalRadius: 1, thickness: 2,
            yaw: 0.7, pitch: 0.1, startStep: 0, endStep: 24,
            verticalScale: 1, floorLevel: -0.7,
            carve: (x, y, z) => blocks.push([x, y, z])
        });
        assert.equal(carved, blocks.length);
        assert.ok(carved > 0);
        assert.ok(blocks.every(([x, y, z]) => x >= 0 && x < 16 && y >= -64 && y < 320 && z >= 0 && z < 16));
        return blocks;
    };
    assert.deepEqual(makePath(), makePath());
});

test('cave tunnel floor checker can suppress every ellipsoid block', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    let calls = 0;
    const carved = carveCaveTunnel(chunk, {
        seed: 7n, x: 8, y: 30, z: 8,
        horizontalRadius: 1, verticalRadius: 1, thickness: 1,
        yaw: 0, pitch: 0, startStep: 0, endStep: 12,
        verticalScale: 1, floorLevel: 1,
        carve: () => calls++
    });
    assert.equal(carved, 0);
    assert.equal(calls, 0);
});

test('26.3 cave start probability includes its exact boundary', () => {
    const config = { type: 'minecraft:cave', probability: 0.15 };
    assert.equal(isCarverStartChunk(config, { nextFloat: () => Math.fround(0.15) }), true);
    assert.equal(isCarverStartChunk(config, { nextFloat: () => Math.fround(0.1501) }), false);
});

test('configured cave samples attempts, optional rooms, and tunnels into its target chunk', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    const random = {
        nextInt: () => 0,
        nextFloat: () => Math.fround(0.5),
        nextLong: () => 123456789n
    };
    const blocks = [];
    const count = carveConfiguredCave(chunk, { chunkX: 0, chunkZ: 0 }, { minY: -64, maxY: 320, seaLevel: 63 }, random, {
        type: 'minecraft:cave',
        count: { type: 'minecraft:constant', value: 1 },
        y: { type: 'minecraft:uniform', min_inclusive: { absolute: 24 }, max_inclusive: { absolute: 24 } },
        horizontal_radius_multiplier: 1,
        vertical_radius_multiplier: 1,
        start_vertical_radius_multiplier: 1,
        floor_level: -0.7,
        room_vertical_radius_multiplier: 0.5,
        thickness: { type: 'minecraft:constant', value: 1.5 },
        weird_thickness_bias: false
    }, (x, y, z) => blocks.push([x, y, z]));
    assert.equal(count, blocks.length);
    assert.ok(count > 0);
    assert.ok(blocks.every(([x, y, z]) => x >= 0 && x < 16 && y >= -64 && y < 320 && z >= 0 && z < 16));
});

test('configured canyon follows 26.3 shape providers and carves bounded ravine blocks', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    const random = {
        nextInt: bound => bound === 16 ? 8 : bound === 58 ? 30 : 1,
        nextFloat: () => Math.fround(0.5),
        nextLong: () => 987654321n
    };
    const blocks = [];
    const count = carveConfiguredCanyon(chunk, { chunkX: 0, chunkZ: 0 }, { minY: -64, maxY: 320, seaLevel: 63 }, random, {
        type: 'minecraft:canyon',
        probability: 0.01,
        y: { type: 'minecraft:uniform', min_inclusive: { absolute: 10 }, max_inclusive: { absolute: 67 } },
        vertical_rotation: { type: 'minecraft:uniform', min_inclusive: -0.125, max_exclusive: 0.125 },
        shape: {
            distance_factor: { type: 'minecraft:uniform', min_inclusive: 0.75, max_exclusive: 1 },
            thickness: { type: 'minecraft:trapezoid', min: 0, max: 6, plateau: 2 },
            width_smoothness: 3,
            horizontal_radius_factor: { type: 'minecraft:uniform', min_inclusive: 0.75, max_exclusive: 1 },
            vertical_radius_default_factor: 1,
            vertical_radius_center_factor: 0,
            y_scale: 3
        }
    }, (x, y, z) => blocks.push([x, y, z]));
    assert.equal(count, blocks.length);
    assert.ok(count > 0);
    assert.ok(blocks.every(([x, y, z]) => x >= 0 && x < 16 && y >= -64 && y < 320 && z >= 0 && z < 16));
});

test('biome carver stage scans the vanilla 17 by 17 origin neighborhood in order', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    const sampled = [];
    const config = {
        type: 'minecraft:cave', probability: 0.5,
        count: { type: 'minecraft:constant', value: 0 },
        y: { type: 'minecraft:uniform', min_inclusive: { absolute: 0 }, max_inclusive: { absolute: 0 } }
    };
    const run = () => carveBiomeCarvers(chunk, {
        seed: 987654321n,
        context: { minY: -64, maxY: 320, seaLevel: 63 },
        biomeAtQuart: (x, y, z) => { sampled.push([x, y, z]); return 'minecraft:plains'; },
        carversForBiome: () => ['minecraft:cave'],
        carverConfigs: { 'minecraft:cave': config },
        carve: () => assert.fail('Zero-count test carver should not mutate blocks')
    });
    const first = run();
    assert.deepEqual(sampled.slice(0, 18), [
        [-32, 0, -32], [-32, 0, -28], [-32, 0, -24], [-32, 0, -20], [-32, 0, -16],
        [-32, 0, -12], [-32, 0, -8], [-32, 0, -4], [-32, 0, 0], [-32, 0, 4],
        [-32, 0, 8], [-32, 0, 12], [-32, 0, 16], [-32, 0, 20], [-32, 0, 24],
        [-32, 0, 28], [-32, 0, 32], [-28, 0, -32]
    ]);
    assert.equal(sampled.length, 289);
    sampled.length = 0;
    const second = run();
    assert.deepEqual(first, second);
    assert.ok(first.starts > 0 && first.starts < 289);
    assert.equal(first.carved, 0);
});
