import Packet from "../../../Packet.js";

export default class ServerEntityEquipmentPacket extends Packet {

    constructor() {
        super();

        this.entityId = 0;
        this.slot = 0;
        this.itemId = 0;
        this.count = 0;
        this.damage = 0;
    }

    read(buffer) {
        this.entityId = buffer.readVarInt();
        this.slot = buffer.readShort();

        // ByteBuf keeps shorts unsigned, so turn the empty-hand sentinel
        // (0xFFFF) back into -1 before deciding whether a stack follows.
        let itemId = buffer.readShort() & 0xFFFF;
        if (itemId === 0xFFFF) {
            itemId = -1;
        }

        if (itemId > 0) {
            this.itemId = itemId;
            this.count = buffer.readUnsignedByte();
            this.damage = buffer.readShort();
        } else {
            this.itemId = 0;
            this.count = 0;
            this.damage = 0;
        }
    }

    handle(handler) {
        handler.handleEntityEquipment(this);
    }

    getEntityId() {
        return this.entityId;
    }

    getSlot() {
        return this.slot;
    }

    getItemId() {
        return this.itemId;
    }

    getCount() {
        return this.count;
    }

    getDamage() {
        return this.damage;
    }
}
