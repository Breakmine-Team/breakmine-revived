import Packet from '../../../Packet.js';

export default class ClientVanillaChunkAckPacket extends Packet {
    constructor(offer, accepted) { super(); this.ack = { token: offer.token, protocol: offer.protocol, source: offer.source, accepted }; }
    write(buffer) { buffer.writeByteArray(new TextEncoder().encode(JSON.stringify(this.ack))); }
}
