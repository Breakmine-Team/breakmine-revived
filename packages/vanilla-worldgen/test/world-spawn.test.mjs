import test from 'node:test';
import assert from 'node:assert/strict';
import { VanillaChunk } from '../chunk.mjs';
import { findDrySurface, findNearestDrySpawn } from '../../../src/js/net/minecraft/client/world/generator/VanillaWorldSpawn.js';
import blocks from '../generated/block-states.json' with { type: 'json' };

function oceanChunk(chunkX, chunkZ) {
    const chunk = new VanillaChunk(chunkX, chunkZ);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        chunk.setBlock(x, 20, z, 1);
        for (let y = 21; y < 63; y++) chunk.setBlock(x, y, z, 89);
        chunk.heightmap[z * 16 + x] = 63;
    }
    return chunk;
}

function landChunk(chunkX, chunkZ) {
    const chunk = new VanillaChunk(chunkX, chunkZ);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        chunk.setBlock(x, 64, z, 9);
        chunk.heightmap[z * 16 + x] = 65;
    }
    return chunk;
}

test('spawn surface search rejects ocean floors and selects the nearest dry solid terrain', async () => {
    const center = oceanChunk(0, 0);
    assert.equal(findDrySurface(center, 8, 8), null, 'seabed under water is not a safe spawn surface');
    const requests = [];
    const source = { async getTerrainChunksAtAsync(coords) {
        requests.push(...coords);
        return coords.map(([x, z]) => x === 1 && z === 0 ? landChunk(x, z) : oceanChunk(x, z));
    } };

    const spawn = await findNearestDrySpawn(source, center, { maxChunkRadius: 2 });
    assert.equal(spawn.chunk.chunkX, 1);
    assert.equal(spawn.chunk.chunkZ, 0);
    assert.equal(spawn.y, 65);
    assert.ok(spawn.x >= 16 && spawn.x < 32);
    assert.ok(spawn.z >= 0 && spawn.z < 16);
    assert.ok(requests.length >= 8, 'search inspects the full nearest chunk ring before choosing');
});

test('spawn search fails clearly if its bounded search finds no dry land', async () => {
    const center = oceanChunk(0, 0);
    const source = { async getTerrainChunksAtAsync(coords) { return coords.map(([x, z]) => oceanChunk(x, z)); } };
    await assert.rejects(findNearestDrySpawn(source, center, { maxChunkRadius: 1 }), /No dry, solid spawn surface found within 1 chunks/);
});

test('spawn search never falls through a blocked top surface to an underground cave floor', () => {
    const chunk = new VanillaChunk(0, 0);
    const leavesId = blocks.states.find(state => state.name === 'minecraft:oak_leaves').id;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        chunk.setBlock(x, 20, z, 1);
        chunk.setBlock(x, 64, z, leavesId);
        chunk.heightmap[z * 16 + x] = 65;
    }
    assert.equal(findDrySurface(chunk, 8, 8), null);
});
