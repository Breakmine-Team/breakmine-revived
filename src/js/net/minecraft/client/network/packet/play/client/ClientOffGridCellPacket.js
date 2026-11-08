import Packet from "../../../Packet.js";

export default class ClientOffGridCellPacket extends Packet {

    constructor(x, y, z, typeId, data = 0) {
        super();
        this.x = x;
        this.y = y;
        this.z = z;
        this.typeId = typeId;
        this.data = data;
    }

    write(buffer) {
        buffer.writeInt(this.x);
        buffer.writeVarInt(this.y);
        buffer.writeInt(this.z);
        buffer.writeVarInt(this.typeId);
        buffer.writeByte(this.data & 0xF);
    }
}
