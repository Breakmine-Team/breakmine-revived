import Packet from "../../../Packet.js";

export default class ClientUpdateSignTextPacket extends Packet {
    constructor(blockPosition, text) {
        super();
        this.blockPosition = blockPosition;
        this.text = text;
    }

    write(buffer) {
        buffer.writeBlockPosition(this.blockPosition);
        buffer.writeString(this.text);
    }
}
