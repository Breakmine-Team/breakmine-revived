import GuiButton from "./GuiButton.js";
import fs from "../../fs/ServerFs.js";

export default class GuiWorldSlot extends GuiButton {

    worldName = "";
    worldDate = "";
    worldDetails = "";
    
    constructor(worldData, x, y, width, height, callback, minecraft) {
        super(minecraft, worldData.name, x, y, width, height, callback); 
        
        this.worldName = worldData.name;
        this.worldDate = worldData.date;
        this.worldDetails = worldData.details;
        this.iconPath = worldData.iconPath || null;
        this.worldIcon = null;
        this.iconLoading = false;
        this.iconRequested = false;

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

        if (!this.worldIcon) this.worldIcon = this.getTexture("gui/world_fallback.png");
        if (this.iconPath && !this.iconRequested) {
            this.iconRequested = true;
            this.loadWorldIcon();
        }
        if (this.worldIcon) {
            this.drawSprite(
                stack,
                this.worldIcon,
                0,
                0,
                this.worldIcon.width,
                this.worldIcon.height,
                slotX,
                slotY - 2,
                36,
                36
            );
        }

        this.drawString(stack, this.worldName || '', slotX + 42, slotY + 1, WHITE, true, false);
        this.drawString(stack, this.worldDate || '', slotX + 42, slotY + 12, GRAY, true, false);
        const details = this.worldDetails || '';
        this.drawString(stack, details.charAt(0).toUpperCase() + details.slice(1), slotX + 42, slotY + 22, GRAY, true, false);
    }

    async loadWorldIcon() {
        this.iconLoading = true;
        try {
            await fs.ready();
            const bytes = await fs.readFile(this.iconPath, null);
            const blob = new Blob([bytes], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(url);
                this.worldIcon = image;
                this.iconLoading = false;
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                this.iconLoading = false;
            };
            image.src = url;
        } catch (_) {
            this.iconLoading = false;
        }
    }
    
    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.isMouseOver(mouseX, mouseY)) {
            this.callback(); 
        }
    }
}
