import test from 'node:test';
import assert from 'node:assert/strict';
import { VanillaChunk } from '../chunk.mjs';
import { applyCarvingMask, CarvingMask, createCarverOutput, createWorldgenCarvingMask } from '../carving-mask.mjs';
import { carveEllipsoid } from '../carvers.mjs';

test('26.3 carving mask uses X/Z columns with Y-contiguous visit segments', () => {
    const mask = new CarvingMask(-4, 4);
    mask.carve(2, -1, 7);
    mask.carve(2, 0, 7);
    mask.carve(2, 2, 7);
    mask.carve(1, 3, 0);
    mask.carve(2, 0, 7);
    const segments = [];
    mask.visit((x, z, minY, maxY) => segments.push([x, z, minY, maxY]));
    assert.deepEqual(segments, [[1, 0, 3, 3], [2, 7, -1, 0], [2, 7, 2, 2]]);
    assert.equal(mask.size, 4);
    assert.equal(mask.isCarved(2, 0, 7), true);
    assert.equal(mask.isEmpty(), false);
    assert.throws(() => mask.carve(16, 0, 0), RangeError);
});

test('worldgen carving mask keeps vanilla bottom/top safety margins', () => {
    const normal = createWorldgenCarvingMask({ minY: -64, maxY: 320 });
    const upgrading = createWorldgenCarvingMask({ minY: -64, maxY: 320 }, true);
    assert.deepEqual([normal.minY, normal.maxY], [-63, 312]);
    assert.deepEqual([upgrading.minY, upgrading.maxY], [-63, 319]);
});

test('carver output clips geometry to the mask vertical range, not the full chunk', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    const mask = createWorldgenCarvingMask({ minY: -64, maxY: 320 });
    const output = createCarverOutput(chunk, mask);
    const carved = [];
    carveEllipsoid(output, {
        x: 8, y: 313, z: 8, radiusX: 3, radiusY: 8, radiusZ: 3,
        carve: (x, y, z) => { mask.carve(x, y, z); carved.push([x, y, z]); }
    });
    assert.ok(carved.length > 0);
    assert.ok(carved.every(([, y]) => y <= mask.maxY));
});

test('applying mask respects filter, uncarvable blocks, aquifer nulls, fluid ticks, and top material', () => {
    const chunk = new VanillaChunk(1, -1, 0, 16);
    chunk.setBlock(1, 2, 2, 4);
    chunk.setBlock(1, 3, 2, 3);
    chunk.setBlock(1, 4, 2, 2);
    chunk.setBlock(3, 2, 4, 1);
    const mask = new CarvingMask(1, 5);
    mask.carve(1, 3, 2);
    mask.carve(1, 4, 2);
    mask.carve(2, 4, 2);
    mask.carve(3, 2, 4);
    const updates = [];
    const topCalls = [];
    const result = applyCarvingMask(chunk, mask, {
        filter: (x, y) => !(x === 3 && y === 2),
        isUncarvable: state => state === 2,
        computeSubstance: (x, y, z, density) => {
            assert.equal(density, 0);
            return x === 18 ? null : { state: 7, scheduleFluidUpdate: true };
        },
        isFluidEmpty: state => state !== 7,
        markFluidUpdate: (x, y, z) => updates.push([x, y, z]),
        isSurfaceCover: state => state === 3,
        isDirt: state => state === 4,
        topMaterial: position => { topCalls.push(position); return 8; }
    });
    assert.deepEqual(result, { visited: 4, filtered: 1, uncarvable: 1, aquiferSkipped: 1, replaced: 1, fluidUpdates: 1, topMaterials: 1 });
    assert.deepEqual(updates, [[1, 3, 2]]);
    assert.deepEqual(topCalls, [{ x: 17, y: 3, z: -14, fluid: true }]);
    assert.equal(chunk.getBlock(1, 2, 2), 8);
});

test('surface cover is repaired after an aquifer replacement when the block below is dirt', () => {
    const chunk = new VanillaChunk(0, 0, 0, 16);
    chunk.setBlock(1, 2, 3, 4);
    chunk.setBlock(1, 3, 3, 5);
    const mask = new CarvingMask(1, 6);
    mask.carve(1, 3, 3);
    const topCalls = [];
    const fluidUpdates = [];
    const result = applyCarvingMask(chunk, mask, {
        isUncarvable: () => false,
        computeSubstance: () => ({ state: 7, scheduleFluidUpdate: true }),
        isFluidEmpty: state => state !== 7,
        markFluidUpdate: (...position) => fluidUpdates.push(position),
        isSurfaceCover: state => state === 5,
        isDirt: state => state === 4,
        topMaterial: position => { topCalls.push(position); return 8; }
    });
    assert.deepEqual(result, { visited: 1, filtered: 0, uncarvable: 0, aquiferSkipped: 0, replaced: 1, fluidUpdates: 1, topMaterials: 1 });
    assert.equal(chunk.getBlock(1, 3, 3), 7);
    assert.equal(chunk.getBlock(1, 2, 3), 8);
    assert.deepEqual(fluidUpdates, [[1, 3, 3]]);
    assert.deepEqual(topCalls, [{ x: 1, y: 3, z: 3, fluid: true }]);
});
