import * as THREE from '../../../../../../libraries/three.module.js';
import Block from '../world/block/Block.js';
import EnumBlockFace from '../../util/EnumBlockFace.js';
import { StreamingLRU } from '../world/provider/VanillaStreaming.js';
import { vanillaBlockFoliageColor, vanillaGrassColor } from './VanillaTerrainRenderer.js';

export function cachedViewDistance(settings) {
    return Math.max(settings.viewDistance ?? 4, Math.min(32, settings.vanillithCachedViewDistance ?? 8));
}

// Visual summaries of already completed chunks, never a second generator or a
// collision source. Small surface cells deliberately approximate distant detail.
export function* buildDistantSurface(native, sampleSurface, texture, cellSize = 4) {
    const width = 16 / cellSize;
    const cells = [], positions = [], uvs = [], colors = [], indices = [];
    for (let z = 0; z < width; z++) {
        for (let x = 0; x < width; x++) {
            let height = native.minY, sx = x * cellSize, sz = z * cellSize;
            for (let dz = 0; dz < cellSize; dz++) for (let dx = 0; dx < cellSize; dx++) {
                const h = native.heightmap[(z * cellSize + dz) * 16 + x * cellSize + dx];
                if (h > height) { height = h; sx = x * cellSize + dx; sz = z * cellSize + dz; }
            }
            cells.push(height > native.minY ? sampleSurface(sx, height - 1, sz) : null);
        }
        yield;
    }
    const quad = (vertices, sample, shade = 1) => {
        const offset = positions.length / 3, uv = sample.uv;
        positions.push(...vertices.flat());
        uvs.push(uv.minU, 1 - uv.maxV, uv.minU, 1 - uv.minV, uv.maxU, 1 - uv.minV, uv.maxU, 1 - uv.maxV);
        const color = new THREE.Color(sample.color ?? 0xffffff);
        for (let i = 0; i < 4; i++) colors.push(color.r * shade, color.g * shade, color.b * shade);
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    };
    for (let z = 0; z < width; z++) {
        for (let x = 0; x < width; x++) {
            const cell = cells[z * width + x];
            if (!cell) continue;
            const a = x * cellSize, b = z * cellSize, y = cell.height, step = cellSize;
            quad([[a,y,b], [a,y,b+step], [a+step,y,b+step], [a+step,y,b]], cell);
            // Vertical steps and short boundary skirts hide coarse cell cracks.
            const west = cells[z * width + x - 1], east = cells[z * width + x + 1];
            const north = cells[(z - 1) * width + x], south = cells[(z + 1) * width + x];
            const lower = neighbor => neighbor ? neighbor.height : Math.max(native.minY, y - 8);
            let h = x > 0 ? lower(west) : Math.max(native.minY, y - 8);
            if (h < y) quad([[a,h,b], [a,h,b+step], [a,y,b+step], [a,y,b]], cell, .6);
            h = x < width - 1 ? lower(east) : Math.max(native.minY, y - 8);
            if (h < y) quad([[a+step,h,b+step], [a+step,h,b], [a+step,y,b], [a+step,y,b+step]], cell, .6);
            h = z > 0 ? lower(north) : Math.max(native.minY, y - 8);
            if (h < y) quad([[a+step,h,b], [a,h,b], [a,y,b], [a+step,y,b]], cell, .8);
            h = z < width - 1 ? lower(south) : Math.max(native.minY, y - 8);
            if (h < y) quad([[a,h,b+step], [a+step,h,b+step], [a+step,y,b+step], [a,y,b+step]], cell, .8);
        }
        yield;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, side: THREE.FrontSide, alphaTest: .1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(native.chunkX * 16, 0, native.chunkZ * 16);
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false; mesh.visible = false;
    let bytes = geometry.index.array.byteLength;
    for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
    return { mesh, bytes, x: native.chunkX, z: native.chunkZ };
}

export default class VanillaDistantTerrain {
    constructor(provider) {
        this.provider = provider;
        this.jobs = new Map();
        this.cache = new StreamingLRU(0, entry => {
            provider.world.group.remove(entry.mesh);
            entry.mesh.geometry.dispose(); entry.mesh.material.dispose();
        });
        this.setMemoryPreset(provider.world.minecraft.settings.vanillithMemoryPreset);
    }

    setMemoryPreset(preset, bytes) {
        this.cache.budget = bytes ?? ({ low: 16, balanced: 32, high: 64, extreme: 64 }[preset] ?? 32) * 1024 ** 2;
        this.cache.trim();
    }

    enqueue(native) {
        if (!this.provider.world.minecraft.settings.vanillithLod) return;
        const key = `${native.chunkX},${native.chunkZ}`;
        if (this.cache.entries.has(key) || this.jobs.has(key)) return;
        if (this.jobs.size >= 32) {
            const [oldKey, job] = this.jobs.entries().next().value;
            job.steps?.return(); this.jobs.delete(oldKey);
        }
        this.jobs.set(key, { native });
    }

    sample(native, x, y, z, tintWorld = this.provider.world) {
        const provider = this.provider, world = tintWorld;
        for (; y >= native.minY; y--) {
            const packed = provider.nativeRenderStateMap.get(native.getBlock(x, y, z));
            if (!packed) continue;
            const block = Block.getById(packed >> 4);
            if (!block) continue;
            const wx = native.chunkX * 16 + x, wz = native.chunkZ * 16 + z;
            const texture = block.getTextureForFace(EnumBlockFace.TOP, packed & 15, wx, y, wz, world);
            if (!texture || texture === 'missing') continue;
            const atlas = world.minecraft.worldRenderer.textureAtlas;
            const uv = atlas.getUVs(texture);
            if (!uv) continue;
            const descriptor = block.descriptor;
            const color = descriptor?.constantTint ?? (descriptor?.foliage ? vanillaBlockFoliageColor(world, descriptor.name, wx, y, wz)
                : descriptor?.name === 'minecraft:grass_block' ? vanillaGrassColor(world, wx, y, wz)
                    : block.getColor(world, wx, y, wz, EnumBlockFace.TOP));
            return { height: y + 1, uv, color };
        }
        return null;
    }

    process(deadline) {
        if (!this.provider.world.minecraft.settings.vanillithLod) {
            for (const job of this.jobs.values()) job.steps?.return();
            this.jobs.clear(); return;
        }
        while (this.jobs.size && performance.now() < deadline) {
            const [key, job] = this.jobs.entries().next().value;
            const start = performance.now();
            if (!job.tintWorld) {
                job.tintWorld = Object.create(this.provider.world);
                job.tintWorld.getChunkAt = (x, z) => ({ native: x === job.native.chunkX && z === job.native.chunkZ ? job.native
                    : this.provider.world.nativeChunks?.getChunk(x, z) ?? this.provider.source.store.getChunk(x, z)
                        ?? this.provider.source.terrainCache?.entries.get(`${x},${z}`)?.value });
            }
            job.steps ??= buildDistantSurface(job.native, (x,y,z) => this.sample(job.native, x,y,z, job.tintWorld),
                this.provider.world.minecraft.worldRenderer.textureAtlas.getTexture(), 2);
            const result = job.steps.next();
            this.provider.streamingMetrics.record('lodSliceMs', performance.now() - start);
            if (result.done) {
                this.jobs.delete(key); this.cache.put(key, result.value, result.value.bytes);
                if (this.cache.entries.has(key)) this.provider.world.group.add(result.value.mesh);
                this.provider.streamingMetrics.count('lodBuilt');
            }
        }
    }

    updateVisibility(x, z) {
        const { world, chunks, warmRender } = this.provider, settings = world.minecraft.settings;
        const distance = Math.max(cachedViewDistance(settings), Math.min(64, settings.vanillithLodDistance ?? 16));
        for (const [key, { value: entry }] of this.cache.entries) {
            const ring = Math.max(Math.abs(entry.x - x), Math.abs(entry.z - z));
            const warm = warmRender.entries.get(key)?.value;
            const fullVisible = warm?.group.visible && warm.sections.some(section => section.group.visible && section.group.children.length);
            entry.mesh.visible = !!settings.vanillithLod && ring > 1 && ring < distance && !chunks.has(key) && !fullVisible;
            entry.mesh.material.color.setScalar(Math.max(.1, 1 - (world.skylightSubtracted ?? 0) / 15));
        }
    }

    clear() { for (const job of this.jobs.values()) job.steps?.return(); this.jobs.clear(); this.cache.clear(); }
}
