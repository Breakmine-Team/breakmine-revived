import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VanillaChunk } from '../chunk.mjs';
import { createLegacyBlockStateMap, createLegacyStateIdMap, toLegacyBlockColumn, toLegacyBlockStateColumn, toLegacyChunkResult } from '../legacy-adapter.mjs';

const jarStateMap = JSON.parse(await readFile(new URL('../reference/legacy-block-state-map.json', import.meta.url), 'utf8'));
const sourceLock = JSON.parse(await readFile(new URL('../source-lock.json', import.meta.url), 'utf8'));

test('checked-in legacy state map comes from the pinned JAR registry', () => {
    assert.deepEqual(jarStateMap.source, sourceLock);
    assert.equal(jarStateMap.registryStateCount, 35723);
    assert.equal(jarStateMap.mappings.length, 77);
    assert.equal(new Set(jarStateMap.mappings.map(({ name }) => name)).size, 17);
    assert.ok(jarStateMap.mappings.every(({ stateId, blockId }) => Number.isInteger(stateId) && blockId >= 0 && blockId <= 255));
    assert.ok(jarStateMap.mappings.every(({ packedState, blockId, metadata }) => packedState === (blockId << 4) | metadata));
});

test('legacy state adapter preserves water levels and log axes in metadata', () => {
    const mapping = createLegacyBlockStateMap([
        { id: 0, name: 'minecraft:air', properties: {} },
        { id: 10, name: 'minecraft:water', properties: { level: '0' } },
        { id: 11, name: 'minecraft:water', properties: { level: '7' } },
        { id: 12, name: 'minecraft:lava', properties: { level: '12' } },
        { id: 13, name: 'minecraft:oak_log', properties: { axis: 'x' } },
        { id: 14, name: 'minecraft:oak_log', properties: { axis: 'z' } }
    ]);
    assert.deepEqual([...mapping], [[0, 0], [10, 9 << 4], [11, (9 << 4) | 7], [12, (55 << 4) | 12], [13, (17 << 4) | 1], [14, (17 << 4) | 2]]);

    const chunk = new VanillaChunk(0, 0, 0, 128);
    chunk.setBlock(3, 64, 5, 11);
    const column = toLegacyBlockStateColumn(chunk, mapping);
    assert.equal(column[(64 << 8) | (5 << 4) | 3], (9 << 4) | 7);
});

test('client chunk adapter matches worker section buffers and heightmap layout', () => {
    const chunk = new VanillaChunk(-2, 3, 0, 128);
    chunk.setBlock(4, 15, 7, 1);
    chunk.setBlock(2, 16, 1, 2);
    chunk.setBlock(9, 127, 10, 3);
    chunk.heightmap[(7 << 4) | 4] = 16;
    chunk.heightmap[(1 << 4) | 2] = 17;
    chunk.heightmap[(10 << 4) | 9] = 128;

    const result = toLegacyChunkResult(chunk, new Map([[0, 0], [1, (1 << 4) | 2], [2, (9 << 4) | 5], [3, (3 << 4) | 1]]));
    assert.equal(result.x, -2);
    assert.equal(result.z, 3);
    assert.equal(result.sectionMask, (1 << 0) | (1 << 1) | (1 << 7));
    assert.equal(result.sections[0].blocks.length, 4096);
    assert.equal(result.sections[0].blocks[(15 << 8) | (7 << 4) | 4], 1);
    assert.equal(result.sections[0].blocksData[(15 << 8) | (7 << 4) | 4], 2);
    assert.equal(result.sections[1].blocks[(1 << 4) | 2], 9);
    assert.equal(result.sections[1].blocksData[(1 << 4) | 2], 5);
    assert.equal(result.sections[7].blocks[(15 << 8) | (10 << 4) | 9], 3);
    assert.equal(result.sections[7].blocksData[(15 << 8) | (10 << 4) | 9], 1);
    assert.equal(result.heightMap[(10 << 4) | 9], 128);
    assert.equal(result.sections[8], undefined);
});

test('legacy registry mapping only includes exact supported vanilla block names', () => {
    const mapping = createLegacyStateIdMap([
        { id: 10, name: 'minecraft:air' },
        { id: 11, name: 'minecraft:stone' },
        { id: 12, name: 'minecraft:grass_block' },
        { id: 13, name: 'minecraft:deepslate' },
        { id: 14, name: 'minecraft:end_stone' }
    ]);
    assert.deepEqual([...mapping], [[10, 0], [11, 1], [12, 2]]);
    assert.throws(() => createLegacyStateIdMap([
        { id: 11, name: 'minecraft:stone' },
        { id: 11, name: 'minecraft:dirt' }
    ]), /Conflicting/);
});

test('legacy adapter places mapped blocks in server y-z-x order and pads End height with air', () => {
    const chunk = new VanillaChunk(2, -3, 0, 128);
    chunk.setBlock(4, 0, 7, 101);
    chunk.setBlock(1, 127, 2, 202);

    const column = toLegacyBlockColumn(chunk, new Map([[0, 0], [101, 5], [202, 42]]));
    assert.equal(column.length, 16 * 256 * 16);
    assert.equal(column[(0 << 8) | (7 << 4) | 4], 5);
    assert.equal(column[(127 << 8) | (2 << 4) | 1], 42);
    assert.equal(column[(128 << 8) | (2 << 4) | 1], 0);
    assert.equal(column[(255 << 8) | (15 << 4) | 15], 0);
});

test('legacy adapter refuses unmapped states and unsupported vertical ranges', () => {
    const chunk = new VanillaChunk(0, 0, 0, 128);
    chunk.setBlock(0, 64, 0, 901);
    assert.throws(() => toLegacyBlockColumn(chunk, { 0: 0 }), /state 901/);

    const negative = new VanillaChunk(0, 0, -64, 384);
    assert.throws(() => toLegacyBlockColumn(negative, { 0: 0 }), /vertical range/);
    const tooTall = new VanillaChunk(0, 0, 0, 384);
    assert.throws(() => toLegacyBlockColumn(tooTall, { 0: 0 }), /vertical range/);
});
