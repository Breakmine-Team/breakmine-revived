import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import FontRenderer from "../../render/gui/FontRenderer.js";
import GuiMainMenu from "./GuiMainMenu.js";
import GuiLicense from "./GuiLicense.js";

export default class GuiPrelaunch extends GuiScreen {

    constructor(minecraft) {
        super();
        this.templateText = `Welcome to Breakmine: Revived!
It is a new project that I (SpinningCubes) have been working on for at least 3 months, starting 
right after the April 1st announcement of Breakmine being revived. And no, that wan't an April
Fool's joke. That WAS real.

I plan on expanding this very far, and I'm open to all your ideas and insights on what to
improve! If you have any ideas, message me (I'll be glad to add them). I really enjoy people 
that actually give me textures instead of me having to manually make them for their ideas.
Obviously I'm talking about custom blocks that don't already exist in like Minecraft or Breakmine
version 1. You get the point though, I think :)

Anywho, if you find a bug or would like to request a new feauture, click the special "Ticket" 
button in the ingame menu to automatically send me a ticket for it! (This only works if you're 
signed in with a Breakmine account) Oh, and as a plus, you can get replies ingame! Maybe I
might even add a friend system...

So go and play the game. Do something. Oh, and don't forget: please try to break the logic,
because if you do and I decide to not keep it as a feature, I'll never know about that bug.




PS: I finally fixed multiplayer: No more lighting issues, incorrect ping, or floating torches! :)`;
    }

    init() {
        super.init();

        let y = this.height / 2 - 50;
        this.buttonList.push(new GuiButton(this.minecraft, "Let's play!", this.width / 2 - 155, this.height - 28, 150, 20, () => {
            this.minecraft.displayScreen(new GuiMainMenu());
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "See License", this.width / 2 + 5, this.height - 28, 150, 20, () => {
            this.minecraft.displayScreen(new GuiLicense());
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        this.drawCenteredString(stack, "Breakmine's Revival!", this.width / 2, 20, 0x80FFFFFF);

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