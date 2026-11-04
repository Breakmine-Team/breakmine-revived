import Packet from '../../../Packet.js';

export default class ServerVanillaChunkUnloadPacket extends Packet {
    read(buffer) {
        if (buffer.length() - buffer.getPosition() !== 8) throw new Error('Invalid native chunk unload length');
        this.x = buffer.readInt();
        this.z = buffer.readInt();
    }
    handle(handler) { handler.handleVanillaChunkUnload(this); }
}
