import Chunk from './Chunk.js';
import Block from './block/Block.js';
import { readVanillaChunk } from '../../../../../../packages/vanilla-worldgen/chunk-store.mjs';
import registry from '../../../../../../packages/vanilla-worldgen/generated/block-states.json' with { type: 'json' };
const airStates = new Set(registry.states.filter(s => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(s.name)).map(s => s.id));

export default class VanillaRenderChunk extends Chunk {
    static fromPayload(world, payload, stateMap) {
        const steps = this.fromPayloadSteps(world, payload, stateMap);
        let step;
        do { step = steps.next(); } while (!step.done);
        return step.value;
    }

    static *fromPayloadSteps(world, payload, stateMap) {
        const native = readVanillaChunk(payload);
        if (world.minY !== native.minY || world.maxY !== native.minY + native.height) throw new Error('Modern chunk range does not match render world');
        if (!(stateMap instanceof Map)) throw new TypeError('An exact modern-to-render block state map is required');
        const unsupported = [];
        const usedStates = new Set(native.blocks);
        let maxStateId = 0;
        for (const stateId of usedStates) {
            const packed = stateMap.get(stateId);
            if (!Number.isInteger(packed) || packed < 0 || packed > 65535 || !airStates.has(stateId) && (packed >> 4) === 0 || (packed >> 4) !== 0 && Block.getById(packed >> 4) === null) {
                const state = registry.states[stateId];
                unsupported.push(state ? `${stateId} (${state.name})` : String(stateId));
            }
            if (stateId > maxStateId) maxStateId = stateId;
        }
        if (unsupported.length) throw new Error(`Unsupported render mappings for vanilla states: ${unsupported.join(', ')}`);
        const packedByStateId = new Uint16Array(maxStateId + 1);
        for (const stateId of usedStates) packedByStateId[stateId] = stateMap.get(stateId);
        const chunk = new VanillaRenderChunk(world, native.chunkX, native.chunkZ);
        yield;
        for (let index = 0; index < native.blocks.length; index++) {
            const dy = Math.floor(index / 256);
            const section = chunk.sections[Math.floor(dy / 16)];
            const local = ((dy & 15) << 8) | (index & 255);
            const packed = packedByStateId[native.blocks[index]];
            section.blocks[local] = packed >> 4;
            section.blocksData[local] = packed & 15;
            if (packed >> 4) section.empty = false;
            if ((index & 4095) === 4095) yield;
        }
        chunk.native = native;
        chunk.heightMap = Array.from(native.heightmap);
        chunk.loaded = true;
        chunk.isTerrainPopulated = false;
        chunk.setModifiedAllSections();
        return chunk;
    }

    getBlockState(x, y, z) {
        if (y < this.minY || y >= this.maxY) return undefined;
        return this.native.getBlock(x, y, z);
    }

    setBlockAt(x, y, z, typeId, data = 0, nativeStateId = null) {
        if (y < this.minY || y >= this.maxY) return false;
        const stateId = nativeStateId ?? this.world.nativeStateFromRender?.(typeId, data);
        if (stateId === undefined) throw new Error(`No native block state mapped for render block ${typeId}:${data}`);
        const changed = this.native.getBlock(x, y, z) !== stateId;
        if (changed) {
            this.native.setBlock(x, y, z, stateId);
            const key = `${this.x},${this.z}`;
            this.world.vanillithDirtyChunks?.set(key, this.native.serialize());
        }
        return super.setBlockAt(x, y, z, typeId, data);
    }
    fillChunk() { throw new Error('Legacy packets cannot overwrite modern render chunks'); }
    serialize() { return this.native.serialize(); }
}
