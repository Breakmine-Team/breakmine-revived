import Packet from "../../../Packet.js";

export default class ClientPlayerBlockPlacementPacket extends Packet {
    constructor(blockPosition, direction, heldItem = { id: -1 }) {
        super();
        this.blockPosition = blockPosition;
        this.direction = direction;
        this.heldItem = heldItem;
    }

    write(buffer) {
        buffer.writeBlockPosition(this.blockPosition);
        buffer.writeByte(this.direction);

        buffer.writeShort(this.heldItem.id);
        if (this.heldItem.id !== -1) {
            buffer.writeByte(this.heldItem.count || 1);
            buffer.writeShort(this.heldItem.damage || 0);
            buffer.writeByte(0);
        }

        buffer.writeByte(0);
        buffer.writeByte(0);
        buffer.writeByte(0);
    }
}