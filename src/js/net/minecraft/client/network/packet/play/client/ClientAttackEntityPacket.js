import Packet from "../../../Packet.js";

export default class ClientAttackEntityPacket extends Packet {

    constructor(entityId) {
        super();
        this.entityId = entityId;
    }

    write(buffer) {
        buffer.writeVarInt(this.entityId);
    }
}
