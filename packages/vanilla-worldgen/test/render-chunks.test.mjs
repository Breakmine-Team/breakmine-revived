import test from 'node:test';
import assert from 'node:assert/strict';
import Chunk from '../../../src/js/net/minecraft/client/world/Chunk.js';
import World from '../../../src/js/net/minecraft/client/world/World.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import VanillaRenderChunk from '../../../src/js/net/minecraft/client/world/VanillaRenderChunk.js';
import EnumSkyBlock from '../../../src/js/net/minecraft/util/EnumSkyBlock.js';
import MetadataChunkBlock from '../../../src/js/net/minecraft/util/MetadataChunkBlock.js';
import { VanillaChunk } from '../chunk.mjs';

new Block(1);

function worldFor(minY = -64, height = 384) {
    const world = Object.create(World.prototype);
    Object.assign(world, { minY, maxY: minY + height, height, skylightSubtracted: 0,
        minecraft: { settings: { ambientOcclusion: false }, player: null },
        lightUpdateQueue: [], chunks: new Map() });
    world.chunkProvider = {
        getChunkAt: (x, z) => world.chunks.get(`${x},${z}`),
        chunkExists: (x, z) => world.chunks.has(`${x},${z}`)
    };
    return world;
}

test('actual game chunks use signed section coordinates, bounding boxes and origins', () => {
    const world = worldFor();
    const chunk = new Chunk(world, -1, 2);
    world.chunks.set('-1,2', chunk);
    assert.equal(chunk.sections.length, 24);
    assert.equal(chunk.getSection(-4).group.position.y, -64);
    assert.equal(chunk.getSection(19).boundingBox.max.y, 320);
    assert.equal(chunk.getSection(20), null);
    assert.equal(chunk.getSection(-5), null);
    chunk.setBlockAt(15, -64, 0, 1);
    chunk.setBlockAt(15, 319, 0, 1);
    assert.equal(world.getBlockAt(-1, -64, 32), 1);
    assert.equal(world.getBlockAt(-1, 319, 32), 1);
    assert.equal(world.getChunkAtBlock(-1, 320, 32), null);
    assert.equal(world.blockExists(-1, -65, 32), false);
    assert.equal(world.blockExists(-1, -64, 32), true);
    for (const section of chunk.sections) section.isModified = false;
    world.setModified(-1, -64, 32, -1, -64, 32);
    assert.equal(chunk.getSection(-4).isModified, true);
    assert.equal(chunk.getSection(0).isModified, false);
});

test('game save roundtrip preserves signed range, metadata and section light', () => {
    const world = worldFor();
    const chunk = new Chunk(world, 0, 0);
    chunk.setBlockAt(1, -63, 2, 1, 3);
    chunk.setBlockAt(2, 319, 3, 1, 4);
    chunk.setLightAt(EnumSkyBlock.BLOCK, 1, -63, 2, 7);
    const saved = chunk.serialize();
    const loaded = Chunk.deserialize(world, saved);
    assert.equal(saved.minY, -64);
    assert.equal(loaded.getBlockAt(1, -63, 2), 1);
    assert.equal(loaded.getBlockDataAt(2, 319, 3), 4);
    assert.equal(loaded.getSection(-4).getLightAt(EnumSkyBlock.BLOCK, 1, 1, 2), 7);
    assert.throws(() => Chunk.deserialize(worldFor(0, 256), saved), /range/);
    assert.throws(() => chunk.fillChunk(new Uint8Array(0), 0, true), /Legacy/);
});

test('legacy chunks retain 16 sections and unchanged save shape', () => {
    const world = worldFor(0, 256);
    const chunk = new Chunk(world, 0, 0);
    assert.equal(chunk.sections.length, 16);
    assert.equal(chunk.getSection(0), chunk.sections[0]);
    chunk.setBlockAt(1, 255, 2, 1);
    const saved = chunk.serialize();
    assert.equal(saved.minY, undefined);
    assert.equal(saved.height, undefined);
    assert.equal(Chunk.deserialize(world, saved).getBlockAt(1, 255, 2), 1);
});

test('native render bridge preserves modern states and synchronizes editable block mutations', () => {
    const world = worldFor();
    const native = new VanillaChunk(0, 0);
    native.setBlock(1, -64, 2, 35722);
    native.setBlock(3, 319, 4, 35722);
    native.heightmap[4 * 16 + 3] = 320;
    const chunk = VanillaRenderChunk.fromPayload(world, native.serialize(), new Map([[0, 0], [35722, 16]]));
    world.chunks.set('0,0', chunk);
    world.nativeStateFromRender = (type, data = 0) => type === 0 && data === 0 ? 0 : type === 1 ? 8123 : undefined;
    world.vanillithDirtyChunks = new Map();
    const calls = [];
    const renderer = { blockRenderer: {
        tessellator: { startDrawing() {}, setRenderingPass() {}, addedVertices: 0 },
        renderBlock: (world, block, ao, x, y, z) => calls.push([x, y, z])
    } };
    chunk.getSection(-4).rebuild(renderer);
    chunk.getSection(19).rebuild(renderer);
    assert.deepEqual(calls, [[1, -64, 2], [3, 319, 4]]);
    assert.equal(chunk.getBlockState(3, 319, 4), 35722);
    assert.equal(chunk.serialize().blocks[native.index(3, 319, 4)], 35722);
    chunk.loaded = false; // Isolate state-store synchronization from mesh/light callbacks.
    chunk.setBlockAt(1, -64, 2, 0);
    assert.equal(chunk.getBlockState(1, -64, 2), 0, 'native state changes together with render state');
    assert.equal(chunk.getBlockAt(1, -64, 2), 0);
    assert.equal(world.vanillithDirtyChunks.get('0,0').blocks[native.index(1, -64, 2)], 0,
        'edited native payload is retained for save and stream restoration');
    assert.throws(() => chunk.setBlockAt(1, -64, 2, 2), /No native block state mapped/);
    assert.throws(() => VanillaRenderChunk.fromPayload(world, native.serialize(), new Map([[0, 0]])), /Unsupported/);
});

test('lighting reset and skyline pass visit negative and top sections', () => {
    const world = worldFor();
    const chunk = new Chunk(world, 0, 0);
    world.chunks.set('0,0', chunk);
    chunk.loaded = true;
    chunk.heightMap = Array(256).fill(-64);
    chunk.setBlockAt(0, -64, 0, 1);
    world.resetChunkBlockLight(chunk);
    world.updateChunkSkyLight(chunk);
    assert.equal(chunk.getSection(-4).blockLight.length, 4096);
    assert.equal(chunk.getSection(19).getLightAt(EnumSkyBlock.SKY, 0, 15, 0), 15);
    chunk.heightMap[0] = -63;
    world.updateChunkSkyLight(chunk);
    assert.equal(chunk.getSection(-4).getLightAt(EnumSkyBlock.SKY, 0, 0, 0), 0);
    assert.equal(chunk.calculateHeightAt(0, 0, 320), -63);
});

test('modern full-column lighting is not rejected by the old 70k-volume cap', () => {
    let visits = 0;
    const world = { minY: -64, maxY: 320, height: 384, blockExists: () => false, getHeightAt: () => { visits++; return -64; } };
    new MetadataChunkBlock(EnumSkyBlock.SKY, 0, -64, 0, 15, 319, 15).updateBlockLightning(world);
    assert.equal(visits, 18 * 18);
});
