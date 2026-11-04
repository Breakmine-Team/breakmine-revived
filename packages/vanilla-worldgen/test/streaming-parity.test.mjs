import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChunkService } from '../chunk-service.mjs';

test('complete warm terrain preloads preserve decoration arrays and fail identically on unported features', { timeout: 240000 }, async t => {
    const json = async name => JSON.parse(await readFile(new URL(`../generated/${name}.json`, import.meta.url)));
    const assets = { bytes: await readFile(new URL('../generated/worldgen.wasm', import.meta.url)),
        climate: await json('climate'), data: await json('vanilla-data'), registry: await json('block-states'), stateRules: await json('block-rules') };
    for (const [seed, x, z] of [['1', 0, 0], ['6888349110149677383', 0, 0], ['42', -2, 1]]) {
        const cold = await createChunkService(assets);
        const warm = await createChunkService(assets);
        const terrain = await createChunkService({ ...assets, maxCachedChunks: 0 });
        try {
            const neighbors = [];
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) neighbors.push([x + dx, z + dz]);
            for (const coords of [[[x, z]], neighbors]) {
                let expected, coldError;
                try { expected = cold.generate({ seed, coords, mode: 'decoration_draft' }); }
                catch (error) {
                    assert.equal(seed, '42', 'unexpected baseline generation failure');
                    assert.match(error.message, /Native block survival is not ported: minecraft:leaf_litter/);
                    coldError = error;
                }
                const required = new Map();
                for (const [cx, cz] of coords) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) required.set(`${cx + dx},${cz + dz}`, [cx + dx, cz + dz]);
                const dependencies = [], pairs = [...required.values()];
                for (let i = 0; i < pairs.length; i += 4) dependencies.push(...terrain.generate({ seed, coords: pairs.slice(i, i + 4) }).chunks);
                const immutable = dependencies.map(chunk => chunk.blocks.slice());
                warm.preloadTerrainChunks({ seed, settings: 'overworld', chunks: dependencies });
                if (coldError) {
                    assert.throws(() => warm.generate({ seed, coords, mode: 'decoration_draft' }), error => error.message === coldError.message);
                    t.diagnostic(`${seed}: same explicit leaf_litter support failure with/without warm preload; no decorated output parity claimed`);
                } else {
                    const actual = warm.generate({ seed, coords, mode: 'decoration_draft' });
                    assert.equal(actual.streamingStats.terrainMisses, 0);
                    for (let i = 0; i < coords.length; i++) for (const field of ['blocks', 'biomes', 'heightmap', 'fluidUpdates']) {
                        assert.deepEqual(actual.chunks[i][field], expected.chunks[i][field], `${seed}: ${coords[i]} ${field}`);
                    }
                    t.diagnostic(`${seed}: ${coords.length} complete chunk arrays match, zero dependency misses`);
                }
                for (let i = 0; i < dependencies.length; i++) assert.deepEqual(dependencies[i].blocks, immutable[i]);
            }
        } finally { cold.dispose(); warm.dispose(); terrain.dispose(); }
    }
});
