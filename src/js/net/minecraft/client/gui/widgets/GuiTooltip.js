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

        const padding = 2;
        const lineHeight = 10;
        const textHeight = 8;
        const tooltipWidth = maxWidth + padding * 2;
        // One rectangle for the whole tooltip. Drawing one per line made the
        // overlapping 2px gutters blend into near-black bands.
        const tooltipHeight = (lines.length - 1) * lineHeight + textHeight + padding * 2;

        // Mouse coordinates are fractional after scaling from physical pixels.
        // Snap them to the low-resolution GUI grid so the tooltip's rectangle
        // does not round to a different width as the mouse moves.
        let x = Math.floor(mouseX) + 4;
        let y = Math.floor(mouseY) - 10;
        const screenWidth = this.minecraft?.window?.width || 1920;
        const screenHeight = this.minecraft?.window?.height || 1080;

        if (x + tooltipWidth > screenWidth) x = screenWidth - tooltipWidth;
        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (y + tooltipHeight > screenHeight) y = screenHeight - tooltipHeight;

        this.drawRect(stack, x, y, x + tooltipWidth, y + tooltipHeight, 'rgba(0,0,0,0.8)');

        for (let index = 0; index < lines.length; index++) {
            this.drawString(
                stack,
                lines[index],
                x + padding,
                y + padding + index * lineHeight,
                0xFFFFFFFF,
                true,
                false
            );
        }
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