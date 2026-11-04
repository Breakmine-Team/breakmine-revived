import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBiomeTemperatureSampler } from '../biome-temperature.mjs';
import { createMaterialSurfaceSampler } from '../material-surface.mjs';
import { createVanillaKernel } from '../runtime.mjs';
import gameplay from '../../vanilla-gameplay/generated/gameplay.json' with { type: 'json' };

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url)));
const climate = JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url)));
const wasm = await readFile(new URL('../generated/worldgen.wasm', import.meta.url));

test('26.3 biome temperature applies the 17-block lapse threshold and snow cutoff', () => {
    const sampler = createBiomeTemperatureSampler(data);
    assert.equal(sampler.temperature('minecraft:plains', 0, 80, 0, 63), Math.fround(0.8));
    assert.equal(sampler.temperature('minecraft:plains', 0, 81, 0, 63), Math.fround(Math.fround(0.8) - Math.fround(Math.fround(1 * Math.fround(0.05)) / Math.fround(40))));
    for (const [x,y,z,value] of gameplay.temperatures) assert.equal(sampler.temperature('minecraft:plains', x, y, z, 63), Math.fround(value));
    assert.equal(sampler.temperature('minecraft:frozen_ocean', 0, 64, 0, 63), Math.fround(0.2));
    assert.equal(sampler.temperature('minecraft:frozen_ocean', -130, 220, 88, 63), Math.fround(0.019932285));
    for (let x = -64; x <= 64; x += 8) for (let z = -64; z <= 64; z += 8)
        assert.equal(sampler.isColdAt('minecraft:plains', x, 220, z, 63), false, 'warm plains must not randomly freeze');
    assert.equal(sampler.isColdAt('minecraft:frozen_ocean', 0, 64, 0, 63), false);
    assert.equal(sampler.isColdAt('minecraft:frozen_ocean', 0, 200, 0, 63), true);
    assert.equal(sampler.isColdAt('minecraft:snowy_plains', 0, 64, 0, 63), true);
});

test('material column temperature condition resolves the current biome and sea level', async () => {
    const kernel = await createVanillaKernel(wasm, climate);
    const sampler = createMaterialSurfaceSampler(kernel, 0, data);
    try {
        const context = sampler.createColumn({
            x: 0, z: 0, surfaceGradientX: 0, surfaceGradientZ: 0,
            preliminarySurfaceValue: 70, seaLevel: 63, minY: -64, maxY: 320,
            biome: 'minecraft:frozen_ocean'
        }).atY(64);
        assert.equal(context.isColdAt(context.blockX, context.blockY, context.blockZ, context.seaLevel), false);
        assert.equal(context.isColdAt(context.blockX, 200, context.blockZ, context.seaLevel), true);
    } finally {
        sampler.dispose();
        kernel.dispose();
    }
});
