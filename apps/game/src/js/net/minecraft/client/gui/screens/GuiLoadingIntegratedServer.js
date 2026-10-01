import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";

export default class GuiLoadingIntegratedServer extends GuiScreen {

    constructor(previousScreen) {
        super();
        this.previousScreen = previousScreen;
    }

    init() {
        super.init();

        let y = this.height / 2 - 50;
        this.buttonList.push(new GuiButton(this.minecraft, "Cancel Task", this.width / 2 - 100, y + 130, 200, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        // Render dirt background
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        // Render title/status message
        this.drawCenteredString(stack, "Starting integrated server...", this.width / 2, this.height / 2 - 20);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
}