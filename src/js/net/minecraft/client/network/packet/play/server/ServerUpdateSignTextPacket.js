import Packet from "../../../Packet.js";

export default class ServerUpdateSignTextPacket extends Packet {

    constructor() {
        super();

        this.blockPosition = null;
        this.text = null;
    }

    read(buffer) {
        this.blockPosition = buffer.readBlockPosition();
        this.text = buffer.readString();
    }

    handle(handler) {
        handler.handleSignTextUpdate(this);
    }

    getBlockPosition() {
        return this.blockPosition;
    }

    getText() {
        return this.text;
    }
}
