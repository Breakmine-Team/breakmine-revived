import Packet from "../../../Packet.js";

export default class ServerBlockEffectPacket extends Packet {

    static BREAK = 0;
    static PLACE = 1;

    constructor() {
        super();

        this.blockPosition = null;
        this.blockId = 0;
        this.action = 0;
    }

    read(buffer) {
        this.blockPosition = buffer.readBlockPosition();
        this.blockId = buffer.readVarInt();
        this.action = buffer.readByte();
    }

    handle(handler) {
        handler.handleBlockEffect(this);
    }

    getBlockPosition() {
        return this.blockPosition;
    }

    getBlockId() {
        return this.blockId;
    }

    getAction() {
        return this.action;
    }
}
