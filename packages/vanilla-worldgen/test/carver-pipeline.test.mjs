import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VanillaChunk } from '../chunk.mjs';
import { carveVanillaChunk, createVanillaCarverResources } from '../carver-pipeline.mjs';

const cave = {
    type: 'minecraft:cave', probability: 1,
    count: { type: 'minecraft:constant', value: 0 },
    y: { type: 'minecraft:uniform', min_inclusive: { absolute: 0 }, max_inclusive: { absolute: 0 } }
};

const data = {
    'data/minecraft/worldgen/carver/cave.json': cave,
    'data/minecraft/worldgen/biome/plains.json': { carvers: ['minecraft:cave'] }
};
const importedVanillaData = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));

test('vanilla carver resources resolve biome references in declared order', () => {
    const baseResources = createVanillaCarverResources(data);
    assert.equal(createVanillaCarverResources(data), baseResources);
    const resources = createVanillaCarverResources({
        ...data,
        'data/minecraft/worldgen/carver/canyon.json': { type: 'minecraft:canyon' },
        'data/minecraft/worldgen/biome/badlands.json': { carvers: ['minecraft:canyon', 'minecraft:cave'] }
    });
    assert.equal(resources.carverConfigs['minecraft:cave'], cave);
    assert.deepEqual(resources.carversForBiome('minecraft:badlands'), ['minecraft:canyon', 'minecraft:cave']);
    assert.throws(() => resources.carversForBiome('minecraft:missing'), /Missing vanilla biome resource/);
    assert.throws(() => resources.carversForBiome('minecraft:plains_missing'), /Missing vanilla biome resource/);
});

test('all imported 26.3 biome carver IDs resolve to supported cave and canyon resources', () => {
    const resources = createVanillaCarverResources(importedVanillaData);
    const biomePaths = Object.keys(importedVanillaData).filter(path => /^data\/minecraft\/worldgen\/biome\/.+\.json$/.test(path));
    assert.ok(biomePaths.length > 0);
    for (const path of biomePaths) {
        const id = `minecraft:${path.slice('data/minecraft/worldgen/biome/'.length, -'.json'.length)}`;
        for (const carverId of resources.carversForBiome(id)) {
            const config = resources.carverConfigs[carverId];
            assert.ok(config, `${id} references missing ${carverId}`);
            assert.ok(['minecraft:cave', 'minecraft:canyon'].includes(config.type), `${carverId} has unsupported type ${config.type}`);
        }
    }
});

test('vanilla chunk carver pipeline wires biome scheduling, mask output, and apply stage', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    const biomeSamples = [];
    const result = carveVanillaChunk(chunk, {
        seed: 42n,
        context: { minY: -64, maxY: 320, seaLevel: 63 },
        biomeAtQuart: (x, y, z) => { biomeSamples.push([x, y, z]); return 'minecraft:plains'; },
        vanillaData: data,
        carving: {
            isUncarvable: () => false,
            computeSubstance: () => null,
            isFluidEmpty: () => true,
            isSurfaceCover: () => false,
            isDirt: () => false
        }
    });
    assert.equal(result.scheduled.starts, 289);
    assert.equal(result.scheduled.carved, 0);
    assert.equal(result.applied.visited, 0);
    assert.equal(result.mask.isEmpty(), true);
    assert.equal(biomeSamples.length, 289);
});

test('pipeline refuses incomplete block replacement policy before carving', () => {
    const chunk = new VanillaChunk(0, 0, -64, 384);
    assert.throws(() => carveVanillaChunk(chunk, {
        seed: 1n, context: { minY: -64, maxY: 320, seaLevel: 63 },
        biomeAtQuart: () => 'minecraft:plains', vanillaData: data,
        carving: { isUncarvable: () => false }
    }), /Missing carving adapter/);
});
