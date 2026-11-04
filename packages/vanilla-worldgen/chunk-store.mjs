import { VanillaChunk } from './chunk.mjs';

export function readVanillaChunk(payload) {
    if (payload?.format !== 'breakmine:vanilla-chunk-v1') throw new TypeError('Unknown modern chunk format');
    if (!Number.isInteger(payload.height) || payload.height <= 0 || payload.height > 4096 ||
        !Number.isInteger(payload.minY) || payload.minY < -2147483648 || payload.minY + payload.height > 2147483647 ||
        ![payload.chunkX, payload.chunkZ].every(value => Number.isInteger(value) && value >= -134217728 && value <= 134217726)) {
        throw new RangeError('Invalid modern chunk bounds');
    }
    const chunk = new VanillaChunk(payload.chunkX, payload.chunkZ, payload.minY, payload.height);
    if (!(payload.blocks instanceof Uint32Array) || payload.blocks.length !== chunk.blocks.length ||
        !(payload.biomes instanceof Uint16Array) || payload.biomes.length !== chunk.biomes.length ||
        !(payload.heightmap instanceof Int32Array) || payload.heightmap.length !== 256 ||
        payload.heightmap.some(y => y < chunk.minY || y > chunk.minY + chunk.height) ||
        (payload.fluidUpdates !== undefined && (!(payload.fluidUpdates instanceof Uint8Array) || payload.fluidUpdates.length !== chunk.blocks.length))) {
        throw new TypeError('Malformed modern chunk buffers');
    }
    chunk.blocks.set(payload.blocks);
    chunk.biomes.set(payload.biomes);
    chunk.heightmap.set(payload.heightmap);
    if (payload.fluidUpdates) chunk.fluidUpdates = new Uint8Array(payload.fluidUpdates);
    return chunk;
}

export class VanillaChunkStore {
    constructor() { this.chunks = new Map(); }
    setBatch(payloads) {
        if (!Array.isArray(payloads)) throw new TypeError('Expected a chunk batch');
        const chunks = payloads.map(readVanillaChunk);
        for (const chunk of chunks) this.chunks.set(`${chunk.chunkX},${chunk.chunkZ}`, chunk);
        return chunks;
    }
    getChunk(x, z) { return this.chunks.get(`${x},${z}`); }
    getBlockState(x, y, z) {
        if (![x, y, z].every(Number.isSafeInteger)) throw new RangeError('Expected integer block coordinates');
        const chunk = this.getChunk(Math.floor(x / 16), Math.floor(z / 16));
        // Unloaded and out-of-range data are not equivalent to air.
        if (!chunk || y < chunk.minY || y >= chunk.minY + chunk.height) return undefined;
        return chunk.getBlock(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16);
    }
    clear() { this.chunks.clear(); }
}
