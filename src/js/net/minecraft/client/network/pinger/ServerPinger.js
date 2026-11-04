import NetworkManager from "../NetworkManager.js";
import NetworkStatusHandler from "./NetworkStatusHandler.js";
import Minecraft from "../../Minecraft.js";
import HandshakePacket from "../packet/handshake/client/HandshakePacket.js";
import ProtocolState from "../ProtocolState.js";
import StatusQueryPacket from "../packet/status/client/StatusQueryPacket.js";

export default class ServerPinger {

    constructor(minecraft) {
        this.minecraft = minecraft;
    }

    ping(address, port, callback, proxy) {
        // Auto-detect proxy if not provided
        if (!proxy) {
            let addressLower = address.trim().toLowerCase();
            let isLocalhost = addressLower === 'localhost' || addressLower === '127.0.0.1' || addressLower.startsWith('127.0.0.');
            let isAllowedHost = addressLower === '10.0.0.213';
            
            if (!isLocalhost && !isAllowedHost) {
                proxy = { url: 'ws://174.169.230.116:6003' };
            }
        }

        // Connect to server
        this.connection = new NetworkManager(this.minecraft);
        this.connection.setNetworkHandler(new NetworkStatusHandler(this.minecraft, callback));
        this.connection.connect(address, port, proxy);

        // Request status
        this.connection.sendPacket(new HandshakePacket(Minecraft.PROTOCOL_VERSION, ProtocolState.STATUS));
        this.connection.sendPacket(new StatusQueryPacket());
    }


}