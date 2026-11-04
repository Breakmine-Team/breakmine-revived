import Packet from "../../../Packet.js";

export default class ServerSpawnPositionPacket extends Packet {

    constructor() {
        super();

        this.spawnX = 0;
        this.spawnY = 0;
        this.spawnZ = 0;
    }

    read(buffer) {
        this.spawnX = buffer.readInt();
        this.spawnY = buffer.readInt();
        this.spawnZ = buffer.readInt();
    }

    handle(handler) {
        handler.handleServerSpawnPosition(this);
    }

    getSpawnX() {
        return this.spawnX;
    }

    getSpawnY() {
        return this.spawnY;
    }

    getSpawnZ() {
        return this.spawnZ;
    }
}
