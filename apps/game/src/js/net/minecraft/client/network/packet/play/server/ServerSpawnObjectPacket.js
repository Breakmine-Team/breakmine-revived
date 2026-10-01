import Packet from "../../../Packet.js";

export default class ServerSpawnObjectPacket extends Packet {

    constructor() {
        super();
        this.entityId = 0;
        this.type = 0;
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.pitch = 0;
        this.yaw = 0;
        this.objectData = 0;
        this.pickupDelay = 0;
        this.velocityX = 0;
        this.velocityY = 0;
        this.velocityZ = 0;
    }

    read(buffer) {
        this.entityId = buffer.readVarInt();
        this.type = buffer.readByte();
        this.x = buffer.readInt();
        this.y = buffer.readInt();
        this.z = buffer.readInt();
        this.pitch = buffer.readByte();
        this.yaw = buffer.readByte();
        this.objectData = buffer.readInt();
        this.pickupDelay = buffer.readByte();
        if (this.objectData > 0) {
            this.velocityX = buffer.readShort();
            this.velocityY = buffer.readShort();
            this.velocityZ = buffer.readShort();
        }
    }

    handle(handler) {
        handler.handleServerSpawnObject(this);
    }

    getEntityId() {
        return this.entityId;
    }

    getType() {
        return this.type;
    }

    getX() {
        return this.x;
    }

    getY() {
        return this.y;
    }

    getZ() {
        return this.z;
    }

    getObjectData() {
        return this.objectData;
    }

    getPickupDelay() {
        return this.pickupDelay;
    }

    getVelocityX() {
        return this.velocityX;
    }

    getVelocityY() {
        return this.velocityY;
    }

    getVelocityZ() {
        return this.velocityZ;
    }
}
