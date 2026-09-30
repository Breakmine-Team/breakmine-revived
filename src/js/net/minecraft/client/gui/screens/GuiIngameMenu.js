import GuiButton from "../widgets/GuiButton.js";
import GuiScreen from "../GuiScreen.js";
import GuiOptions from "./GuiOptions.js";
import { isIntegratedRunning } from "../../integrated/IntegratedServer.js";

export default class GuiIngameMenu extends GuiScreen {

    constructor() {
        super();
        this.pauseGame = true;
    }

    init() {
        super.init();

        let y = this.height / 2 - 30;
        this.buttonList.push(new GuiButton(this.minecraft, "Back to game", this.width / 2 - 100, y, 200, 20, () => {
            this.minecraft.displayScreen(null);
        }));

        this.buttonList.push(new GuiButton(this.minecraft, "Options...", this.width / 2 - 100, y + 24, 98, 20, () => {
            this.minecraft.displayScreen(new GuiOptions(this));
        }));

        const modButtons = this.minecraft.modLoader?.getGuiButtons('pause-menu', this) || [];
        for (const button of modButtons) {
            button.x = this.width / 2 + 2;
            button.y = y + 24;
            button.width = 98;
            button.height = 20;
            this.buttonList.push(button);
        }

        const shareButton = new GuiButton(this.minecraft, "Share World", this.width / 2 + 2, y + 24, 98, 20, () => {
            this.minecraft.shareWorld();
        });
        shareButton.setEnabled(isIntegratedRunning());
        this.buttonList.push(shareButton);

        this.buttonList.push(new GuiButton(this.minecraft, "Save and Quit to Title", this.width / 2 - 100, y + 70, 200, 20, async () => {
            await this.minecraft.loadWorld(null);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        // Background
        this.drawRect(stack, 0, 0, this.width, this.height, 'black', 0.6);

        // Title
        this.drawCenteredString(stack, "Game menu", this.width / 2, 50);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

}
