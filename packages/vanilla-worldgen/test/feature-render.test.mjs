import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import manifest from '../generated/feature-render.json' with { type: 'json' };
import { nativeFeatureQuads } from '../../../src/js/net/minecraft/client/render/VanillaFeatureGeometry.js';
import { prepareVanillaTerrainAtlas, vanillaFoliageColor } from '../../../src/js/net/minecraft/client/render/VanillaTerrainRenderer.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import VanillaRenderChunk from '../../../src/js/net/minecraft/client/world/VanillaRenderChunk.js';
import { VanillaChunk } from '../chunk.mjs';
import TextureAtlas from '../../../src/js/net/minecraft/client/render/TextureAtlas.js';

test('feature PNGs and model/blockstate resources match the pinned JAR', async () => {
    const zip = await JSZip.loadAsync(await readFile('/home/_doxism/minecraft-client-26.3.jar'));
    const hash = b => createHash('sha256').update(b).digest('hex');
    for (const [path, sha] of Object.entries(manifest.resources)) assert.equal(hash(await zip.file(path).async('nodebuffer')), sha);
    for (const texture of Object.values(manifest.textures)) assert.equal(hash(await zip.file(texture.source).async('nodebuffer')), texture.sha256);
});

test('seagrass cross, ore cubes and directional lichen bake finite native geometry and UVs', () => {
    const grass = manifest.blocks.find(b => b.name === 'minecraft:seagrass');
    assert.equal(nativeFeatureQuads(grass).length, 8);
    const ore = manifest.blocks.find(b => b.name === 'minecraft:iron_ore');
    assert.equal(nativeFeatureQuads(ore).length, 6);
    for (const b of manifest.blocks) for (const q of nativeFeatureQuads(b)) {
        assert.equal(q.points.length, 4);
        assert.ok(q.points.flat().every(Number.isFinite));
        assert.ok(q.uv.flat().every(Number.isFinite));
    }
    const east = manifest.blocks.find(b => b.name === 'minecraft:glow_lichen' && b.properties.east === 'true' && ['down','up','north','south','west'].every(f => b.properties[f] === 'false'));
    assert.ok(nativeFeatureQuads(east).every(q => q.points.every(p => p[0] > 0.9)));
});

test('dungeon chests and spawners have native-source render mappings for every used state', async () => {
    const chests = manifest.blocks.filter(block => block.name === 'minecraft:chest');
    const spawner = manifest.blocks.find(block => block.name === 'minecraft:spawner');
    assert.equal(chests.length, 24);
    assert.ok(spawner);
    assert.ok(chests.every(block => block.blockEntityApproximation === 'static_chest'));
    for (const block of [...chests, spawner]) {
        const quads = nativeFeatureQuads(block);
        assert.ok(quads.length >= 6, block.name);
        assert.ok(quads.flatMap(quad => quad.points.flat()).every(Number.isFinite));
    }

    const chestTexture = manifest.textures['minecraft:block/vanillith_chest_front'];
    const zip = await JSZip.loadAsync(await readFile('/home/_doxism/minecraft-client-26.3.jar'));
    const source = await zip.file(chestTexture.source).async('nodebuffer');
    const derived = await sharp(source).extract(chestTexture.crop).resize(16, 16, { kernel: 'nearest' }).png().toBuffer();
    assert.equal(createHash('sha256').update(derived).digest('hex'), chestTexture.derivedSha256);
    assert.deepEqual(Buffer.from(chestTexture.dataUrl.split(',')[1], 'base64'), derived);

    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); } };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    for (const block of [...chests, spawner]) assert.ok(mapping.has(block.stateId), `${block.name} state ${block.stateId}`);
    const sample = new VanillaChunk(0, 0);
    const dungeonChest = chests.find(block => block.stateId === 5562) ?? chests[0];
    sample.setBlock(0, 20, 0, dungeonChest.stateId);
    sample.setBlock(1, 20, 0, spawner.stateId);
    const rendered = VanillaRenderChunk.fromPayload({ minY: -64, maxY: 320, height: 384 }, sample.serialize(), mapping);
    assert.equal(rendered.getBlockAt(0, 20, 0), mapping.get(dungeonChest.stateId) >> 4);
    assert.equal(rendered.getBlockAt(1, 20, 0), mapping.get(spawner.stateId) >> 4);
});

test('cocoa states have native JAR model and texture mappings', () => {
    const cocoaStates = manifest.blocks.filter(block => block.name === 'minecraft:cocoa');
    assert.equal(cocoaStates.length, 12);
    assert.ok(cocoaStates.every(block => nativeFeatureQuads(block).length > 0));
});

test('shelf mushrooms have native cutout models and render mappings for every age and facing state', async () => {
    const mushrooms = manifest.blocks.filter(block => block.name === 'minecraft:shelf_mushroom');
    assert.equal(mushrooms.length, 8);
    assert.ok(mushrooms.every(block => block.cutout && !block.solid && nativeFeatureQuads(block).length > 0));
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); } };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    for (const block of mushrooms) assert.ok(mapping.has(block.stateId), `${block.name} state ${block.stateId}`);

    const chunk = new VanillaChunk(0, 0);
    chunk.setBlock(0, 64, 0, mushrooms.find(block => block.stateId === 11230).stateId);
    const rendered = VanillaRenderChunk.fromPayload({ minY: -64, maxY: 320, height: 384 }, chunk.serialize(), mapping);
    assert.equal(rendered.getBlockAt(0, 64, 0), mapping.get(11230) >> 4);
});

test('native tree saplings and mangrove propagules have JAR models and placeable state mappings', async () => {
    const names = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak']
        .map(name => `minecraft:${name}_sapling`).concat('minecraft:mangrove_propagule');
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); } };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    for (const name of names) {
        const variants = manifest.blocks.filter(block => block.name === name);
        assert.ok(variants.length > 0, `${name} imported from the pinned JAR`);
        assert.ok(variants.every(block => nativeFeatureQuads(block).length > 0), `${name} has a native model`);
        assert.ok(variants.every(block => mapping.has(block.stateId)), `${name} states map to placeable render blocks`);
    }
});

test('leaf litter uses cutout leaves and vines import every vanilla multipart face state', async () => {
    const litter = manifest.blocks.filter(block => block.name === 'minecraft:leaf_litter');
    const vines = manifest.blocks.filter(block => block.name === 'minecraft:vine');
    assert.equal(litter.length, 16);
    assert.equal(vines.length, 32);
    assert.ok(litter.every(block => block.cutout && !block.solid));
    assert.ok(litter.every(block => block.tintType === 'foliage'));
    assert.ok(vines.every(block => block.cutout && !block.solid));
    assert.ok(litter.every(block => nativeFeatureQuads(block).length === (block.properties.segment_amount === '3' ? 4 : 2)));
    const expectedFootprints = { '1': [[0, 0, 0.5, 0.5]], '2': [[0, 0, 0.5, 1]],
        '3': [[0, 0, 0.5, 1], [0.5, 0.5, 1, 1]], '4': [[0, 0, 1, 1]] };
    const expectedUVs = { '1': [[[0,0,8,8],[0,8,8,0]]], '2': [[[0,0,8,16],[0,16,8,0]]],
        '3': [[[0,0,8,16],[0,16,8,0]], [[8,8,16,16],[8,16,16,8]]],
        '4': [[[0,0,16,16],[0,16,16,0]]] };
    for (const block of litter) {
        const direction = { north: 0, east: 90, south: 180, west: 270 }[block.properties.facing];
        const footprints = nativeFeatureQuads(block).filter(quad => quad.face === 'up');
        assert.equal(footprints.length, Number(block.properties.segment_amount) === 3 ? 2 : 1);
        assert.equal(block.parts.length, expectedUVs[block.properties.segment_amount].length);
        block.parts.forEach((part, i) => {
            const element = part.elements[0];
            assert.equal(element.from[1], 0.25);
            assert.equal(element.to[1], 0.25);
            assert.deepEqual(element.faces.up.uv, expectedUVs[block.properties.segment_amount][i][0]);
            assert.deepEqual(element.faces.down.uv, expectedUVs[block.properties.segment_amount][i][1]);
        });
        const clean = n => Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e9) / 1e9;
        const actual = footprints.map(quad => [Math.min(...quad.points.map(p => p[0])), Math.min(...quad.points.map(p => p[2])),
            Math.max(...quad.points.map(p => p[0])), Math.max(...quad.points.map(p => p[2]))].map(clean));
        const rotatePoint = ([x, z]) => direction === 0 ? [x, z] : direction === 90 ? [1 - z, x]
            : direction === 180 ? [1 - x, 1 - z] : [z, 1 - x];
        const expected = expectedFootprints[block.properties.segment_amount].map(([x0,z0,x1,z1]) => {
            const points = [[x0,z0],[x0,z1],[x1,z0],[x1,z1]].map(rotatePoint);
            return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
                Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))].map(clean);
        });
        assert.deepEqual(actual.sort((a,b) => a[0]-b[0] || a[1]-b[1]), expected.sort((a,b) => a[0]-b[0] || a[1]-b[1]));
        for (const quad of nativeFeatureQuads(block)) assert.equal(quad.tintType, 'foliage');
    }
    assert.ok(vines.every(block => nativeFeatureQuads(block).length >= 2));
    assert.ok(vines.some(block => Object.values(block.properties).every(value => value === 'false') && block.parts.length === 5));

    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); },
        getUVs: () => ({ minU: 0, maxU: 1, minV: 0, maxV: 1 }) };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    for (const block of [...litter, ...vines]) assert.ok(mapping.has(block.stateId));
    const sample = new VanillaChunk(0, 0);
    sample.setBlock(0, 20, 0, litter.find(block => block.properties.segment_amount === '3').stateId);
    sample.setBlock(1, 20, 0, vines.find(block => block.properties.north === 'true' && block.properties.up === 'false').stateId);
    const rendered = VanillaRenderChunk.fromPayload({ minY: -64, maxY: 320, height: 384 }, sample.serialize(), mapping);
    const vertices = [];
    const renderer = { worldRenderer: { textureAtlas: atlas }, tessellator: { material: { alphaTest: 0 }, setColor() {}, addVertexWithUV: (...args) => vertices.push(args) } };
    for (let x = 0; x < 2; x++) Block.getById(rendered.getBlockAt(x, 20, 0)).onRender(null, x, 20, 0, renderer);
    assert.equal(renderer.tessellator.material.alphaTest, 0.1);
    assert.ok(vertices.length > 0);

    const native = new VanillaChunk(0, 0);
    native.biomes.fill(0);
    const world = { getChunkAt: () => ({ native }) };
    const colors = [];
    const colorRenderer = { getEffectiveLightLevel: () => 15, worldRenderer: { textureAtlas: atlas },
        tessellator: { material: { alphaTest: 0 }, setColor: (...rgb) => colors.push(rgb), addVertexWithUV() {} } };
    const litterBlock = Block.getById(mapping.get(litter[0].stateId) >> 4);
    litterBlock.onRender(world, 0, 20, 0, colorRenderer);
    const expectedTint = vanillaFoliageColor(world, 0, 20, 0);
    assert.deepEqual(colors[0], [((expectedTint >> 16) & 255) / 255, ((expectedTint >> 8) & 255) / 255,
        (expectedTint & 255) / 255]);
});

test('dry biome plants used by terrain decoration have native render mappings', async () => {
    const names = ['minecraft:dead_bush', 'minecraft:short_dry_grass', 'minecraft:tall_dry_grass'];
    const descriptors = names.map(name => manifest.blocks.find(block => block.name === name));
    assert.ok(descriptors.every(Boolean));
    assert.ok(descriptors.every(block => block.cutout && !block.solid && nativeFeatureQuads(block).length > 0));
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); } };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    for (const block of descriptors) assert.ok(mapping.has(block.stateId), `${block.name} ${block.stateId}`);
});

test('sweet berry bush states have native mappings and animated native textures advance in the atlas', async () => {
    const berry = manifest.blocks.filter(block => block.name === 'minecraft:sweet_berry_bush');
    assert.equal(berry.length, 4);
    assert.ok(berry.every(block => block.cutout && !block.solid && nativeFeatureQuads(block).length > 0));
    const atlasMock = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); } };
    const mapping = await prepareVanillaTerrainAtlas(atlasMock);
    for (const block of berry) assert.ok(mapping.has(block.stateId), `${block.name} state ${block.stateId}`);

    const water = manifest.textures['minecraft:block/water_still'];
    assert.ok(water.mcmeta && water.animation.frames.length > 1 && water.frames.length > 1);
    const draws = [];
    const realAtlas = new TextureAtlas({});
    realAtlas.canvas = { getContext: () => ({ clearRect() {}, drawImage(image) { draws.push(image); } }) };
    realAtlas.texture = { needsUpdate: false };
    const frames = water.frames.map((_, index) => ({ index }));
    realAtlas.registerAnimatedModTexture('test:water', frames, water.animation);
    realAtlas.updateAnimatedTextures(0);
    const first = draws.at(-1);
    realAtlas.updateAnimatedTextures(water.animation.frames[0].time);
    assert.notEqual(draws.at(-1), first);
    assert.equal(realAtlas.texture.needsUpdate, true);
});

test('melon patches have the vanilla cube model and a chunk render mapping', async () => {
    const descriptor = manifest.blocks.find(block => block.name === 'minecraft:melon');
    assert.ok(descriptor);
    assert.deepEqual(Object.keys(descriptor.parts[0].elements[0].faces).sort(), ['down', 'east', 'north', 'south', 'up', 'west']);
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); } };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    assert.ok(mapping.has(descriptor.stateId));
    const chunk = new VanillaChunk(0, 0);
    chunk.setBlock(0, 64, 0, descriptor.stateId);
    assert.doesNotThrow(() => VanillaRenderChunk.fromPayload({ minY: -64, maxY: 320, height: 384 }, chunk.serialize(), mapping));
});

test('native cube model faces wind outward after the shared tessellator index order is applied', async () => {
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); },
        getUVs: () => ({ minU: 0, minV: 0, maxU: 1, maxV: 1 }) };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    const descriptor = manifest.blocks.find(block => block.name === 'minecraft:melon');
    const block = Block.getById(mapping.get(descriptor.stateId) >> 4);
    const emitted = [];
    block.onRender(null, 0, 0, 0, { worldRenderer: { textureAtlas: atlas }, tessellator: {
        material: { alphaTest: 0 }, setColor() {}, addVertexWithUV: (...vertex) => emitted.push(vertex)
    } });
    const outward = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
    const quads = nativeFeatureQuads(descriptor);
    assert.equal(emitted.length, quads.length * 4);
    quads.forEach((quad, i) => {
        const a = emitted[i * 4].slice(0, 3), b = emitted[i * 4 + 2].slice(0, 3), c = emitted[i * 4 + 1].slice(0, 3);
        const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
        const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        assert.ok(normal.reduce((sum, value, axis) => sum + value * outward[quad.face][axis], 0) > 0, `${quad.face} points out`);
    });
});

test('infested stone variants used by ore generation have native render mappings', async () => {
    const names = ['minecraft:infested_stone', 'minecraft:infested_deepslate'];
    const descriptors = names.map(name => manifest.blocks.find(block => block.name === name));
    assert.ok(descriptors.every(Boolean));
    assert.ok(descriptors.every(block => block.parts.length > 0 && block.solid));
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); } };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    for (const block of descriptors) assert.ok(mapping.has(block.stateId), `${block.name} ${block.stateId}`);
});

test('bee nests placed by tree decorators have native render mappings for every state', async () => {
    const descriptors = manifest.blocks.filter(block => block.name === 'minecraft:bee_nest');
    assert.ok(descriptors.length > 0);
    assert.ok(descriptors.every(block => block.parts.length > 0));
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(key) { this.textureMap.set(key, {}); } };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    for (const block of descriptors) assert.ok(mapping.has(block.stateId), `${block.name} ${block.stateId}`);
});

test('feature states reach real render chunks and emit textured vertices without cube fallback', async () => {
    const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
        loadImage: async () => ({ width: 16, height: 16 }), registerModTexture(k) { this.textureMap.set(k, {}); },
        getUVs: () => ({ minU: 0, maxU: 1, minV: 0, maxV: 1 }) };
    const mapping = await prepareVanillaTerrainAtlas(atlas);
    const chunk = new VanillaChunk(0, 0);
    const descriptors = ['iron_ore','melon','magma_block','smooth_basalt','snow','amethyst_block','budding_amethyst','small_amethyst_bud','medium_amethyst_bud','large_amethyst_bud','amethyst_cluster','leaf_litter','brown_mushroom','red_mushroom','dripstone_block','pointed_dripstone','wildflowers','bush','dandelion','poppy','blue_orchid','allium','azure_bluet','red_tulip','orange_tulip','white_tulip','pink_tulip','oxeye_daisy','cornflower','lily_of_the_valley','wither_rose','sunflower','lilac','rose_bush','peony','torchflower','open_eyeblossom','closed_eyeblossom','pink_petals','seagrass','tall_seagrass','glow_lichen'].map(name => manifest.blocks.find(b => b.name === `minecraft:${name}` && (!name.includes('snow') || b.properties.layers === '1') && (name !== 'leaf_litter' || b.properties.facing === 'west' && b.properties.segment_amount === '1') && (name !== 'wildflowers' || b.properties.facing === 'south' && b.properties.flower_amount === '2')));
    descriptors.forEach((b, i) => chunk.setBlock(i % 16, 64, Math.floor(i / 16), b.stateId));
    const rendered = VanillaRenderChunk.fromPayload({ minY: -64, maxY: 320, height: 384 }, chunk.serialize(), mapping);
    const vertices = [];
    const renderer = { worldRenderer: { textureAtlas: atlas }, tessellator: { material: { alphaTest: 0 }, setColor() {}, addVertexWithUV: (...v) => vertices.push(v) } };
    descriptors.forEach((b, i) => {
        const x = i % 16, z = Math.floor(i / 16);
        const block = Block.getById(rendered.getBlockAt(x, 64, z));
        assert.equal(block.onRender(null, x, 64, z, renderer), true, b.name);
    });
    assert.ok(vertices.length > 0);
    assert.ok(vertices.flat().every(Number.isFinite));
    assert.equal(renderer.tessellator.material.alphaTest, 0.1);
});
