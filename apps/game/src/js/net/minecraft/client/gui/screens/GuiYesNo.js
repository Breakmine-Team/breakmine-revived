import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";

export default class GuiYesNo extends GuiScreen {

    constructor(parentScreen, message1, message2, buttonText1, buttonText2, contextId) {
        super();
        this.parentScreen = parentScreen;
        this.message1 = message1;
        this.message2 = message2;
        this.buttonText1 = buttonText1;
        this.buttonText2 = buttonText2;
        this.contextId = contextId;
    }

    init() {
        super.init();
        this.buttonList = [];

        let buttonY = this.height / 6 + 96;

        this.buttonList.push(new GuiButton(this.minecraft, this.buttonText1, this.width / 2 - 155, buttonY, 150, 20, () => {
            if (typeof this.contextId === 'function') {
                this.contextId();
            } else if (this.parentScreen.deleteWorld) {
                this.parentScreen.deleteWorld(true, this.contextId);
            }
            this.minecraft.displayScreen(this.parentScreen);
        }));

        this.buttonList.push(new GuiButton(this.minecraft, this.buttonText2, this.width / 2 + 5, buttonY, 150, 20, () => {
            if (typeof this.contextId === 'function') {
                // Do nothing on cancel for callback-based usage
            } else if (this.parentScreen.deleteWorld) {
                this.parentScreen.deleteWorld(false, this.contextId);
            }
            this.minecraft.displayScreen(this.parentScreen);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        this.drawCenteredString(stack, this.message1, this.width / 2, 70, 0xffffffff);
        this.drawCenteredString(stack, this.message2, this.width / 2, 90, 0xffffffff);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
}