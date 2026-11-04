import Packet from '../../../Packet.js';
import { validateChunkOffer } from '../../../../../../../../../packages/vanilla-worldgen/chunk-session.mjs';

export default class ServerVanillaChunkOfferPacket extends Packet {
    read(buffer) {
        const length = buffer.readVarInt();
        if (length < 1 || length > 1024 || length > buffer.length() - buffer.getPosition()) throw new Error('Invalid vanilla offer length');
        const bytes = [];
        buffer.read(bytes, length);
        this.offer = validateChunkOffer(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))));
    }
    handle(handler) { return handler.handleVanillaChunkOffer(this); }
}
