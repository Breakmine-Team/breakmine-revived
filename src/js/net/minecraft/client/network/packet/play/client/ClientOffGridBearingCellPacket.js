import Packet from "../../../Packet.js";

export default class ClientOffGridBearingCellPacket extends Packet {

    constructor(x = 0, y = 0, z = 0, cellX = 0, cellY = 0, cellZ = 0, typeId = 0, data = 0) {
        super();

        this.x = x;
        this.y = y;
        this.z = z;
        this.cellX = cellX;
        this.cellY = cellY;
        this.cellZ = cellZ;
        this.typeId = typeId;
        this.data = data;
    }

    write(buffer) {
        buffer.writeInt(this.x);
        buffer.writeVarInt(this.y);
        buffer.writeInt(this.z);
        buffer.writeInt(this.cellX);
        buffer.writeVarInt(this.cellY);
        buffer.writeInt(this.cellZ);
        buffer.writeVarInt(this.typeId);
        buffer.writeByte(this.data & 0xF);
    }
}
