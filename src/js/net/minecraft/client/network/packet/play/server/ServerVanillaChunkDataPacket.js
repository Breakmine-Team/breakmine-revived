import Packet from '../../../Packet.js';
import { decodeVanillaChunk, encodeVanillaChunk, MAX_CHUNK_BYTES } from '../../../../../../../../../packages/vanilla-worldgen/chunk-codec.mjs';

export default class ServerVanillaChunkDataPacket extends Packet {
    constructor(chunk) { super(); this.chunk = chunk; }
    read(buffer) {
        const length = buffer.readVarInt();
        if (length < 40 || length > MAX_CHUNK_BYTES || length > buffer.length() - buffer.getPosition()) throw new Error('Invalid modern chunk packet length');
        const bytes = [];
        buffer.read(bytes, length);
        this.chunk = decodeVanillaChunk(new Uint8Array(bytes));
    }
    write(buffer) { buffer.writeByteArray(encodeVanillaChunk(this.chunk)); }
    handle(handler) { handler.handleVanillaChunkData(this); }
}
