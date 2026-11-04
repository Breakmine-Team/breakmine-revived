import Gui from "../Gui.js";

export default class GuiTooltip extends Gui {

    constructor(minecraft, string, x, y, width, height) {
        super(minecraft);

        this.string = string;

        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.isMouseOver(mouseX, mouseY)) return;
        if (!this.string) {
            return;
        }

        const lines = this.string.split('\n');
        
        let maxWidth = 0;
        for (const line of lines) {
            const width = this.getStringWidth(stack, line, true);
            if (width > maxWidth) {
                maxWidth = width;
            }
        }

        for (let index = 0; index < lines.length; index++) {
            const string = lines[index];
            const factor = 10 * index;
            this.drawLine(stack, string, mouseX, mouseY + factor, maxWidth); 
        }
    }

    drawLine(stack, text, mouseX, mouseY, maxWidth) {
        const padding = 2;
        
        const textWidth = maxWidth; 
        
        const textHeight = 8;
        const tooltipWidth = textWidth + padding * 2;
        const tooltipHeight = textHeight + padding * 2;
        let x = mouseX + 4;
        let y = mouseY - 10;
        const screenWidth = this.minecraft?.window?.width || 1920; 
        const screenHeight = this.minecraft?.window?.height || 1080;
        
        if (tooltipWidth <= screenWidth) {
            if (x + tooltipWidth > screenWidth) x = screenWidth - tooltipWidth;
            if (x < 0) x = 0;
            if (y < 0) y = 0;
            if (y + tooltipHeight > screenHeight) y = screenHeight - tooltipHeight;
        }
        
        this.drawRect(stack, x, y, x + tooltipWidth, y + tooltipHeight, 'rgba(0,0,0,0.8)');
        this.drawString(stack, text, x + padding, y + padding, 0xFFFFFFFF, true, false);
    }

    onTick() {

    }

    isMouseOver(mouseX, mouseY) {
        return mouseX > this.x && mouseX < this.x + this.width && mouseY > this.y && mouseY < this.y + this.height;
    }

    isSelectable() {
        return false;
    }

    mouseClicked(mouseX, mouseY, mouseButton) {

    }

    mouseReleased(mouseX, mouseY, mouseButton) {

    }

    mouseDragged(mouseX, mouseY, mouseButton) {

    }

    keyTyped(key, character) {

    }

    keyReleased(key) {

    }

}