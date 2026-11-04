import test from 'node:test';
import assert from 'node:assert/strict';
import MinecraftLightEngine from '../../../src/js/net/minecraft/client/world/MinecraftLightEngine.js';
import stateRules from '../generated/block-rules.json' with { type: 'json' };
import registry from '../generated/block-states.json' with { type: 'json' };

const stateId = name => stateRules.defaults[name];

function makeChunk(x, z, minY = 0, height = 16) {
    const blocks = new Uint32Array(height * 256);
    const sections = Array.from({ length: height / 16 }, () => ({
        skyLight: new Uint8Array(4096), blockLight: new Uint8Array(4096), isModified: false, isDirty: false
    }));
    const chunk = {
        x, z, minY, height, sections, loaded: true,
        native: {
            getBlock(bx, by, bz) { return blocks[(by - minY) * 256 + bz * 16 + bx]; },
            setBlock(bx, by, bz, id) { blocks[(by - minY) * 256 + bz * 16 + bx] = id; }
        }
    };
    return chunk;
}

function makeEngine(height = 16) {
    const world = { minY: 0, maxY: height, height, chunkProvider: {
        chunks: new Map(), chunkKey: (x, z) => `${x},${z}`
    } };
    return new MinecraftLightEngine(world);
}

function light(chunk, layer, x, y, z) {
    const section = chunk.sections[Math.floor(y / 16)];
    const index = ((y & 15) << 8) | (z << 4) | x;
    return (layer === 'block' ? section.blockLight : section.skyLight)[index];
}

test('26.3 sky source columns keep direct sky and occlusion/opacity boundaries', () => {
    const engine = makeEngine();
    const chunk = makeChunk(0, 0);
    chunk.native.setBlock(8, 8, 8, stateId('minecraft:stone'));
    engine.initializeChunk(chunk);
    assert.equal(light(chunk, 'sky', 8, 9, 8), 15);
    assert.equal(light(chunk, 'sky', 8, 8, 8), 0);
    assert.ok(light(chunk, 'sky', 8, 7, 8) > 0, 'sky light should enter below a roof from adjacent exposed columns');
    assert.equal(chunk.sections[0].isModified, true);
});

test('26.3 sky light seeds the top source layer even when adjacent columns share the same height', () => {
    const engine = makeEngine();
    const chunk = makeChunk(0, 0);
    for (let y = 0; y < 8; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        chunk.native.setBlock(x, y, z, stateId('minecraft:water'));
    }
    engine.initializeChunk(chunk);
    assert.equal(light(chunk, 'sky', 8, 8, 8), 15);
    assert.equal(light(chunk, 'sky', 8, 7, 8), 14);
    assert.equal(light(chunk, 'sky', 8, 6, 8), 13);
});

test('26.3 block light uses native emission, minimum attenuation and chunk-boundary propagation', () => {
    const engine = makeEngine();
    const first = makeChunk(0, 0), second = makeChunk(1, 0);
    first.native.setBlock(15, 8, 8, stateId('minecraft:torch'));
    second.native.setBlock(2, 8, 8, stateId('minecraft:stone'));
    engine.initializeChunk(first);
    assert.equal(light(first, 'block', 15, 8, 8), 14);
    assert.equal(light(first, 'block', 14, 8, 8), 13);
    engine.initializeChunk(second);
    assert.equal(light(second, 'block', 0, 8, 8), 13);
    assert.equal(light(second, 'block', 1, 8, 8), 12);
    assert.equal(light(second, 'block', 2, 8, 8), 0);
    assert.equal(stateRules.states[stateId('minecraft:torch')].lightEmission, 14);
});

test('shape-aware occlusion joins complementary 26.3 face masks', () => {
    const engine = makeEngine();
    const stickyDown = registry.states.find(state => state.name === 'minecraft:sticky_piston' && state.properties.extended === 'true' && state.properties.facing === 'down');
    const stickyUp = registry.states.find(state => state.name === 'minecraft:sticky_piston' && state.properties.extended === 'true' && state.properties.facing === 'up');
    assert.ok(stickyDown && stickyUp);
    assert.equal(engine.faceShapeOccludes(stateRules.states[stickyDown.id], stateRules.states[stickyUp.id], 5), true);
    assert.equal(engine.faceShapeOccludes(stateRules.states[stateId('minecraft:torch')], stateRules.states[stateId('minecraft:air')], 5), false);
});

test('incremental light checks remove stale block light and recompute sky-source columns', () => {
    const engine = makeEngine();
    const chunk = makeChunk(0, 0);
    chunk.native.setBlock(8, 8, 8, stateId('minecraft:torch'));
    engine.initializeChunk(chunk);
    assert.equal(light(chunk, 'block', 9, 8, 8), 13);
    chunk.native.setBlock(8, 8, 8, stateId('minecraft:air'));
    engine.checkBlock(8, 8, 8);
    engine.runUpdates(4096);
    assert.equal(light(chunk, 'block', 9, 8, 8), 0);

    chunk.native.setBlock(8, 8, 8, stateId('minecraft:stone'));
    engine.checkBlock(8, 8, 8);
    engine.runUpdates(4096);
    assert.equal(light(chunk, 'sky', 8, 8, 8), 0);
    assert.ok(light(chunk, 'sky', 8, 7, 8) > 0);
});
