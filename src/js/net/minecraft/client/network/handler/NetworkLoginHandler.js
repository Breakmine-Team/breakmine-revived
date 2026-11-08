import PacketHandler from "./PacketHandler.js";
import EncryptionResponsePacket from "../packet/login/client/EncryptionResponsePacket.js";
import CryptManager from "../util/CryptManager.js";
import GuiDisconnected from "../../gui/screens/GuiDisconnected.js";
import Authentication from "../util/Authentication.js";
import NetworkPlayHandler from "./NetworkPlayHandler.js";
import ProtocolState from "../ProtocolState.js";
import GuiYesNo from "../../gui/screens/GuiYesNo.js";

function messageToText(message) {
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(messageToText).join('');
    if (message && typeof message === 'object') {
        let text = typeof message.text === 'string' ? message.text : '';
        if (Array.isArray(message.extra)) text += message.extra.map(messageToText).join('');
        else if (typeof message.translate === 'string') text += message.translate;
        return text;
    }
    return '';
}

function isModRejection(message) {
    const text = messageToText(message).replace(/§./g, '');
    return /does not allow mods|mods are not allowed/i.test(text);
}

export default class NetworkLoginHandler extends PacketHandler {

    constructor(networkManager) {
        super();

        this.networkManager = networkManager;
        this.authentication = new Authentication(networkManager);
    }

    handleEncryptionRequest(packet) {
        let secretKey = CryptManager.createNewSharedKey();

        let session = this.networkManager.minecraft.getSession();
        let serverId = this.authentication.createServerHash(packet.serverId, secretKey, packet.publicKey);
        this.authentication.joinServer(session.getProfile(), session.getAccessToken(), serverId);

        this.networkManager.sendPacket(new EncryptionResponsePacket(secretKey, packet.publicKey, packet.verifyToken));

        this.networkManager.enableEncryption(secretKey);
    }

    handleLoginDisconnect(packet) {
        this.disconnectReason = packet.message;
        console.log("[Network] Disconnected from server: " + this.disconnectReason);

        const minecraft = this.networkManager.minecraft;
        const modLoader = minecraft.modLoader;
        const disconnectScreen = new GuiDisconnected(this.disconnectReason);

        if (isModRejection(this.disconnectReason)
            && modLoader && typeof modLoader.getHandshakeMods === 'function'
            && typeof this.networkManager.reconnect === 'function'
            && modLoader.getHandshakeMods().length > 0) {
            minecraft.displayScreen(new GuiYesNo(
                disconnectScreen,
                "This server does not allow mods.",
                "Temporarily disable your mods and join?",
                "Disable Mods & Join",
                "Cancel",
                () => {
                    if (modLoader.temporarilyDisableMods() > 0) {
                        queueMicrotask(() => this.networkManager.reconnect());
                    }
                }
            ));
            return;
        }

        minecraft.displayScreen(disconnectScreen);
    }

    handleLoginSuccess(packet) {
        this.networkManager.setState(ProtocolState.PLAY);
        this.networkManager.setNetworkHandler(new NetworkPlayHandler(this.networkManager, packet.profile));
    }

    handleEnableCompression(packet) {
        this.networkManager.setCompressionThreshold(packet.getCompressionThreshold());
    }

    onDisconnect() {
        if (this.networkManager.minecraft.isInGame()) {
            this.networkManager.minecraft.displayScreen(new GuiDisconnected(this.disconnectReason || "Disconnected from server"));
        }
    }

}