import test from 'node:test';
import assert from 'node:assert/strict';
import terrain from '../generated/terrain-render.json' with { type: 'json' };
import decoration from '../generated/decoration-render.json' with { type: 'json' };
import features from '../generated/feature-render.json' with { type: 'json' };
import registry from '../generated/block-states.json' with { type: 'json' };
import { prepareVanillaTerrainAtlas } from '../../../src/js/net/minecraft/client/render/VanillaTerrainRenderer.js';
import { nativeFeatureQuads } from '../../../src/js/net/minecraft/client/render/VanillaFeatureGeometry.js';
import BlockRenderer from '../../../src/js/net/minecraft/client/render/BlockRenderer.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import EnumBlockFace from '../../../src/js/net/minecraft/util/EnumBlockFace.js';
import TranslucentMeshBatcher from '../../../src/js/net/minecraft/client/render/TranslucentMeshBatcher.js';
import * as THREE from '../../../libraries/three.module.js';

const directions = { down: [0,-1,0], up: [0,1,0], north: [0,0,-1], south: [0,0,1], west: [-1,0,0], east: [1,0,0] };
const atlas = { loaded: true, canvas: {}, textureMap: new Map(), _nextModIndex: 0, texturesPerRow: 64,
    isLoaded: () => true, getTexture: () => null, loadImage: async () => ({ width: 16, height: 16 }),
    registerModTexture(key) { this.textureMap.set(key, {}); this._nextModIndex++; },
    getUVs: () => ({ minU: 0, minV: 0, maxU: 1, maxV: 1 }) };
const mapping = await prepareVanillaTerrainAtlas(atlas);
const renderer = new BlockRenderer({ textureAtlas: atlas });
function dotNormal(geometry, faceIndex, expected) {
    const ids = geometry.index.array.slice(faceIndex * 6, faceIndex * 6 + 3), positions = geometry.attributes.position;
    const [a,b,c] = [...ids].map(i => [positions.getX(i),positions.getY(i),positions.getZ(i)]);
    const u = b.map((v,i)=>v-a[i]), v = c.map((v,i)=>v-a[i]);
    const n = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    return n.reduce((sum,v,i)=>sum+v*expected[i],0);
}
test('all native terrain/feature triangles retain their model winding through the real tessellator', () => {
    for (const requested of [...terrain.blocks,...decoration.blocks,...features.blocks]) {
        const block = Block.getById(mapping.get(requested.stateId) >> 4);
        const descriptor = block.descriptor;
        const quads = descriptor.parts ? nativeFeatureQuads(descriptor) : descriptor.elements
            ? descriptor.elements.flatMap(element => Object.keys(element.faces).map(face => ({ normal: directions[face] })))
            : ['up','down','north','east','south','west'].map(face => ({ normal: directions[face] }));
        renderer.tessellator.startDrawing();
        renderer.renderBlock(null, block, false, 0, 0, 0);
        const group = new THREE.Group(), mesh = renderer.tessellator.draw(group, true);
        assert.equal(mesh.geometry.index.count, quads.length * 6, `${descriptor.name} ${descriptor.stateId}`);
        quads.forEach((quad,i) => assert.ok(dotNormal(mesh.geometry,i,quad.normal) > 0,
            `${descriptor.name} ${descriptor.stateId} quad ${i} must retain its native facing`));
        mesh.geometry.dispose(); mesh.material.dispose();
    }
});
test('bamboo age/leaves/stage variants, partial snow and all feature resource block names have mappings', () => {
    for (const id of [18642,18644,18646,18647]) assert.ok(mapping.has(id));
    for (const state of registry.states.filter(state => ['minecraft:bamboo','minecraft:bamboo_sapling','minecraft:snow'].includes(state.name))) {
        assert.ok(mapping.has(state.id));
        const block = Block.getById(mapping.get(state.id) >> 4);
        if (state.name === 'minecraft:snow') assert.equal(block.getBoundingBox().maxY, Number(state.properties.layers) / 8);
    }
    for (const name of features.requiredNames) {
        if (name === 'minecraft:air') continue;
        assert.ok(registry.states.some(state => state.name === name && mapping.has(state.id)), name);
    }
});
test('feature lighting samples exterior faces, not the unlit solid interior; buried faces are culled', () => {
    const descriptor = features.blocks.find(block => block.name === 'minecraft:melon');
    const block = Block.getById(mapping.get(descriptor.stateId) >> 4);
    const world = { getBlockAt: (x,y,z) => !x&&!y&&!z ? block.id : 0, getBlockAtFace: () => 0,
        getTotalLightAt: (x,y,z) => !x&&!y&&!z ? 0 : 15 };
    renderer.tessellator.startDrawing(); renderer.renderBlock(world,block,false,0,0,0);
    assert.equal(renderer.tessellator.addedVertices,24);
    assert.ok(renderer.tessellator.colors.filter((_,i)=>i%4!==3).every(v=>v>=0.5));
    world.getBlockAtFace = () => block.id;
    renderer.tessellator.startDrawing(); renderer.renderBlock(world,block,false,0,0,0);
    assert.equal(renderer.tessellator.addedVertices,0);
});
test('crossed grass uses JAR shade-direction override and one vanilla-cardinal light sample per face', () => {
    const descriptor = features.blocks.find(block => block.name === 'minecraft:short_grass');
    const block = Block.getById(mapping.get(descriptor.stateId) >> 4);
    const samples = [], colors = [];
    const world = {};
    const renderer = { worldRenderer: { textureAtlas: atlas },
        getEffectiveLightLevel: (_world, x, y, z, face) => { samples.push([x, y, z, face]); return 15; },
        tessellator: { material: { alphaTest: 0 }, setColor: (...rgb) => colors.push(rgb), addVertexWithUV() {} } };

    block.onRender(world, 4, 64, 7, renderer);

    const quads = nativeFeatureQuads(descriptor);
    assert.equal(samples.length, quads.length);
    assert.ok(quads.every(quad => quad.shadeDirectionOverride === 'up'));
    const seagrass = features.blocks.find(block => block.name === 'minecraft:seagrass');
    assert.ok(nativeFeatureQuads(seagrass).every(quad => quad.shadeDirectionOverride === 'up'));
    const order = [[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]];
    const expectedSamples = quads.map(quad => {
        let best = 0, result = order[1];
        for (const face of order) {
            const dot = face.reduce((sum, value, axis) => sum + value * quad.normal[axis], 0);
            if (dot > best) { best = dot; result = face; }
        }
        return [4 + result[0], 64 + result[1], 7 + result[2], result];
    });
    assert.deepEqual(samples.map(([x,y,z]) => [x,y,z]), expectedSamples.map(([x,y,z]) => [x,y,z]));
    assert.deepEqual(samples.map(([, , , face]) => [face.x, face.y, face.z]), expectedSamples.map(([, , , face]) => face));
    const grassTint = [124 / 255, 189 / 255, 107 / 255];
    assert.ok(colors.every(color => color.every((value, i) => Math.abs(value - grassTint[i]) < 1e-6)),
        'shade_direction_override=up must use full upward directional brightness');
});
test('visible faces beside opaque partial blocks sample exterior light, not the neighbor interior', () => {
    const descriptor = terrain.blocks.find(block => block.name === 'minecraft:stone');
    const block = Block.getById(mapping.get(descriptor.stateId) >> 4);
    const world = {
        getBlockAt: (x, y, z) => x === 1 && y === 0 && z === 0 ? block.id : 0,
        getTotalLightAt: (x, y, z) => x === 1 && y === 0 && z === 0 ? 0 : 15
    };

    assert.equal(renderer.getEffectiveLightLevel(world, 1, 0, 0), 0,
        'without a face direction, an opaque cell must remain unlit');
    assert.equal(renderer.getEffectiveLightLevel(world, 1, 0, 0, EnumBlockFace.EAST), 15,
        'a visible east-facing surface must use the open cells around the opaque neighbor');

    world.getBlockAt = (x, y, z) => x === 1 && y === 0 && z === 0 || y === 1 || y === -1 || z === 1 || z === -1 ? block.id : 0;
    assert.equal(renderer.getEffectiveLightLevel(world, 1, 0, 0, EnumBlockFace.EAST), 0,
        'fully enclosed opaque neighbors must not gain leaked light');
});
test('translucent batching/sorting retains native face winding and never flips triangles', () => {
    const descriptor = features.blocks.find(block => block.name === 'minecraft:bamboo');
    const block = Block.getById(mapping.get(descriptor.stateId) >> 4);
    renderer.tessellator.startDrawing(); renderer.renderBlock(null,block,false,0,0,0);
    const mesh = renderer.tessellator.draw(new THREE.Group(),true);
    const batch = new TranslucentMeshBatcher(new THREE.Scene(),new THREE.MeshBasicMaterial({side:THREE.FrontSide}));
    batch.addMesh(mesh); batch.finalize({x:4,y:3,z:2});
    const original = new Set(Array.from({length:mesh.geometry.index.count/3},(_,i)=>[...mesh.geometry.index.array.slice(i*3,i*3+3)].join(',')));
    for(let i=0;i<batch.currentIndex;i+=3) assert.ok(original.has([...batch.indices.slice(i,i+3)].join(',')));
    batch.mesh.geometry.dispose(); batch.mesh.material.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});
