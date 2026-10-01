import Packet from "../../../Packet.js";

export default class ClientModListPacket extends Packet {

    constructor(mods) {
        super();
        this.mods = mods || [];
    }

    write(buffer) {
        buffer.writeVarInt(this.mods.length);
        for (const mod of this.mods) {
            buffer.writeString(mod.id || '');
            buffer.writeString(mod.name || '');
            buffer.writeString(mod.version || '');
        }
    }
}
