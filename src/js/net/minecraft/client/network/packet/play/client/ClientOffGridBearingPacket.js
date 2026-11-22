import Packet from "../../../Packet.js";

export default class ClientOffGridBearingPacket extends Packet {

    constructor(x = 0, y = 0, z = 0, axis = 0, angle = 0, pivot = null) {
        super();

        this.x = x;
        this.y = y;
        this.z = z;
        this.axis = axis;
        this.angle = angle;
        this.pivot = pivot;
    }

    write(buffer) {
        buffer.writeInt(this.x);
        buffer.writeVarInt(this.y);
        buffer.writeInt(this.z);
        buffer.writeByte(this.axis & 3);
        buffer.writeFloat(this.angle);
        buffer.writeFloat(this.pivot ? this.pivot.x : 0);
        buffer.writeFloat(this.pivot ? this.pivot.y : 0);
        buffer.writeFloat(this.pivot ? this.pivot.z : 0);
    }
}
