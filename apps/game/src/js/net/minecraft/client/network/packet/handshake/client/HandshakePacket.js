import Packet from "../../../Packet.js";

export default class HandshakePacket extends Packet {

    constructor(version, nextState, mods = []) {
        super();

        this.version = version;
        this.nextState = nextState;
        this.mods = mods;
    }

    write(buffer) {
        buffer.writeVarInt(this.version);
        buffer.writeString("localhost");
        buffer.writeShort(25565);
        buffer.writeVarInt(this.nextState.getId());
        if (this.mods.length > 0) {
            buffer.writeVarInt(this.mods.length);
            for (const mod of this.mods) {
                buffer.writeString(mod.id || '');
                buffer.writeString(mod.name || '');
                buffer.writeString(mod.version || '');
            }
        }
    }

    read(buffer) {

    }
}