import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VanillaChunk } from '../chunk.mjs';
import { createDecorationRegion } from '../decoration-region.mjs';
import { createChunkDecorationPipeline } from '../chunk-decoration.mjs';
import { createVanillaKernel } from '../runtime.mjs';
import { createNativeTreeRules } from '../native-tree-rules.mjs';
import { prepareVanillaTerrainAtlas } from '../../../src/js/net/minecraft/client/render/VanillaTerrainRenderer.js';
import VanillaRenderChunk from '../../../src/js/net/minecraft/client/world/VanillaRenderChunk.js';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url)));
const registry = JSON.parse(await readFile(new URL('../generated/block-states.json', import.meta.url)));
const stateRules = JSON.parse(await readFile(new URL('../generated/block-rules.json', import.meta.url)));
const biomeNames = ['minecraft:decoration_test'];
const air = { name: 'minecraft:air', properties: {} };
const dirt = { name: 'minecraft:dirt', properties: {} };
const dirtId = registry.states.find(state => state.name === dirt.name).id;
function chunks() {
    const result = new Map();
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
        const chunk = new VanillaChunk(x, z, 0, 32);
        for (let dx = 0; dx < 16; dx++) for (let dz = 0; dz < 16; dz++) chunk.setBlock(dx, 9, dz, dirtId);
        chunk.heightmap.fill(10);
        result.set(`${x},${z}`, chunk);
    }
    return result;
}
const rules = {
    canStateSurvive: () => true,
    heightmapPredicate: (type, state) => {
        assert.equal(type, 'WORLD_SURFACE_WG');
        return state.name !== 'minecraft:air';
    },
    isBlockInTag: () => false,
    isValidTreePos: () => true,
    isTreeFreePos: () => true,
    isAirOrLeaves: () => true,
    isWater: () => false,
    isVine: () => false
};
const kernel = await createVanillaKernel(await readFile(new URL('../generated/worldgen.wasm', import.meta.url)),
    JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url))));
after(() => kernel.dispose());

test('decoration region uses floor coordinates and exact state properties', () => {
    const region = createDecorationRegion({ chunks: chunks(), registry, biomeNames });
    region.transaction(() => region.setBlock(dirt, { x: -1, y: 20, z: -17 + 16 }));
    assert.equal(region.getBlockState({ x: -1, y: 20, z: -1 }).name, dirt.name);
    assert.throws(() => region.stateIdFor('minecraft:oak_log', {}), /Unknown decoration block state/);
    assert.throws(() => region.getBlockState({ x: 32, y: 20, z: 0 }), /unloaded neighbor/);
    assert.throws(() => region.setBlock(dirt, { x: 0, y: 20, z: 0 }), /transaction/);
    assert.equal(region.context.getBlockState({ x: 0, y: -1, z: 0 }).name, air.name);
});

test('tree ground decorator height adapter uses and invalidates the native no-leaves height cache', () => {
    const region = createDecorationRegion({ chunks: chunks(), registry, biomeNames,
        rules: { heightmapPredicate: (type, state) => {
            assert.equal(type, 'MOTION_BLOCKING_NO_LEAVES');
            return state.name !== 'minecraft:air';
        } } });
    const pos = { x: 0, y: 0, z: 0 };
    assert.equal(region.context.getMotionBlockingNoLeavesHeight(pos), 10);
    region.transaction(() => region.setBlock(dirt, { x: 0, y: 12, z: 0 }));
    assert.equal(region.context.getMotionBlockingNoLeavesHeight(pos), 13);
});

test('decoration commits native blocks and heightmap, rolls back failed cross-chunk writes and ticks', () => {
    const world = chunks();
    const region = createDecorationRegion({ chunks: world, registry, biomeNames });
    assert.throws(() => region.transaction(() => {
        region.setBlock(dirt, { x: -1, y: 20, z: 0 });
        region.scheduleTick(dirt, { x: -1, y: 20, z: 0 }, 2);
        region.setBlock(dirt, { x: 40, y: 20, z: 0 });
    }), /unloaded neighbor/);
    assert.equal(world.get('-1,0').getBlock(15, 20, 0), 0);
    assert.equal(world.get('-1,0').heightmap[15], 10);
    assert.equal(region.pendingTicks.length, 0);
    region.transaction(() => region.setBlock(dirt, { x: -1, y: 20, z: 0 }));
    assert.equal(world.get('-1,0').heightmap[15], 21);
    region.transaction(() => region.setBlock(air, { x: -1, y: 20, z: 0 }));
    assert.equal(world.get('-1,0').heightmap[15], 10);
    region.transaction(() => region.setBlock({ name: 'minecraft:cave_air', properties: {} }, { x: -1, y: 20, z: 0 }));
    assert.equal(world.get('-1,0').heightmap[15], 10);
});

function pipelineData(feature = 'minecraft:oak') {
    return { ...data,
        'data/minecraft/worldgen/biome/decoration_test.json': { features: [['minecraft:decoration_test']] },
        'data/minecraft/worldgen/placed_feature/decoration_test.json': {
            feature, placement: [{ type: 'minecraft:heightmap', heightmap: 'WORLD_SURFACE_WG' }]
        }
    };
}

test('natural decoration suppresses leaf litter while completing its feature', () => {
    const world = chunks();
    const testData = {
        ...pipelineData('minecraft:decoration_test'),
        'data/minecraft/worldgen/feature/decoration_test.json': {
            type: 'minecraft:simple_block',
            to_place: { id: 'minecraft:leaf_litter' }
        }
    };
    const pipeline = createChunkDecorationPipeline({ kernel, data: testData, registry, biomeNames,
        possibleBiomeOrder: biomeNames, rules: reader => createNativeTreeRules(data, registry, reader, stateRules) });
    const report = pipeline.decorate({ chunks: world, worldSeed: 1, chunkX: 0, chunkZ: 0 });

    assert.equal(report.results[0].result.succeeded, true);
    assert.equal(world.get('0,0').getBlock(0, 10, 0), 0);
});

test('post-processing retains native packed offsets and duplicates, and rolls back failed transactions', () => {
    const world = chunks();
    const region = createDecorationRegion({ chunks: world, registry, biomeNames });
    const pos = { x: -1, y: 20, z: -1 };
    assert.throws(() => region.context.markPosForPostProcessing(pos), /transaction/);
    region.transaction(() => {
        region.context.markPosForPostProcessing(pos);
        region.context.markPosForPostProcessing(pos);
        region.context.markPosForPostProcessing({ ...pos, y: 32 });
    });
    assert.deepEqual(region.postProcessing, Array(2).fill({ chunkX: -1, chunkZ: -1, sectionIndex: 1, packedOffset: 3919 }));
    assert.throws(() => region.transaction(() => {
        region.context.markPosForPostProcessing({ x: 0, y: 1, z: 0 });
        region.setBlock(dirt, { x: 0, y: 20, z: 0 });
        throw new Error('abort');
    }), /abort/);
    assert.equal(region.postProcessing.length, 2);
    assert.equal(region.getBlockState({ x: 0, y: 20, z: 0 }).name, air.name);
    const negative = new VanillaChunk(-1, -1, -64, 32);
    const below = createDecorationRegion({ chunks: new Map([['-1,-1', negative]]), registry, biomeNames });
    below.transaction(() => below.context.markPosForPostProcessing({ x: -1, y: -49, z: -1 }));
    assert.deepEqual(below.postProcessing, [{ chunkX: -1, chunkZ: -1, sectionIndex: 0, packedOffset: 4095 }]);
});
test('imported JAR oak places native log and foliage states into real neighboring render chunks', async () => {
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }),
        registerModTexture(name) { this.textureMap.set(name, { index: this._nextModIndex++ }); } };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    mapping.set(0, 0);
    const run = () => {
        const world = chunks();
        const region = createDecorationRegion({ chunks: world, registry, biomeNames });
        const pipeline = createChunkDecorationPipeline({ kernel, data: pipelineData(), registry, biomeNames,
            possibleBiomeOrder: biomeNames, rules: reader => createNativeTreeRules(data, registry, reader, stateRules) });
        const report = pipeline.decorate({ chunks: world, worldSeed: 1, chunkX: 0, chunkZ: 0 });
        assert.equal(report.stage, 'decoration');
        assert.equal(report.results.length, 1);
        assert.equal(report.results[0].result.succeeded, true);
        assert.equal(region.getBlockState({ x: 0, y: 10, z: 0 }).name, 'minecraft:oak_log');
        const leaves = new Set(registry.states.filter(state => state.name === 'minecraft:oak_leaves').map(state => state.id));
        assert.ok([...world.values()].filter(chunk => chunk.chunkX < 0 || chunk.chunkZ < 0).some(chunk => chunk.blocks.some(id => leaves.has(id))));
        for (const chunk of world.values()) {
            const render = VanillaRenderChunk.fromPayload({ minY: 0, maxY: 32, height: 32 }, chunk.serialize(), mapping);
            assert.deepEqual(render.native.blocks, chunk.blocks);
        }
        return [...world.values()].map(chunk => chunk.blocks);
    };
    assert.deepEqual(run(), run());
});

test('missing native heightmap predicates fail explicitly instead of guessing a surface', () => {
    const pipeline = createChunkDecorationPipeline({ kernel, data: pipelineData(), registry, biomeNames,
        possibleBiomeOrder: biomeNames, rules: { canStateSurvive: () => true } });
    const world = chunks();
    assert.throws(() => pipeline.decorate({ chunks: world, worldSeed: 1, chunkX: 0, chunkZ: 0 }), /native block predicates/);
    assert.equal(world.get('0,0').heightmap[0], 10);
});

test('native section writes respect radius-one write zone and invalidate height caches on rollback', () => {
    const world = chunks();
    const region = createDecorationRegion({ chunks: world, registry, biomeNames, rules,
        writeCenter: { chunkX: 0, chunkZ: 0 }, writeRadius: 1 });
    const pos = { x: -1, y: 20, z: 0 };
    assert.equal(region.context.ensureCanWrite(pos), true);
    assert.equal(region.context.ensureCanWrite({ x: -17, y: 20, z: 0 }), false);
    assert.equal(region.context.hasWritableSection({ x: 0, y: 32, z: 0 }), false);
    assert.equal(region.context.getHeight('WORLD_SURFACE_WG', -1, 0), 10);
    assert.throws(() => region.transaction(() => {
        region.context.setBlockInSection(dirt, pos, false);
        assert.equal(region.context.getHeight('WORLD_SURFACE_WG', -1, 0), 21);
        assert.equal(region.setBlock(dirt, { x: 32, y: 20, z: 0 }), false);
        throw new Error('Abort');
    }), /Abort/);
    assert.equal(region.context.getHeight('WORLD_SURFACE_WG', -1, 0), 10);
    region.transaction(() => region.context.setBlockInSection(dirt, pos, false));
    assert.equal(world.get('-1,0').getBlock(15, 20, 0), dirtId);
});

test('raw native quart-biome lookup clamps vertical coordinates like ChunkAccess', () => {
    const world = chunks();
    world.get('0,0').setBiome(0, 28, 0, 1);
    const region = createDecorationRegion({ chunks: world, registry, biomeNames: [...biomeNames, 'minecraft:upper_test'] });
    assert.equal(region.biomeAtBlock({ x: 0, y: 400, z: 0 }), 'minecraft:upper_test');
    assert.equal(region.biomeAtBlock({ x: 0, y: -100, z: 0 }), biomeNames[0]);
});
