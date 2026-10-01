import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiTextField from "../widgets/GuiTextField.js";

export default class GuiAddServer extends GuiScreen {

    /**
     * @param {GuiScreen} parentScreen 
     * @param {{ name: string, host: string }} serverData 
     */
    constructor(parentScreen, serverData) {
        super();
        this.parentScreen = parentScreen;
        this.serverData = serverData;
    }

    init() {
        super.init();
        this.buttonList = [];

        let baseButtonY = this.height / 4 + 96 + 12;

        // Action Buttons
        this.btnSave = new GuiButton(this.minecraft, "Save", this.width / 2 - 100, baseButtonY, 200, 20, () => {
            this.serverData.name = this.txtServerName.getText();
            this.serverData.host = this.txtServerAddress.getText();
            this.parentScreen.deleteWorld(true, 0); // Triggers callback to save state
        });
        this.buttonList.push(this.btnSave);

        this.buttonList.push(new GuiButton(this.minecraft, "Cancel", this.width / 2 - 100, baseButtonY + 24, 200, 20, () => {
            this.parentScreen.deleteWorld(false, 0);
        }));

        // Text Fields
        this.txtServerName = new GuiTextField(this.width / 2 - 100, 76, 200, 20);
        this.txtServerName.isFocused = true;
        this.txtServerName.setText(this.serverData.name);
        this.buttonList.push(this.txtServerName);

        this.txtServerAddress = new GuiTextField(this.width / 2 - 100, 116, 200, 20);
        this.txtServerAddress.setText(this.serverData.host);
        this.buttonList.push(this.txtServerAddress);

        this.validateInput();
    }

    validateInput() {
        let nameLen = this.txtServerName.getText().trim().length;
        let hostStr = this.txtServerAddress.getText().trim();
        
        let isValid = nameLen > 0 && hostStr.length > 0;
        if (isValid) {
            // Block validation if too many colons exist (invalid port format)
            if (hostStr.split(":").length > 2) {
                isValid = false;
            }
        }
        this.btnSave.setEnabled(isValid);
    }

    keyTyped(key, character) {
        super.keyTyped(key, character);

        if (key === "Tab") {
            if (this.txtServerName.isFocused) {
                this.txtServerName.isFocused = false;
                this.txtServerAddress.isFocused = true;
            } else {
                this.txtServerName.isFocused = true;
                this.txtServerAddress.isFocused = false;
            }
            return;
        }

        if (key === "Enter" || key === "NumpadEnter") {
            if (this.btnSave.enabled) {
                this.btnSave.onPress();
            }
            return;
        }

        this.validateInput();
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        
        this.drawCenteredString(stack, "Edit Server Info", this.width / 2, 20);
        this.drawString(stack, "Server Name", this.width / 2 - 100, 64, -6250336);
        this.drawString(stack, "Server Address", this.width / 2 - 100, 104, -6250336);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
}