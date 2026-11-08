import Gui from "../Gui.js";

export default class GuiTooltip extends Gui {

    // Tooltips are queued during the frame and painted by ScreenRenderer after
    // every screen element, so they always appear above other widgets.
    static pending = [];

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

        GuiTooltip.pending.push({ tooltip: this, stack, mouseX, mouseY });
    }

    static flush() {
        const pending = GuiTooltip.pending;
        GuiTooltip.pending = [];

        for (const entry of pending) {
            entry.tooltip.drawTooltip(entry.stack, entry.mouseX, entry.mouseY);
        }
    }

    drawTooltip(stack, mouseX, mouseY) {
        const lines = this.string.split('\n');
        
        let maxWidth = 0;
        for (const line of lines) {
            const width = this.getStringWidth(stack, line, true);
            if (width > maxWidth) {
                maxWidth = width;
            }
        }

        let l1 = Math.floor(mouseX) + 12;
        let i2 = Math.floor(mouseY) - 12;
        
        const lineSpacing = 10;
        const padding = 2;

        let k = 8;
        if (lines.length > 1) {
            k += (lines.length - 1) * lineSpacing;
        }

        const screenWidth = this.minecraft?.window?.width || 1920;
        const screenHeight = this.minecraft?.window?.height || 1080;

        const totalWidth = maxWidth + padding * 2;
        const totalHeight = k + padding * 2;

        if (l1 + totalWidth + 6 > screenWidth) {
            l1 -= (totalWidth + 28);
        }

        if (i2 + totalHeight + 6 > screenHeight) {
            i2 = screenHeight - totalHeight - 6;
        }
        if (l1 < 0) l1 = 0;
        if (i2 < 0) i2 = 0;

        const bgColor = 'rgba(16, 0, 16, 0.941)';
        const borderStart = 'rgba(80, 0, 255, 0.50)';
        const borderEnd = 'rgba(40, 0, 127, 0.50)';

        // Inner bounds directly enclosing text with 1px padding
        const x1 = l1 - padding;
        const y1 = i2 - padding;
        const x2 = l1 + maxWidth + padding;
        const y2 = i2 + k + padding;

        // 1. Draw outer 1px black outline / background rects with proper 1px corner notches
        this.drawRect(stack, x1 - 1, y1 - 2, x2 + 1, y1 - 1, bgColor);
        this.drawRect(stack, x1 - 1, y2 + 1, x2 + 1, y2 + 2, bgColor);
        this.drawRect(stack, x1 - 1, y1 - 1, x2 + 1, y2 + 1, bgColor);
        this.drawRect(stack, x1 - 2, y1 - 1, x1 - 1, y2 + 1, bgColor);
        this.drawRect(stack, x2 + 1, y1 - 1, x2 + 2, y2 + 1, bgColor);

        // 2. Draw inner gradient border lines with 1px corner notches
        this.drawGradientRect(stack, x1 - 1, y1, x1, y2, borderStart, borderEnd);
        this.drawGradientRect(stack, x2, y1, x2 + 1, y2, borderStart, borderEnd);
        this.drawGradientRect(stack, x1, y1 - 1, x2, y1, borderStart, borderStart);
        this.drawGradientRect(stack, x1, y2, x2, y2 + 1, borderEnd, borderEnd);

        // 3. Render text lines with reduced line spacing
        let currentY = i2;
        for (let k1 = 0; k1 < lines.length; ++k1) {
            const s1 = lines[k1];
            this.drawString(
                stack,
                s1,
                l1,
                currentY,
                0xFFFFFFFF,
                true,
                false
            );
            currentY += lineSpacing;
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