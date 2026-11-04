import { readVanillaChunk } from './chunk-store.mjs';

export const MODERN_CHUNK_PACKET_ID = 0x4a;
export const MAX_CHUNK_BYTES = 40 + 1024 + 4096 * (256 * 5 + 8);
const MAGIC = 0x43564d42;

function checksum(bytes) {
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
        if (i >= 36 && i < 40) continue;
        hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0;
    }
    return hash;
}

export function encodeVanillaChunk(payload) {
    const chunk = readVanillaChunk(payload);
    const flags = chunk.fluidUpdates ? 1 : 0;
    const size = 40 + 1024 + chunk.blocks.length * 4 + chunk.biomes.length * 2 + (chunk.fluidUpdates?.length ?? 0);
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    [MAGIC, 1, chunk.chunkX, chunk.chunkZ, chunk.minY, chunk.height, flags, chunk.blocks.length, chunk.biomes.length].forEach((value, index) => view.setUint32(index * 4, value, true));
    let offset = 40;
    for (const height of chunk.heightmap) { view.setInt32(offset, height, true); offset += 4; }
    for (const state of chunk.blocks) { view.setUint32(offset, state, true); offset += 4; }
    for (const biome of chunk.biomes) { view.setUint16(offset, biome, true); offset += 2; }
    if (chunk.fluidUpdates) bytes.set(chunk.fluidUpdates, offset);
    view.setUint32(36, checksum(bytes), true);
    return bytes;
}

export function decodeVanillaChunk(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 40 || bytes.byteLength > MAX_CHUNK_BYTES) throw new RangeError('Invalid modern chunk byte length');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1) throw new Error('Unknown modern chunk codec');
    const height = view.getUint32(20, true);
    const flags = view.getUint32(24, true);
    if (height < 16 || height > 4096 || height % 16 || flags > 1 ||
        view.getUint32(28, true) !== height * 256 || view.getUint32(32, true) !== height * 4) throw new Error('Invalid modern chunk header');
    const blockCount = height * 256, biomeCount = height * 4;
    if (bytes.length !== 40 + 1024 + blockCount * 4 + biomeCount * 2 + (flags ? blockCount : 0)) throw new Error('Truncated or trailing modern chunk bytes');
    if (view.getUint32(36, true) !== checksum(bytes)) throw new Error('Modern chunk checksum mismatch');
    const payload = { format: 'breakmine:vanilla-chunk-v1', chunkX: view.getInt32(8, true), chunkZ: view.getInt32(12, true),
        minY: view.getInt32(16, true), height, heightmap: new Int32Array(256), blocks: new Uint32Array(blockCount), biomes: new Uint16Array(biomeCount) };
    let offset = 40;
    for (let i = 0; i < 256; i++) { payload.heightmap[i] = view.getInt32(offset, true); offset += 4; }
    for (let i = 0; i < blockCount; i++) { payload.blocks[i] = view.getUint32(offset, true); offset += 4; }
    for (let i = 0; i < biomeCount; i++) { payload.biomes[i] = view.getUint16(offset, true); offset += 2; }
    if (flags) payload.fluidUpdates = bytes.slice(offset);
    return readVanillaChunk(payload).serialize();
}
