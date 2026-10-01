import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiTextField from "../widgets/GuiTextField.js";
import GuiConnecting from "./GuiConnecting.js";
import Minecraft from "../../Minecraft.js";

export default class GuiDirectConnect extends GuiScreen {

    constructor(previousScreen, addServer = false, tunnel = false) {
        super();

        this.addServer = addServer;
        this.tunnel = tunnel;
        this.previousScreen = previousScreen;
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

        let btnTxt = this.addServer ? "Add Server" : "Connect";
        this.buttonList.push(new GuiButton(this.minecraft, btnTxt, this.width / 2 - 155, y + 110, 150, 20, () => {
            if (this.addServer) {
                const baseData = {
                    name: this.fieldName.text,
                    details: this.fieldAddress.text,
                    address: this.fieldAddress.text,
                    motd: ""
                }
    
                this.minecraft.fs.saveFile(JSON.stringify(baseData), `servers/${this.fieldName.text.replaceAll(' ', '_').replaceAll('/', '_')}.json`).then(() => {
                    this.minecraft.displayScreen(this.previousScreen);
                }).catch(error => {
                    console.error(error);
                });
            } else if (this.tunnel) {
                this.minecraft.displayScreen(new GuiConnecting(this, `tunnel://${this.fieldAddress.text.trim()}`, undefined, null));
            } else {
                let proxy = null;
                let proxyText = this.fieldProxy.text.trim();
                
                // Check if custom proxy is provided
                if (proxyText && (proxyText.startsWith('ws://') || proxyText.startsWith('wss://'))) {
                    proxy = { url: proxyText };
                } else {
                    // Auto-detect: use proxy if not localhost or 10.0.0.213
                    let address = this.fieldAddress.text.trim().toLowerCase();
                    let isLocalhost = address === 'localhost' || address === '127.0.0.1' || address.startsWith('127.0.0.');
                    let isAllowedHost = address === '10.0.0.213';
                    
                    if (!isLocalhost && !isAllowedHost) {
                        proxy = { url: 'ws://174.169.230.116:6003' };
                    }
                }
                
                this.minecraft.displayScreen(new GuiConnecting(this, this.fieldAddress.text, undefined, proxy));
            }
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Cancel", this.width / 2 + 5, y + 110, 150, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        // Background
        this.drawDefaultBackground(stack);

        // Title
        this.drawCenteredString(stack, this.tunnel ? "Join someone's world" : (this.addServer ? "Add a server" : "Connect to a server"), this.width / 2, 50);

        let y = this.height / 2 - 50;

        if (this.addServer) {
            // Server name
            this.drawString(stack, "Name", this.width / 2 - 100, y - 21, -6250336);
        }

        // Server address
        this.drawString(stack, this.tunnel ? "Join Code" : "Server Address", this.width / 2 - 100, y + 17, -6250336);
        
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
        this.minecraft.settings.serverAddress = this.fieldAddress.text;
        this.minecraft.settings.proxy = this.fieldProxy.text;
        this.minecraft.settings.save();
    }

}
