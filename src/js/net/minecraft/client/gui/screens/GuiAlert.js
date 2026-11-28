import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";

export default class GuiAlert extends GuiScreen {

    constructor(previousScreen, message1, message2, buttonText1) {
        super();
        this.previousScreen = previousScreen;
        this.message1 = message1;
        this.message2 = message2;
        this.buttonText1 = buttonText1;
    }

    init() {
        super.init();

        let y = this.height / 2 - 50;
        this.buttonList.push(new GuiButton(this.minecraft, this.buttonText1, this.width / 2 - 100, y + 130, 200, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        this.drawCenteredString(stack, this.message1, this.width / 2, 70, 0xffffffff);
        this.drawCenteredString(stack, this.message2, this.width / 2, 90, 0xffffffff);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
}