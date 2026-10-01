import Packet from "../../../Packet.js";

export default class ClientPlayerDiggingPacket extends Packet {
    constructor(status, blockPosition, face) {
        super();
        this.status = status;
        this.blockPosition = blockPosition;
        this.face = face;
    }

    write(buffer) {
        buffer.writeByte(this.status);
        buffer.writeBlockPosition(this.blockPosition);
        buffer.writeByte(this.face);
    }
}