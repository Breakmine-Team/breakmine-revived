import Packet from "../../../Packet.js";

export default class ServerResetWorldPacket extends Packet {

    constructor() {
        super();
    }

    read(buffer) {
    }

    handle(handler) {
        handler.handleResetWorld(this);
    }
}
