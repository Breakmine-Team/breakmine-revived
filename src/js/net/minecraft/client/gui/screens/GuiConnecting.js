import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import NetworkManager from "../../network/NetworkManager.js";
import HandshakePacket from "../../network/packet/handshake/client/HandshakePacket.js";
import ProtocolState from "../../network/ProtocolState.js";
import NetworkLoginHandler from "../../network/handler/NetworkLoginHandler.js";
import Minecraft from "../../Minecraft.js";
import LoginStartPacket from "../../network/packet/login/client/LoginStartPacket.js";

export default class GuiConnecting extends GuiScreen {

    constructor(previousScreen, address, port, proxy, protocol) {
        super();

        this.previousScreen = previousScreen;
        this.connecting = false;
        this.networkManager = null;
        this.protocol = protocol || NetworkManager.PROTOCOL_BINARY;

        if (typeof address === 'string' && address.startsWith('tunnel://')) {
            this.address = address;
            this.port = 0;
            this.proxy = null;
        } else {
            this.proxy = proxy || Minecraft.PROXY;
            if (this.proxy != proxy) console.log("Using proxy: " + this.proxy.url + " instead of " + proxy.url);

            if (port !== undefined) {
                this.address = address;
                this.port = port;
            } else {
                if (address.includes(":")) {
                    let parts = address.split(":");
                    this.address = parts[0];
                    this.port = parseInt(parts[1]);
                } else {
                    this.address = address;
                    this.port = 25565;
                }
            }
        }
    }

    connect(address, port) {
        this.networkManager = new NetworkManager(this.minecraft);
        this.networkManager.setNetworkHandler(new NetworkLoginHandler(this.networkManager));
        this.networkManager.reconnect = () => {
            this.minecraft.displayScreen(new GuiConnecting(this.previousScreen, this.address, this.port, this.proxy, this.protocol));
        };
        this.networkManager.connect(address, port, this.proxy, this.protocol);

        const mods = this.minecraft.modLoader ? this.minecraft.modLoader.getHandshakeMods() : [];
        this.networkManager.sendPacket(new HandshakePacket(Minecraft.PROTOCOL_VERSION, ProtocolState.LOGIN, mods));
        this.networkManager.sendPacket(new LoginStartPacket(this.minecraft.getSession().getProfile().getUsername()));
    }

    init() {
        super.init();

        let y = this.height / 2 - 50;
        this.buttonList.push(new GuiButton(this.minecraft, "Cancel", this.width / 2 - 100, y + 130, 200, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));

        if (!this.connecting) {
            this.connecting = true;
            this.connect(this.address, this.port);
        }
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        this.drawCenteredString(stack, "Connecting to server...", this.width / 2, this.height / 2 - 20);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }


    onClose() {
        super.onClose();

        if (this.networkManager !== null && this.networkManager.getState() !== ProtocolState.PLAY) {
            this.networkManager.close();
        }
    }
}