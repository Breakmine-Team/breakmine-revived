import PacketHandler from "../handler/PacketHandler.js";
import GuiDisconnected from "../../gui/screens/GuiDisconnected.js";

export default class NetworkStatusHandler extends PacketHandler {

    constructor(minecraft, callback) {
        super();

        this.minecraft = minecraft;
        this.callback = callback;
    }

    handleStatusResponse(packet) {
        this.callback(packet.object);
    }

    onDisconnect(reason, wasConnected) {
        // A server that never answered must not take over the screen: the
        // server list already shows it as unreachable. Only a ping connection
        // that opened and then dropped is worth reporting.
        if (!wasConnected) return;
        this.minecraft.displayScreen(new GuiDisconnected("NetworkManager lost"));
    }

}