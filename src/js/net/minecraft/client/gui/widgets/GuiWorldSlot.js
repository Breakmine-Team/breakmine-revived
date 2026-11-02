import GuiButton from "./GuiButton.js";

export default class GuiWorldSlot extends GuiButton {

    worldName = "";
    worldDate = "";
    worldDetails = "";
    
    constructor(worldData, x, y, width, height, callback, minecraft) {
        super(minecraft, worldData.name, x, y, width, height, callback); 
        
        this.worldName = worldData.name;
        this.worldDate = worldData.date;
        this.worldDetails = worldData.details;

        this.drawButton = () => {}; 
        
        // Ensure renderE is set to true
        this.renderE = true;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) {return};

        const slotX = this.x;
        const slotY = this.y;

        const WHITE = 16777215;
        const GRAY = 8421504;

        // Draw icon on the left side (centered in 36px area)
        try {
            const iconTexture = this.getTexture("gui/new_world.png");
            if (iconTexture) {
                const iconSize = 34;
                const iconX = slotX + 1;
                const iconY = slotY - 1;
                this.drawSprite(stack, iconTexture, 0, 0, 256, 256, iconX, iconY, iconSize, iconSize);
            }
        } catch (e) {
            // continue silently if no texture
        }

        // Match GuiWorldSlot's drawString calls exactly
        this.drawString(stack, this.worldName || '', slotX + 38, slotY + 1, WHITE, true, false);
        this.drawString(stack, '§7' + this.worldDate || '', slotX + 38, slotY + 12, GRAY, true, false);
        const details = this.worldDetails || '';
        this.drawString(stack, '§8' + details.charAt(0).toUpperCase() + details.slice(1), slotX + 38, slotY + 22, GRAY, true, false);
    }
    
    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.isMouseOver(mouseX, mouseY)) {
            this.callback(); 
        }
    }
}