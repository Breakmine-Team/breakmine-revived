import Packet from "../../../Packet.js";

export default class ClientPlayerBlockPlacementPacket extends Packet {
    constructor(blockPosition, direction, heldItem = { id: -1 }, metadata = -1) {
        super();
        this.blockPosition = blockPosition;
        this.direction = direction;
        this.heldItem = heldItem;
        this.metadata = metadata;
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

        // Optional placement metadata for blocks whose state cannot be
        // derived from the face/yaw (road builder slope layers). Vanilla
        // clients omit this byte; 255 means "ask the block for metadata".
        buffer.writeByte(this.metadata >= 0 ? (this.metadata & 0xF) : 255);
    }
}