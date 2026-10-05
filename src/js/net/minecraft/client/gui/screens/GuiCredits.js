import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";

export default class GuiCredits extends GuiScreen {

    constructor(previousScreen) {
        super();
        this.previousScreen = previousScreen;

        this.credits = [
            { name: "SpinningCubes", role: "Lead Developer" },
            { name: "Blaise", role: "Developer" },
            { name: "Paradoxism", role: "Developer" },
            { name: "Marw-Programmer", role: "Developer" },
            { name: "ewanhowell5195", role: "Texture Artist" },
        ];
    }

    init() {
        super.init();
        this.buttonList = [];

        // Back Button to return to the previous menu
        this.buttonList.push(new GuiButton("Back", this.width / 2 - 100, this.height - 30, 200, 20, () => {
            this.minecraft.displayScreen(null);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        // Draw the standard dark background
        this.drawDefaultBackground(stack);
        
        // Title
        this.drawCenteredString(stack, "Credits", this.width / 2, 20, 0xFFFFFF);

        let startY = 50;
        let spacing = 15;
        let margin = 70; 
        let leftEdge = margin;
        let rightEdge = this.width - margin;

        this.credits.forEach((entry, index) => {
            let yPos = startY + (index * spacing);

            this.drawString(stack, entry.name, leftEdge, yPos, 0xFFFFFF);
            this.drawRightString(stack, entry.role, rightEdge, yPos, 0xAAAAAA);
        });

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
}