import Packet from "../../../Packet.js";

export default class ServerResetWorldPacket extends Packet {

    constructor() {
        super();
    }

    read(buffer) {
        // No data needed for reset world packet
    }

    handle(handler) {
        handler.handleResetWorld(this);
    }
}
