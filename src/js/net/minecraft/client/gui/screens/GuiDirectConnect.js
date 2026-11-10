import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiTextField from "../widgets/GuiTextField.js";
import GuiDynamicSwitchButton from "../widgets/GuiDynamicSwitchButton.js";
import GuiConnecting from "./GuiConnecting.js";
import NetworkManager from "../../network/NetworkManager.js";
import Minecraft from "../../Minecraft.js";

export default class GuiDirectConnect extends GuiScreen {

    constructor(previousScreen, addServer = false, tunnel = false) {
        super();

        this.addServer = addServer;
        this.tunnel = tunnel;
        this.previousScreen = previousScreen;
        this.protocol = NetworkManager.PROTOCOL_BINARY;
    }

    init() {
        super.init();

        let y = this.height / 2 - 50;

        if (this.addServer) {
            this.fieldName = new GuiTextField(this.width / 2 - 100, y - 8, 200, 20);
            this.fieldName.setText("A Breakmine Server");
            this.buttonList.push(this.fieldName);
        }
        this.fieldAddress = new GuiTextField(this.width / 2 - 100, y + 30, 200, 20);
        this.fieldProxy = new GuiTextField(this.width / 2 - 100, y + 67, 200, 20);
        this.fieldAddress.maxLength = 30;
        this.buttonList.push(this.fieldAddress);

        if (!this.tunnel) {
            this.buttonProtocol = new GuiDynamicSwitchButton(
                "Protocol",
                this.protocol === NetworkManager.PROTOCOL_JSON ? "QuickJSON" : "Binary",
                this.width / 2 - 100,
                y + 94,
                200,
                20,
                {
                    values: ["Binary", "QuickJSON"],
                    callback: value => {
                        this.protocol = value === "QuickJSON"
                            ? NetworkManager.PROTOCOL_JSON
                            : NetworkManager.PROTOCOL_BINARY;
                    }
                }
            ).setTooltip("Most servers use Binary.");
            this.buttonList.push(this.buttonProtocol);
        }

        const buttonY = this.tunnel ? y + 110 : y + 122;
        let btnTxt = this.addServer ? "Add Server" : "Connect";
        this.buttonList.push(new GuiButton(this.minecraft, btnTxt, this.width / 2 - 155, buttonY, 150, 20, () => {
            if (this.addServer) {
                const baseData = {
                    name: this.fieldName.text,
                    details: this.fieldAddress.text,
                    address: this.fieldAddress.text,
                    motd: "",
                    protocol: this.protocol
                }
    
                this.minecraft.fs.saveFile(JSON.stringify(baseData), `servers/${this.fieldName.text.replaceAll(' ', '_').replaceAll('/', '_')}.json`).then(() => {
                    this.minecraft.displayScreen(this.previousScreen);
                }).catch(error => {
                    console.error(error);
                });
            } else if (this.tunnel) {
                const code = this.fieldAddress.text.trim().toUpperCase();
                if (code === "") {
                    return;
                }
                this.minecraft.displayScreen(new GuiConnecting(this, `tunnel://${code}`, undefined, null));
            } else {
                let proxy = null;
                let proxyText = this.fieldProxy.text.trim();
                
                if (proxyText && (proxyText.startsWith('ws://') || proxyText.startsWith('wss://'))) {
                    proxy = { url: proxyText };
                } else {
                    let address = this.fieldAddress.text.trim().toLowerCase();
                    let isLocalhost = address === 'localhost' || address === '127.0.0.1' || address.startsWith('127.0.0.');
                    let isAllowedHost = address === '10.0.0.213';
                    
                    if (!isLocalhost && !isAllowedHost) {
                        proxy = { url: 'ws://174.169.230.116:6003' };
                    }
                }
                
                this.minecraft.displayScreen(new GuiConnecting(this, this.fieldAddress.text, undefined, proxy, this.protocol));
            }
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Cancel", this.width / 2 + 5, buttonY, 150, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);

        this.drawCenteredString(stack, this.tunnel ? "Join someone's world" : (this.addServer ? "Add a server" : "Connect to a server"), this.width / 2, 50);

        let y = this.height / 2 - 50;

        if (this.addServer) {
            this.drawString(stack, "Name", this.width / 2 - 100, y - 21, -6250336);
        }

        this.drawString(stack, this.tunnel ? "Join Code" : "Server Address", this.width / 2 - 100, y + 17, -6250336);
        
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
        this.minecraft.settings.serverAddress = this.fieldAddress.text;
        this.minecraft.settings.proxy = this.fieldProxy.text;
        this.minecraft.settings.save();
    }

}
