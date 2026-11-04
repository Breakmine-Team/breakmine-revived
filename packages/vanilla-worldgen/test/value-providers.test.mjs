import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVanillaKernel } from '../runtime.mjs';
import { sampleFloatProvider, sampleHeightProvider, sampleIntProvider } from '../value-providers.mjs';

const wasm = await readFile(new URL('../generated/worldgen.wasm', import.meta.url));
const climate = JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url)));

function sequenceRandom({ ints = [], floats = [], gaussians = [] } = {}) {
    let i = 0, f = 0, g = 0;
    return {
        nextInt(bound) {
            const value = ints[i++];
            if (!Number.isInteger(value) || value < 0 || value >= bound) throw new RangeError(`Fixture integer is outside [0, ${bound})`);
            return value;
        },
        nextFloat() { return floats[f++]; },
        nextGaussian() { return gaussians[g++]; }
    };
}

test('26.3 cave integer providers preserve their nested inclusive draws', () => {
    assert.equal(sampleIntProvider({ type: 'minecraft:uniform', min_inclusive: 3, max_inclusive: 8 }, sequenceRandom({ ints: [4] })), 7);
    assert.equal(sampleIntProvider({ min_inclusive: -4, max_inclusive: -3 }, sequenceRandom({ ints: [1] })), -3);
    assert.equal(sampleIntProvider({ type: 'minecraft:biased_to_bottom', min_inclusive: 0, max_inclusive: 14 }, sequenceRandom({ ints: [13, 2] })), 2);
    assert.equal(sampleIntProvider({ type: 'minecraft:very_biased_to_bottom', min_inclusive: 0, max_inclusive: 14 }, sequenceRandom({ ints: [13, 2, 1] })), 1);
    assert.equal(sampleIntProvider(6, sequenceRandom()), 6);
});

test('very-biased height uses three native inclusive draws and no draws for empty/equal ranges', () => {
    const context = { minY: -64, maxY: 320, seaLevel: 63 };
    const provider = { type: 'minecraft:very_biased_to_bottom', min_inclusive: { above_bottom: 0 }, max_inclusive: { absolute: 100 }, inner: 8 };
    const bounds = [], draws = [10, 5, 3];
    const random = { nextInt(bound) { bounds.push(bound); return draws.shift(); } };
    assert.equal(sampleHeightProvider(provider, random, context), -61);
    assert.deepEqual(bounds, [157, 18, 13]);
    const noDraw = { nextInt() { throw new Error('unexpected draw'); } };
    assert.equal(sampleHeightProvider({ ...provider, max_inclusive: { absolute: -57 } }, noDraw, context), -64);
    assert.equal(sampleHeightProvider({ ...provider, inner: 1, max_inclusive: { absolute: -63 } }, noDraw, context), -64);
});

test('feature integer providers preserve weighted, clamped and trapezoid draws', () => {
    assert.equal(sampleIntProvider({ type: 'minecraft:weighted_list', distribution: [
        { data: 30, weight: 9 }, { data: 31, weight: 1 }
    ] }, sequenceRandom({ ints: [9] })), 31);
    assert.equal(sampleIntProvider({ type: 'minecraft:clamped', min_inclusive: 0, max_inclusive: 1,
        source: { type: 'minecraft:uniform', min_inclusive: -1, max_inclusive: 3 }
    }, sequenceRandom({ ints: [4] })), 1);
    assert.equal(sampleIntProvider({ type: 'minecraft:trapezoid', min: -7, max: 7, plateau: 0 }, sequenceRandom({ ints: [7, 2] })), 5);
    assert.equal(sampleIntProvider({ type: 'minecraft:clamped_normal', mean: 0, deviation: 3, min_inclusive: -2, max_inclusive: 2 }, sequenceRandom({ gaussians: [1] })), 2);
});

test('26.3 cave float providers use Java float arithmetic and draw order', () => {
    assert.equal(sampleFloatProvider({ type: 'minecraft:uniform', min_inclusive: 0.7, max_exclusive: 1.4 }, sequenceRandom({ floats: [0.25] })), Math.fround(Math.fround(0.7) + Math.fround(Math.fround(0.25) * Math.fround(Math.fround(1.4) - Math.fround(0.7)))));
    assert.equal(sampleFloatProvider({ type: 'minecraft:trapezoid', min: 0, max: 6, plateau: 2 }, sequenceRandom({ floats: [0.25, 0.5] })), 2);
});

test('26.3 uniform carver heights resolve anchors against dimension bounds', () => {
    const provider = { type: 'minecraft:uniform', min_inclusive: { above_bottom: 8 }, max_inclusive: { absolute: 180 } };
    assert.equal(sampleHeightProvider(provider, sequenceRandom({ ints: [120] }), { minY: -64, maxY: 320, seaLevel: 63 }), 64);
    assert.equal(sampleHeightProvider({ type: 'minecraft:uniform', min_inclusive: { below_top: 0 }, max_inclusive: { absolute: 0 } }, sequenceRandom(), { minY: 0, maxY: 128, seaLevel: 32 }), 127);
});

test('26.3 trapezoid feature heights keep the JAR inclusive two-draw curve', () => {
    const provider = { type: 'minecraft:trapezoid', min_inclusive: { absolute: 0 }, max_inclusive: { absolute: 10 }, plateau: 0 };
    assert.equal(sampleHeightProvider(provider, sequenceRandom({ ints: [5, 4] }), { minY: -64, maxY: 320, seaLevel: 63 }), 9);
});

test('WASM random nextFloat consumes the high 24 bits of the next Java long', async () => {
    const kernel = await createVanillaKernel(wasm, climate);
    const first = kernel.random('912337');
    const second = kernel.random('912337');
    try {
        const bits = BigInt.asUintN(64, first.nextLong()) >> 40n;
        assert.equal(second.nextFloat(), Math.fround(Number(bits) * 5.9604644775390625e-8));
    } finally { first.dispose(); second.dispose(); kernel.dispose(); }
});

test('WASM nextGaussian follows Minecraft 26.3 Marsaglia-polar draws and cache order', async () => {
    const kernel = await createVanillaKernel(wasm, climate);
    const actual = kernel.random('5263');
    const reference = kernel.random('5263');
    try {
        for (let i = 0; i < 8; i++) {
            let x, y, radius;
            do {
                x = 2 * reference.nextDouble() - 1;
                y = 2 * reference.nextDouble() - 1;
                radius = x * x + y * y;
            } while (radius >= 1 || radius === 0);
            const scale = Math.sqrt(-2 * Math.log(radius) / radius);
            assert.equal(actual.nextGaussian(), x * scale);
            assert.equal(actual.nextGaussian(), y * scale);
            assert.equal(actual.nextLong(), reference.nextLong());
        }
    } finally { actual.dispose(); reference.dispose(); kernel.dispose(); }
});
