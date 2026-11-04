import GuiButton from "./GuiButton.js";
import GuiTooltip from "./GuiTooltip.js";

export default class GuiWorldPresetSlotContainer extends GuiButton {

    worldName = "";
    worldDate = "";
    worldDetails = "";
    
    constructor(worldData, x, y, width, height, callback, minecraft) {
        super(minecraft, worldData.name, x, y, width, height, callback); 
        
        this.worldName = worldData.name;
        this.worldDetails = worldData.details;
        this.presetSeed = worldData.seed || "";

        this.drawButton = () => {}; 
        
        // Ensure renderE is set to true
        this.renderE = true;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) return;
        
        const slotX = this.x;
        const slotY = this.y;
        
        const WHITE = 16777215;
        const GRAY = 8421504;
        
        this.drawString(stack, this.worldName, slotX + 2, slotY + 1, WHITE, true, false);
        this.drawString(stack, this.worldDetails, slotX + 2, slotY + 12, GRAY, true, false);
        if (this.presetSeed) {
            this.drawString(stack, "Seed: " + this.presetSeed, slotX + 2, slotY + 22, GRAY, true, false);
        }
    }
    
    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.isMouseOver(mouseX, mouseY)) {
            this.callback(); 
        }
    }
}