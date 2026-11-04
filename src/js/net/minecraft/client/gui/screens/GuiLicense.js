import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import FontRenderer from "../../render/gui/FontRenderer.js";
import GuiMainMenu from "./GuiMainMenu.js";
import GuiPrelaunch from "./GuiPrelaunch.js";

export default class GuiLicense extends GuiScreen {

    constructor(minecraft) {
        super();
        this.templateText = `Permission is granted to use and modify this software subject to the following conditions:

- Source Available: The source code must always remain open and accessible if requested.
- Modifications: You must get email confirmation from SpinningCubes or maintainers before 
  sharing any modified source code.
- No Selling: You cannot sell or monetize the source code or its modifications.
- Fair Use Modding: Mods are allowed but must be 100% free (no monetization) and contain no 
  copyrighted material.

The software is provided "as-is" without any warranties.

Contacts:
- SpinningCubes: azuretecdevs@gmail.com`;
    }

    init() {
        super.init();

        let y = this.height / 2 - 50;
        this.buttonList.push(new GuiButton(this.minecraft, "Back", this.width / 2 - 75, this.height - 28, 150, 20, () => {
            this.minecraft.displayScreen(new GuiPrelaunch());
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        this.drawCenteredString(stack, "SpinningCubes License (SCLv1)", this.width / 2, 20, 0x80FFFFFF);

        let fontRenderer = this.minecraft.fontRenderer || this.minecraft.getFontRenderer?.();
        if (fontRenderer && this.templateText) {
            let lines = this.templateText.split('\n');
            
            let lineHeight = 10;
            let paddingLeftRight = 5;
            let paddingTopBottom = 5;

            let boxLeft = 10;
            let boxTop = 40; 
            let boxRight = this.width - 10;
            let boxBottom = this.height - 38;

            this.drawRect(stack, boxLeft, boxTop, boxRight, boxBottom, 0x202020, 0.6);

            let textX = boxLeft + paddingLeftRight;
            let startY = boxTop + paddingTopBottom;

            for (let i = 0; i < lines.length; i++) {
                let textY = startY + (i * lineHeight);
                if (textY + lineHeight <= boxBottom - paddingTopBottom) {
                    this.drawString(stack, lines[i], textX, textY, 0xFFFFFFFF);
                }
            }
        }

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
}