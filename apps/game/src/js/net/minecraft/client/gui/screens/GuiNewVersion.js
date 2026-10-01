import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiMainMenu from "./GuiMainMenu.js";
import Version from "https://codeberg.org/BreakmineDevelopers/breakmine_revived/raw/branch/main/src/resources/version.js";
import Minecraft from "../../Minecraft.js";

export default class GuiVersion extends GuiScreen {

    constructor(minecraft) {
        super();
        this.templateText = `A new version of Breakmine is available (${Version.VERSION})
To update this page, click the 'Reload' button below. If that doesn't work, your
computer might be caching the previous version (${Minecraft.VERSION}).
If so, open DevTools (Ctrl+Shift+I or F12), go to Network tab, click 'Disable Cache'
and then reload page, KEEPING DevTools open (very important!!)`;
    }

    init() {
        super.init();

        let y = this.height / 2 - 50;
        this.buttonList.push(new GuiButton(this.minecraft, "Use older version", this.width / 2 - 155, this.height - 28, 150, 20, () => {
            this.minecraft.displayScreen(null);
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Reload", this.width / 2 + 5, this.height - 28, 150, 20, () => {
            location.reload();
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        this.drawCenteredString(stack, "Version Update", this.width / 2, 20, 0x80FFFFFF);

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