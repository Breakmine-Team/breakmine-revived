import Packet from "../../../Packet.js";

export default class ServerTimeUpdatePacket extends Packet {

    constructor(worldTime) {
        super();

        this.worldTime = worldTime;
    }

    read(buffer) {
        this.worldTime = buffer.readLong();
    }

    handle(handler) {
        handler.handleTimeUpdate(this);
    }

    getWorldTime() {
        return this.worldTime;
    }
}
