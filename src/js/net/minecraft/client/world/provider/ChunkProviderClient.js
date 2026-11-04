import ChunkProvider from "./ChunkProvider.js";
import Chunk from "../Chunk.js";
import VanillaRenderChunk from '../VanillaRenderChunk.js';
import { VanillaChunkStore } from '../../../../../../../packages/vanilla-worldgen/chunk-store.mjs';
import { validateChunkOffer } from '../../../../../../../packages/vanilla-worldgen/chunk-session.mjs';
import { clearVanillaBiomeTintCache } from '../../../../../../../packages/vanilla-worldgen/biome-tint.mjs';
import registry from '../../../../../../../packages/vanilla-worldgen/generated/block-states.json' with { type: 'json' };
import stateRules from '../../../../../../../packages/vanilla-worldgen/generated/block-rules.json' with { type: 'json' };
import Block from '../block/Block.js';
import { BlockRegistry } from '../block/BlockRegistry.js';

export default class ChunkProviderClient extends ChunkProvider {

    constructor(world) {
        super(world);

        this.emptyChunk = new Chunk(world, 0, 0);
        this.emptyChunk.generateSkylightMap();
        this.emptyChunk.generateBlockLightMap();
    }

    getChunkAt(x, z) {
        let index = this.chunkKey(x, z);
        let chunk = this.chunks.get(index);
        return typeof chunk === 'undefined' ? this.emptyChunk : chunk;
    }

    loadChunk(x, z) {
        if (this.world.vanillaChunkProtocol === 1) throw new Error('Modern worlds require native chunk packets');
        let index = x + (z << 16);

        // Fully remove any existing chunk at these coordinates
        let existing = this.chunks.get(index);
        if (typeof existing !== 'undefined') {
            this.world.group.remove(existing.group);
            for (const section of existing.sections) {
                if (section.group) {
                    while (section.group.children.length > 0) {
                        const child = section.group.children[0];
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => mat.dispose());
                            } else {
                                child.material.dispose();
                            }
                        }
                        section.group.remove(child);
                    }
                }
            }
            this.chunks.delete(index);
        }

        let chunk = new Chunk(this.world, x, z);
        chunk.generateSkylightMap();
        chunk.generateBlockLightMap();
        chunk.loaded = true;
        this.chunks.set(index, chunk);
        this.world.group.add(chunk.group);

        return chunk;
    }

    chunkKey(x, z) { return this.world.vanillaChunkProtocol === 1 ? `${x},${z}` : x + (z << 16); }

    chunkExists(x, z) { return this.chunks.has(this.chunkKey(x, z)); }

    enableVanillaMode(offer, stateMap) {
        offer = validateChunkOffer(offer);
        if (this.chunks.size || this.world.vanillaChunkProtocol === 1) throw new Error('Modern mode must be configured before receiving chunks');
        if (!(stateMap instanceof Map) || stateMap.get(0) !== 0) throw new Error('Invalid native render state map');
        const emptyChunk = new Chunk({ ...this.world, minY: offer.minY, maxY: offer.minY + offer.height }, 0, 0);
        emptyChunk.world = this.world;
        for (const section of emptyChunk.sections) section.world = this.world;
        this.world.minY = offer.minY;
        this.world.maxY = offer.minY + offer.height;
        this.world.height = offer.height;
        this.world.vanillaChunkProtocol = 1;
        this.world.vanillaChunkSettings = offer;
        this.world.nativeChunks = new VanillaChunkStore();
        this.world.vanillaLightEngine = null;
        const targetWorld = this.world;
        this.world.vanillaLightEngineReady = import('../MinecraftLightEngine.js').then(({ default: MinecraftLightEngine }) => {
            if (targetWorld.vanillaChunkProtocol !== 1) return null;
            targetWorld.vanillaLightEngine = new MinecraftLightEngine(targetWorld);
            return targetWorld.vanillaLightEngine;
        });
        this.nativeRenderStateMap = new Map(stateMap);
        const renderToNativeState = new Map();
        for (const [stateId, packed] of stateMap) {
            if (!renderToNativeState.has(packed)) renderToNativeState.set(packed, stateId);
        }
        // Powered doors, trapdoors and gates share render IDs with the same
        // unpowered model. Ordinary placement must decode to unpowered; the
        // exact powered state is supplied explicitly by the world simulation.
        const statesById = new Map(registry.states.map(state => [state.id, state]));
        for (const state of registry.states) {
            if (state.properties?.powered !== 'false' || !(state.name.endsWith('_door') || state.name.endsWith('_trapdoor') || state.name.endsWith('_fence_gate'))) continue;
            const packed = stateMap.get(state.id);
            const existing = statesById.get(renderToNativeState.get(packed));
            if (existing?.name === state.name && existing.properties?.powered === 'true') renderToNativeState.set(packed, state.id);
        }
        for (const [name, stateId] of Object.entries(stateRules.defaults ?? {})) {
            const packed = stateMap.get(stateId);
            if (packed !== undefined) renderToNativeState.set(packed, stateId);
            // Saved inventories may still contain the original BreakMine block
            // ID even after the same block gains a native-rendered model.
            const legacy = BlockRegistry.get(name);
            if (legacy && !legacy.isItem() && legacy.id > 0 && legacy.id <= 4095) {
                renderToNativeState.set(legacy.id << 4, stateId);
            }
        }
        this.world.nativeStateFromRender = (typeId, data = 0) =>
            renderToNativeState.get((typeId << 4) | (data & 15)) ?? renderToNativeState.get(typeId << 4);
        this.world.nativeFluidBlocks = new Map();
        for (const state of registry.states) if (state.name === 'minecraft:water' || state.name === 'minecraft:lava') {
            this.world.nativeFluidBlocks.set(state.name.slice('minecraft:'.length), Block.getById(stateMap.get(state.id) >> 4));
        }
        this.emptyChunk = emptyChunk;
        return this.world.vanillaLightEngineReady;
    }

    loadVanillaChunk(payload) {
        if (this.world.vanillaChunkProtocol !== 1) throw new Error('Modern protocol has not been negotiated');
        // Validate/build before removing the previous visible chunk.
        const chunk = VanillaRenderChunk.fromPayload(this.world, payload, this.nativeRenderStateMap);
        return this.installVanillaChunk(chunk);
    }

    installVanillaChunk(chunk, lightPrepared = false) {
        chunk.loaded = true;
        const key = this.chunkKey(chunk.x, chunk.z);
        const previous = this.chunks.get(key);
        if (previous) this.disposeRenderChunk(previous);
        this.chunks.set(key, chunk);
        this.world.nativeChunks.chunks.set(key, chunk.native);
        clearVanillaBiomeTintCache(this.world);
        this.world.group.add(chunk.group);
        if (lightPrepared) this.world.enqueueChunkLight(chunk);
        else this.world.updateChunkLight(chunk);
        const tintMargin = Math.max(1, (this.world.minecraft?.settings?.biomeBlendRadius ?? 2) + 6);
        this.world.setModified(chunk.x * 16 - tintMargin, chunk.minY, chunk.z * 16 - tintMargin,
            chunk.x * 16 + 15 + tintMargin, chunk.maxY - 1, chunk.z * 16 + 15 + tintMargin);
        return chunk;
    }

    disposeRenderChunk(chunk) {
        const queue = this.world.minecraft?.worldRenderer?.chunkSectionUpdateQueue;
        if (queue) {
            for (let i = queue.length - 1; i >= 0; i--) if (queue[i].chunk === chunk) queue.splice(i, 1);
        }
        chunk.unload();
        this.world.group.remove(chunk.group);
        for (const section of chunk.sections) {
            section.group.traverse(object => {
                object.geometry?.dispose();
                if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
            });
            section.group.clear();
        }
    }

    unloadChunk(x, z) {
        if (this.world.vanillaChunkProtocol !== 1) return super.unloadChunk(x, z);
        const key = this.chunkKey(x, z);
        const chunk = this.chunks.get(key);
        if (chunk) this.disposeRenderChunk(chunk);
        this.chunks.delete(key);
        this.world.nativeChunks.chunks.delete(key);
        this.world.vanillaLightEngine?.removeChunk(x, z);
        clearVanillaBiomeTintCache(this.world);
        if (chunk) {
            const tintMargin = Math.max(1, (this.world.minecraft?.settings?.biomeBlendRadius ?? 2) + 6);
            this.world.setModified(x * 16 - tintMargin, chunk.minY, z * 16 - tintMargin,
                x * 16 + 15 + tintMargin, chunk.maxY - 1, z * 16 + 15 + tintMargin);
        }
    }

    clearChunks() {
        if (this.world.vanillaChunkProtocol !== 1) return super.clearChunks();
        for (const chunk of this.chunks.values()) this.disposeRenderChunk(chunk);
        this.chunks.clear();
        this.world.nativeChunks.clear();
        this.world.vanillaLightEngine?.clear?.();
    }

}
