import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import manifest from '../generated/terrain-render.json' with { type: 'json' };
import registry from '../generated/block-states.json' with { type: 'json' };
import decoration from '../generated/decoration-render.json' with { type: 'json' };
import features from '../generated/feature-render.json' with { type: 'json' };
import { terrainStateIds, createChunkService } from '../chunk-service.mjs';
import legacyMapping from '../reference/legacy-block-state-map.json' with { type: 'json' };
import { prepareVanillaTerrainAtlas, vanillaGrassColor, vanillaFoliageColor } from '../../../src/js/net/minecraft/client/render/VanillaTerrainRenderer.js';
import BlockRenderer from '../../../src/js/net/minecraft/client/render/BlockRenderer.js';
import BoundingBox from '../../../src/js/net/minecraft/util/BoundingBox.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import EnumBlockFace from '../../../src/js/net/minecraft/util/EnumBlockFace.js';
import VanillaRenderChunk from '../../../src/js/net/minecraft/client/world/VanillaRenderChunk.js';
import { VanillaChunk } from '../chunk.mjs';
import { clearVanillaBiomeTintCache, obfuscateBiomeZoomSeed, vanillaBiomeAtBlock } from '../biome-tint.mjs';

function atlas() {
    return {
        loaded: true, canvas: {}, textureMap: new Map([['stone', { index: 0 }]]),
        _nextModIndex: 1, texturesPerRow: 64,
        async loadImage() { return { width: 16, height: 16 }; },
        registerModTexture(key) { this.textureMap.set(key, { index: this._nextModIndex++ }); }
    };
}

function modelWorld(biomeName = 'minecraft:plains') {
    const native = new VanillaChunk(-1, -1);
    native.biomes.fill(manifest.biomeTints.findIndex(b => b.name === biomeName));
    const chunk = { native, getBlockDataAt: () => 0 };
    return { biomeZoomSeed: 0n, minecraft: { settings: { ambientOcclusion: false, biomeBlendRadius: 0 } }, getChunkAt: () => chunk,
        getBlockAt: () => 0, getBlockAtFace: () => 0, getTotalLightAt: () => 15 };
}

function recordingRenderer() {
    const renderer = Object.create(BlockRenderer.prototype);
    const draws = [], textures = [];
    renderer.worldRenderer = { textureAtlas: { isLoaded: () => true, getUVs: name => {
        textures.push(name);
        return { minU: 0.1, minV: 0.2, maxU: 0.3, maxV: 0.4 };
    } } };
    renderer.tessellator = { material: { alphaTest: 0 }, setColor() {} };
    renderer.addFace = (...args) => draws.push({ face: args[1], minY: args[7], maxY: args[10],
        minU: args[12], minV: args[13], maxU: args[14], maxV: args[15],
        color: args.slice(16, 19) });
    return { renderer, draws, textures };
}

test('native biome tint reads negative-coordinate quart cells, overrides and original colormap', () => {
    const world = modelWorld();
    const table = Buffer.from(manifest.grassColors.pixelsBase64, 'base64');
    const offset = (Math.floor((1 - 0.8) * 255) + Math.floor((1 - 0.4 * 0.8) * 255) * 256) * 3;
    assert.equal(vanillaGrassColor(world, -1, -64, -1), table[offset] << 16 | table[offset + 1] << 8 | table[offset + 2]);
    const native = world.getChunkAt(-1, -1).native;
    native.biomes.fill(manifest.biomeTints.findIndex(b => b.name === 'minecraft:badlands'));
    clearVanillaBiomeTintCache(world);
    assert.equal(vanillaGrassColor(world, -1, -64, -1), 0x90814d);
    assert.equal(vanillaGrassColor(world, -16, -64, -16), 0x90814d);
    assert.equal(vanillaGrassColor(modelWorld('minecraft:pale_garden'), -1, -64, -1), 0x778272);
    assert.equal(vanillaGrassColor(null, 0, 0, 0), 0x7cbd6b);
    assert.equal(vanillaGrassColor(world, -1, 320, -1), 0x90814d, 'vertical biome lookup clamps to the last section');
});

test('26.3 biome zoom seed uses SHA-256 hashLong bytes and fuzzy lookup handles negative quart positions', async () => {
    const seed = -912345678901234567n;
    const input = Buffer.alloc(8);
    input.writeBigInt64LE(seed);
    const expected = createHash('sha256').update(input).digest().readBigInt64LE(0);
    assert.equal(await obfuscateBiomeZoomSeed(seed), expected);
    const world = modelWorld();
    world.biomeZoomSeed = expected;
    assert.equal(vanillaBiomeAtBlock(world, -1, -64, -1), manifest.biomeTints.findIndex(b => b.name === 'minecraft:plains'));
});

test('grass and foliage tint blend neighboring biome colors over the configured vanilla radius', () => {
    const biomeId = name => manifest.biomeTints.findIndex(b => b.name === name);
    const plains = biomeId('minecraft:plains'), badlands = biomeId('minecraft:badlands');
    const chunks = new Map();
    for (let cx = 0; cx <= 1; cx++) for (let cz = 0; cz <= 1; cz++) {
        const native = new VanillaChunk(cx, cz);
        native.biomes.fill(cx === 0 ? plains : badlands);
        chunks.set(`${cx},${cz}`, { native });
    }
    const world = { biomeZoomSeed: 123456789n, minecraft: { settings: { biomeBlendRadius: 2 } },
        getChunkAt: (x, z) => chunks.get(`${x},${z}`) ?? { native: null } };
    const blendedGrass = vanillaGrassColor(world, 15, 64, 8);
    const blendedFoliage = vanillaFoliageColor(world, 15, 64, 8);
    const plainWorld = modelWorld('minecraft:plains');
    const plainGrass = vanillaGrassColor(plainWorld, 8, 64, 8);
    const plainFoliage = vanillaFoliageColor(plainWorld, 8, 64, 8);
    assert.notEqual(blendedGrass, plainGrass);
    assert.notEqual(blendedFoliage, plainFoliage);
    assert.ok(blendedGrass >= 0 && blendedGrass <= 0xffffff);
    assert.ok(blendedFoliage >= 0 && blendedFoliage <= 0xffffff);
});

test('decoration maps every imported leaf state to one shared cutout model and keeps vertical log textures', async () => {
    const mapping = await prepareVanillaTerrainAtlas(atlas());
    assert.equal(decoration.blocks.length, 38);
    for (const descriptor of decoration.blocks) {
        const packed = mapping.get(descriptor.stateId);
        for (const stateId of descriptor.stateIds) assert.equal(mapping.get(stateId), packed);
        if (descriptor.name.endsWith('_log')) {
            const axis = descriptor.properties.axis;
            const block = Block.getById(packed >> 4);
            assert.ok(['x', 'y', 'z'].includes(axis));
            for (const [face, shouldUseEnd] of [
                [EnumBlockFace.TOP, axis === 'y'], [EnumBlockFace.BOTTOM, axis === 'y'],
                [EnumBlockFace.NORTH, axis === 'z'], [EnumBlockFace.SOUTH, axis === 'z'],
                [EnumBlockFace.EAST, axis === 'x'], [EnumBlockFace.WEST, axis === 'x']
            ]) assert.equal(block.getTextureForFace(face).endsWith('_log_top'), shouldUseEnd,
                `${descriptor.name} axis ${axis} face ${face.getName()}`);
            for (const [face, expectedRotation] of [
                [EnumBlockFace.TOP, axis === 'x' ? 1 : 0], [EnumBlockFace.BOTTOM, axis === 'x' ? 1 : 0],
                [EnumBlockFace.NORTH, axis === 'x' ? 1 : 0], [EnumBlockFace.SOUTH, axis === 'x' ? 1 : 0],
                [EnumBlockFace.EAST, axis === 'z' ? 1 : 0], [EnumBlockFace.WEST, axis === 'z' ? 1 : 0]
            ]) assert.equal(block.getRotationForFace(face), expectedRotation,
                `${descriptor.name} axis ${axis} UV rotation on ${face.getName()}`);
        } else {
            const { renderer, draws } = recordingRenderer();
            renderer.renderBlock(modelWorld(), Block.getById(packed >> 4), false, -1, -64, -1);
            assert.equal(draws.length, 6);
            assert.equal(renderer.tessellator.material.alphaTest, 0.1);
            assert.equal(Block.getById(packed >> 4).isSolid(), true);
        }
    }
});

test('native leaves use foliage colormap and distinct spruce/birch constants, not grass tint', async () => {
    const world = modelWorld();
    const table = Buffer.from(decoration.foliageColors.pixelsBase64, 'base64');
    const offset = (Math.floor((1 - 0.8) * 255) + Math.floor((1 - 0.4 * 0.8) * 255) * 256) * 3;
    assert.equal(vanillaFoliageColor(world, -1, -64, -1), table[offset] << 16 | table[offset + 1] << 8 | table[offset + 2]);
    const mapping = await prepareVanillaTerrainAtlas(atlas());
    for (const [name, tint] of [['spruce', 0x619961], ['birch', 0x80a755]]) {
        const descriptor = decoration.blocks.find(block => block.name === `minecraft:${name}_leaves`);
        const { renderer, draws } = recordingRenderer();
        renderer.renderBlock(world, Block.getById(mapping.get(descriptor.stateId) >> 4), false, -1, -64, -1);
        assert.deepEqual(draws[0].color, [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255]);
    }
});

test('dark forest applies the native 26.3 grass-color modifier after colormap lookup', () => {
    const biome = manifest.biomeTints.findIndex(b => b.name === 'minecraft:dark_forest');
    const world = modelWorld('minecraft:dark_forest');
    const base = Buffer.from(manifest.grassColors.pixelsBase64, 'base64');
    const info = manifest.biomeTints[biome];
    const temperature = Math.max(0, Math.min(1, info.temperature));
    const downfall = Math.max(0, Math.min(1, info.downfall)) * temperature;
    const pixel = (Math.floor((1 - temperature) * 255) + Math.floor((1 - downfall) * 255) * 256) * 3;
    const colormap = base[pixel] << 16 | base[pixel + 1] << 8 | base[pixel + 2];
    assert.equal(vanillaGrassColor(world, -1, -64, -1), ((colormap & 0xfefefe) + 0x28340a >> 1) & 0xffffff);
});

test('decoration model and PNG resources are exact pinned-JAR bytes', async () => {
    const zip = await JSZip.loadAsync(await readFile(process.env.MINECRAFT_JAR ?? '/home/_doxism/minecraft-client-26.3.jar'));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(decoration.source.sha256, manifest.source.sha256);
    for (const [path, expected] of Object.entries(decoration.resources)) assert.equal(hash(await zip.file(path).async('nodebuffer')), expected);
    for (const texture of Object.values(decoration.textures)) assert.equal(hash(await zip.file(texture.source).async('nodebuffer')), texture.sha256);
    const colors = await zip.file(decoration.foliageColors.source).async('nodebuffer');
    assert.equal(hash(colors), decoration.foliageColors.sha256);
    assert.deepEqual(await sharp(colors).removeAlpha().raw().toBuffer(), Buffer.from(decoration.foliageColors.pixelsBase64, 'base64'));
});

test('actual renderer draws grass base plus four tinted cutout overlays with neighbor culling', async () => {
    const mapping = await prepareVanillaTerrainAtlas(atlas());
    const grass = manifest.blocks.find(b => b.name === 'minecraft:grass_block');
    const block = Block.getById(mapping.get(grass.stateId) >> 4);
    const world = modelWorld('minecraft:badlands');
    const { renderer, draws, textures } = recordingRenderer();
    renderer.renderBlock(world, block, false, -1, -64, -1);
    assert.equal(draws.length, 10);
    assert.equal(textures.filter(t => t.endsWith('grass_block_side_overlay')).length, 4);
    for (let i = 0; i < draws.length; i++) {
        const tinted = i === 1 || i >= 6;
        assert.deepEqual(draws[i].color, tinted ? [0x90 / 255, 0x81 / 255, 0x4d / 255] : [1, 1, 1]);
    }
    assert.equal(renderer.tessellator.material.alphaTest, 0.1);
    const neighbor = new Block(1000);
    world.getBlockAtFace = (x, y, z, face) => face === EnumBlockFace.NORTH ? neighbor.id : 0;
    draws.length = 0;
    renderer.renderBlock(world, block, false, -1, -64, -1);
    assert.equal(draws.length, 8);
    assert.ok(draws.every(draw => draw.face !== EnumBlockFace.NORTH));
});

test('actual powder snow shell keeps thin geometry, mirrored inner UVs and shared cullface', async () => {
    const mapping = await prepareVanillaTerrainAtlas(atlas());
    const descriptor = manifest.blocks.find(b => b.name === 'minecraft:powder_snow');
    const block = Block.getById(mapping.get(descriptor.stateId) >> 4);
    const world = modelWorld();
    const { renderer, draws } = recordingRenderer();
    renderer.renderBlock(world, block, false, -1, -64, -1);
    assert.equal(draws.length, 12);
    assert.equal(draws[0].minY, -64 + 15.998 / 16);
    assert.equal(draws[0].maxY, -63);
    assert.equal(draws[0].minV, draws[1].maxV);
    assert.equal(draws[0].maxV, draws[1].minV);
    assert.ok(draws[5].minU > draws[5].maxU);
    assert.equal(block.getCollisionBoundingBox(world, -1, -64, -1), null);
    const neighbor = new Block(1001);
    world.getBlockAtFace = (x, y, z, face) => face === EnumBlockFace.TOP ? neighbor.id : 0;
    draws.length = 0;
    renderer.renderBlock(world, block, false, -1, -64, -1);
    assert.equal(draws.length, 10);
    assert.ok(draws.every(draw => draw.minY !== -64 + 15.998 / 16));
});

test('legacy partial-block UV cropping stays unchanged outside the native model path', () => {
    const { renderer, draws } = recordingRenderer();
    const block = new Block(1002);
    renderer.renderFace(null, block, new BoundingBox(0, 0, 0, 1, 0.5, 1), EnumBlockFace.NORTH, false, 0, 0, 0);
    assert.ok(Math.abs(draws[0].minV - 0.7) < 1e-12);
    assert.ok(Math.abs(draws[0].maxV - 0.6) < 1e-12);
});

test('terrain manifest uses exact default states and explicit unsupported models', () => {
    const states = terrainStateIds(registry);
    assert.ok(manifest.blocks.length > 49);
    assert.ok(Object.keys(manifest.textures).length > 62);
    for (const block of manifest.blocks) {
        const nativeState = registry.states[block.stateId];
        assert.equal(nativeState.name, block.name);
        assert.deepEqual(nativeState.properties, block.properties);
        if (block.properties.snowy !== 'true' && !block.properties.axis) assert.equal(block.stateId, states[block.name]);
        assert.equal(Object.keys(block.faces).length, 6);
        for (const texture of Object.values(block.faces)) assert.ok(manifest.textures[texture]);
    }
    for (const wood of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']) {
        const logs = manifest.blocks.filter(block => block.name === `minecraft:${wood}_log`);
        assert.deepEqual(logs.map(block => block.properties.axis).sort(), ['x', 'y', 'z'], wood);
        for (const block of logs) {
            const endFaces = block.properties.axis === 'x' ? ['east', 'west'] :
                block.properties.axis === 'y' ? ['up', 'down'] : ['north', 'south'];
            for (const face of ['up', 'down', 'north', 'south', 'east', 'west']) {
                assert.equal(block.faces[face], `minecraft:block/${wood}_log${endFaces.includes(face) ? '_top' : ''}`);
            }
        }
    }
    assert.deepEqual(manifest.unsupported, []);
});

test('snow-covered soil states have their exact vanilla model and render mapping', async () => {
    const podzolStates = registry.states.filter(state => state.name === 'minecraft:podzol');
    const descriptors = manifest.blocks.filter(block => block.name === 'minecraft:podzol');
    assert.deepEqual(descriptors.map(block => block.stateId).sort((a, b) => a - b), podzolStates.map(state => state.id));
    const snowy = descriptors.find(block => block.properties.snowy === 'true');
    assert.ok(snowy);
    assert.equal(snowy.faces.up, 'minecraft:block/grass_block_top');
    for (const face of ['north', 'south', 'east', 'west']) assert.equal(snowy.faces[face], 'minecraft:block/grass_block_snow');

    const mapping = await prepareVanillaTerrainAtlas(atlas());
    for (const state of podzolStates) assert.ok(mapping.has(state.id), `missing podzol snowy=${state.properties.snowy}`);
    const snowyBlock = Block.getById(mapping.get(snowy.stateId) >> 4);
    assert.equal(snowyBlock.getTextureForFace(EnumBlockFace.NORTH), 'vanilla26_3:minecraft:block/grass_block_snow');
});

test('PNG bytes, blockstate JSON and model parents match pinned reference JAR', async () => {
    const bytes = await readFile(process.env.MINECRAFT_JAR ?? '/home/_doxism/minecraft-client-26.3.jar');
    const hash = b => createHash('sha256').update(b).digest('hex');
    assert.equal(hash(bytes), manifest.source.sha256);
    const zip = await JSZip.loadAsync(bytes);
    for (const [path, expected] of Object.entries(manifest.resources)) assert.equal(hash(await zip.file(path).async('nodebuffer')), expected, path);
    for (const texture of Object.values(manifest.textures)) {
        const png = await zip.file(texture.source).async('nodebuffer');
        assert.equal(hash(png), texture.sha256);
        assert.deepEqual(Buffer.from(texture.dataUrl.split(',')[1], 'base64'), png);
        assert.equal(png.readUInt32BE(16), 16);
        assert.equal(png.readUInt32BE(20), 16);
    }
    const colorBytes = await zip.file(manifest.grassColors.source).async('nodebuffer');
    assert.equal(hash(colorBytes), manifest.grassColors.sha256);
    assert.deepEqual(await sharp(colorBytes).removeAlpha().raw().toBuffer(), Buffer.from(manifest.grassColors.pixelsBase64, 'base64'));
    for (const name of ['grass_block', 'powder_snow']) {
        const model = JSON.parse(await zip.file(`assets/minecraft/models/block/${name}.json`).async('string'));
        const descriptor = manifest.blocks.find(block => block.name === `minecraft:${name}`);
        assert.equal(descriptor.elements.length, model.elements.length);
        model.elements.forEach((part, i) => {
            assert.deepEqual(descriptor.elements[i].from, part.from);
            assert.deepEqual(descriptor.elements[i].to, part.to);
            for (const [face, entry] of Object.entries(part.faces)) {
                const actual = descriptor.elements[i].faces[face];
                assert.deepEqual(actual.uv, entry.uv);
                assert.equal(actual.tintindex, entry.tintindex);
                assert.equal(actual.cullface, entry.cullface);
            }
        });
    }
});

test('registration preserves legacy textures and occupied block IDs, assigns native cube faces', async () => {
    const occupied = new Block(2048);
    const target = atlas();
    const legacy = target.textureMap.get('stone');
    const mapping = await prepareVanillaTerrainAtlas(target);
    assert.equal(Block.getById(2048), occupied);
    assert.equal(target.textureMap.get('stone'), legacy);
    const descriptor = manifest.blocks.find(block => block.name === 'minecraft:deepslate');
    const block = Block.getById(mapping.get(descriptor.stateId) >> 4);
    assert.equal(block.getTextureForFace(EnumBlockFace.TOP), 'vanilla26_3:minecraft:block/deepslate_top');
    assert.equal(block.getTextureForFace(EnumBlockFace.NORTH), 'vanilla26_3:minecraft:block/deepslate');
    const ice = manifest.blocks.find(block => block.name === 'minecraft:ice');
    assert.equal(Block.getById(mapping.get(ice.stateId) >> 4).isTranslucent(), true);
    const stone = manifest.blocks.find(block => block.name === 'minecraft:stone');
    assert.equal(Block.getById(mapping.get(stone.stateId) >> 4).isTranslucent(), false);
});

test('Vanillith maps every former legacy state to pinned-JAR textures only', async () => {
    const mapping = await prepareVanillaTerrainAtlas(atlas());
    for (const entry of legacyMapping.mappings) assert.ok(mapping.has(entry.stateId), registry.states[entry.stateId].name);
    for (const name of ['water', 'lava']) {
        const states = registry.states.filter(state => state.name === `minecraft:${name}`);
        const ids = new Set(states.map(state => mapping.get(state.id) >> 4));
        assert.equal(ids.size, 1);
        const block = Block.getById([...ids][0]);
        assert.equal(block.getTextureForFace(EnumBlockFace.TOP), `vanilla26_3:minecraft:block/${name}_still`);
        assert.equal(block.isLiquid(), true);
        for (const state of states) assert.equal(mapping.get(state.id) & 15, Number(state.properties.level));
    }
    const plains = modelWorld('minecraft:plains');
    const water = Block.getById(mapping.get(registry.states.find(state => state.name === 'minecraft:water').id) >> 4);
    assert.equal(water.getColor(plains, -1, -64, -1), 0x3f76e4);
});

test('unready, full, failed images and atlas reload during decode fail before mutation', async () => {
    for (const mode of ['unready', 'full', 'decode', 'size', 'reload']) {
        const target = atlas();
        if (mode === 'unready') target.loaded = false;
        if (mode === 'full') target._nextModIndex = 4090;
        await assert.rejects(prepareVanillaTerrainAtlas(target, async () => {
            if (mode === 'decode') throw new Error('image failed');
            if (mode === 'reload') target.canvas = {};
            return { width: mode === 'size' ? 32 : 16, height: 16 };
        }));
        assert.equal(target.textureMap.size, 1);
    }
});

test('concurrent preparation is deduplicated and atlas reload restores names without extra block IDs', async () => {
    const target = atlas();
    const [first, second] = await Promise.all([prepareVanillaTerrainAtlas(target), prepareVanillaTerrainAtlas(target)]);
    assert.deepEqual(first, second);
    const textures = Object.keys({ ...manifest.textures, ...decoration.textures, ...features.textures }).length;
    assert.equal(target._nextModIndex, textures + 1);
    const count = Block.blocks.size;
    target.canvas = {};
    target.textureMap = new Map();
    target._nextModIndex = 0;
    assert.deepEqual(await prepareVanillaTerrainAtlas(target), first);
    assert.equal(target._nextModIndex, textures);
    assert.equal(Block.blocks.size, count);
});

test('native render chunk preserves modern states while using registered cube render IDs', async () => {
    const mapping = await prepareVanillaTerrainAtlas(atlas());
    mapping.set(0, 0);
    const native = new VanillaChunk(-1, 0);
    const names = ['deepslate', 'tuff', 'sandstone', 'end_stone'];
    names.forEach((name, x) => native.setBlock(x, -64, 0, manifest.blocks.find(block => block.name === `minecraft:${name}`).stateId));
    const spruceLogs = manifest.blocks.filter(block => block.name === 'minecraft:spruce_log');
    spruceLogs.forEach((block, x) => native.setBlock(x + 5, -64, 0, block.stateId));
    const world = { minY: -64, maxY: 320, height: 384 };
    const render = VanillaRenderChunk.fromPayload(world, native.serialize(), mapping);
    names.forEach((name, x) => {
        const state = manifest.blocks.find(block => block.name === `minecraft:${name}`).stateId;
        assert.equal(render.getBlockAt(x, -64, 0), mapping.get(state) >> 4);
        assert.equal(render.native.blocks[native.index(x, -64, 0)], state);
    });
    spruceLogs.forEach((block, x) => {
        assert.ok(mapping.has(block.stateId), `missing render mapping for spruce_log axis=${block.properties.axis}`);
        assert.equal(render.getBlockAt(x + 5, -64, 0), mapping.get(block.stateId) >> 4);
        const rendered = Block.getById(mapping.get(block.stateId) >> 4);
        for (const face of [EnumBlockFace.TOP, EnumBlockFace.BOTTOM, EnumBlockFace.NORTH,
            EnumBlockFace.SOUTH, EnumBlockFace.EAST, EnumBlockFace.WEST]) {
            const faceName = face.getName();
            const expected = block.faces[faceName === 'top' ? 'up' : faceName === 'bottom' ? 'down' : faceName];
            assert.equal(rendered.getTextureForFace(face), `vanilla26_3:${expected}`);
        }
    });
});

test('sampled real WASM terrain has mapped or explicitly pending states in all three dimensions', async () => {
    const json = async name => JSON.parse(await readFile(new URL(`../generated/${name}.json`, import.meta.url)));
    const service = await createChunkService({ bytes: await readFile(new URL('../generated/worldgen.wasm', import.meta.url)),
        registry, climate: await json('climate'), data: await json('vanilla-data') });
    const mapping = new Map(legacyMapping.mappings.map(entry => [entry.stateId, entry.packedState]));
    for (const [state, packed] of await prepareVanillaTerrainAtlas(atlas())) mapping.set(state, packed);
    const defaults = terrainStateIds(registry);
    const pending = new Set(manifest.unsupported.map(block => defaults[block.name]));
    try {
        for (const settings of ['overworld', 'nether', 'end']) {
            for (const seed of ['1', '-9223372036854775808']) {
                const result = service.generate({ settings, seed, coords: [[0, 0], [-1, 2]] });
                for (const chunk of result.chunks) for (const state of new Set(chunk.blocks)) {
                    assert.ok(mapping.has(state) || pending.has(state), `${settings}/${seed}: unmapped state ${state}`);
                }
            }
        }
    } finally { service.dispose(); }
});
