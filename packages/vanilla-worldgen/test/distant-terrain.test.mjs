import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../../libraries/three.module.js';
import { VanillaChunk } from '../chunk.mjs';
import VanillaDistantTerrain, { buildDistantSurface, cachedViewDistance } from '../../../src/js/net/minecraft/client/render/VanillaDistantTerrain.js';
import WorldRenderer from '../../../src/js/net/minecraft/client/render/WorldRenderer.js';
import { StreamingLRU, StreamingMetrics } from '../../../src/js/net/minecraft/client/world/provider/VanillaStreaming.js';
import VanillaPreviewChunkProvider from '../../../src/js/net/minecraft/client/world/provider/VanillaPreviewChunkProvider.js';

function surface() {
    const native = new VanillaChunk(-2, 3); native.heightmap.fill(65);
    const steps = buildDistantSurface(native, () => ({ height: 65, color: 0x66aa44, uv: { minU: .1, maxU: .2, minV: .3, maxV: .4 } }), null);
    let result, slices = 0;
    do { result = steps.next(); slices++; } while (!result.done);
    assert.equal(slices, 9);
    return { native, entry: result.value };
}

test('coarse surface preserves source arrays, coordinates, atlas UVs and outward winding', () => {
    const { native, entry } = surface();
    assert.ok(native.blocks.every(v => v === 0)); assert.ok(native.heightmap.every(v => v === 65));
    assert.deepEqual(entry.mesh.position.toArray(), [-32, 0, 48]);
    const geometry = entry.mesh.geometry, vertices = geometry.attributes.position.array, indices = geometry.index.array;
    assert.equal(indices.length / 3, 64); // 16 tops plus 16 boundary skirts, two triangles each
    assert.deepEqual(Array.from(geometry.attributes.uv.array.slice(0,8)).map(v => Number(v.toFixed(2))),
        [.1,.6,.1,.7,.2,.7,.2,.6]);
    for (let i = 0; i < indices.length; i += 3) {
        const a = new THREE.Vector3().fromArray(vertices, indices[i] * 3);
        const b = new THREE.Vector3().fromArray(vertices, indices[i+1] * 3);
        const c = new THREE.Vector3().fromArray(vertices, indices[i+2] * 3);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        assert.ok(normal.length() > 0);
        const center = a.clone().add(b).add(c).multiplyScalar(1/3);
        if (normal.y) assert.ok(normal.y > 0);
        else if (center.x === 0) assert.ok(normal.x < 0);
        else if (center.x === 16) assert.ok(normal.x > 0);
        else if (center.z === 0) assert.ok(normal.z < 0);
        else if (center.z === 16) assert.ok(normal.z > 0);
    }
    entry.mesh.geometry.dispose(); entry.mesh.material.dispose();
});

test('LOD visibility excludes near field and full chunks; GPU resources are disposed on eviction/exit', () => {
    const { entry } = surface(), settings = { viewDistance: 4, vanillithLod: true, vanillithLodDistance: 16 };
    const provider = { chunks: new Map(), warmRender: new StreamingLRU(100), world: { group: new THREE.Group(), minecraft: { settings } } };
    const manager = new VanillaDistantTerrain(provider);
    let disposed = 0;
    entry.mesh.geometry.addEventListener('dispose', () => disposed++);
    entry.mesh.material.addEventListener('dispose', () => disposed++);
    provider.world.group.add(entry.mesh); manager.cache.put('-2,3', entry, entry.bytes);
    manager.updateVisibility(0,0); assert.equal(entry.mesh.visible, true);
    manager.updateVisibility(-2,3); assert.equal(entry.mesh.visible, false);
    provider.chunks.set('-2,3', {}); manager.updateVisibility(0,0); assert.equal(entry.mesh.visible, false);
    provider.chunks.clear();
    provider.warmRender.put('-2,3', { group: { visible: true }, sections: [{ group: { visible: true, children: [{}] } }] }, 1);
    manager.updateVisibility(0,0); assert.equal(entry.mesh.visible, false);
    provider.warmRender.clear(); settings.vanillithLod = false;
    manager.updateVisibility(0,0); assert.equal(entry.mesh.visible, false);
    manager.cache.budget = 0; manager.cache.trim();
    assert.equal(disposed, 2); assert.equal(provider.world.group.children.length, 0);
    manager.clear(); assert.equal(disposed, 2);
});

test('retained full meshes render farther without entering gameplay storage or the mesh rebuild queue', () => {
    const group = new THREE.Group(), section = { group: new THREE.Group(), boundingBox: new THREE.Box3(), isEmpty: () => false, isModified: true, render() {} };
    const warm = { x: 5, z: 0, group: new THREE.Group(), sections: [section], loaded: false };
    const provider = Object.create(VanillaPreviewChunkProvider.prototype);
    Object.assign(provider, { chunks: new Map(), warmRender: new StreamingLRU(100), world: { group }, distantTerrain: { updateVisibility() {} } });
    provider.warmRender.put('5,0', warm, 1);
    provider.world.getChunkProvider = () => provider;
    const renderer = Object.create(WorldRenderer.prototype);
    Object.assign(renderer, { minecraft: { world: provider.world, player: { y: 64 }, settings: { viewDistance: 4, vanillithCachedViewDistance: 8 } }, frustum: { intersectsBox: () => true }, chunkSectionUpdateQueue: [] });
    renderer.renderChunks(0,0);
    assert.equal(warm.group.visible, true); assert.equal(warm.group.parent, group);
    assert.equal(warm.loaded, false); assert.equal(provider.chunks.size, 0);
    assert.equal(renderer.chunkSectionUpdateQueue.length, 0);
    renderer.minecraft.settings.vanillithCachedViewDistance = 4; renderer.renderChunks(0,0);
    assert.equal(warm.group.visible, false);
    assert.equal(cachedViewDistance({ viewDistance: 16, vanillithCachedViewDistance: 4 }), 16);
});

test('LOD work queue is bounded and never invokes terrain generation', () => {
    const provider = { streamingMetrics: new StreamingMetrics(), world: { group: new THREE.Group(), minecraft: { settings: { vanillithLod: true } } } };
    const manager = new VanillaDistantTerrain(provider);
    for (let x = 0; x < 100; x++) manager.enqueue({ chunkX: x, chunkZ: 0 });
    assert.equal(manager.jobs.size, 32);
    manager.enqueue({ chunkX: 99, chunkZ: 0 }); assert.equal(manager.jobs.size, 32);
    manager.clear(); assert.equal(manager.jobs.size, 0);
});

test('two-block detail retains narrow heightmap features without changing source data', () => {
    const native = new VanillaChunk(0,0); native.heightmap.fill(65); native.heightmap[1] = 72;
    const sample = (x,y,z) => ({ height: y+1, color: 0xffffff, uv: { minU:0,maxU:1,minV:0,maxV:1 } });
    const steps = buildDistantSurface(native, sample, null, 2);
    let result; do { result = steps.next(); } while (!result.done);
    assert.ok(result.value.mesh.geometry.attributes.position.array.includes(72));
    assert.ok(result.value.mesh.geometry.index.count / 3 > 64);
    assert.equal(native.heightmap[1],72);
    result.value.mesh.geometry.dispose(); result.value.mesh.material.dispose();
});
