import Gui from "../Gui.js";
import GuiTooltip from "./GuiTooltip.js";

export default class GuiButton extends Gui {

    constructor(minecraftOrString, stringOrX, xOrY, yOrWidth, widthOrHeight, heightOrCallback, callback) {
        // Handle both old signature (string, x, y, width, height, callback) 
        // and new signature (minecraft, string, x, y, width, height, callback)
        if (typeof minecraftOrString === 'string') {
            // Old signature without minecraft
            super(null);
            this.string = minecraftOrString;
            this.x = stringOrX;
            this.y = xOrY;
            this.width = yOrWidth;
            this.height = widthOrHeight;
            this.callback = heightOrCallback;
        } else {
            // New signature with minecraft
            super(minecraftOrString);
            this.string = stringOrX;
            this.x = xOrY;
            this.y = yOrWidth;
            this.width = widthOrHeight;
            this.height = heightOrCallback;
            this.callback = callback;
        }

        this.enabled = true;
        this.focused = false;
        this.tooltip = null;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        let mouseOver = this.isMouseOver(mouseX, mouseY) || this.focused;
        this.drawButton(stack, this.enabled, mouseOver, this.x, this.y, this.width, this.height);
        this.drawCenteredString(stack, (this.enabled ? (mouseOver ? "§e" : "") : "§7") + this.string, this.x + this.width / 2, this.y + this.height / 2 - 4, 0xFFFFFFFF, false);

        if (this.tooltipString && this.minecraft && mouseOver) {
            if (!this.tooltip) {
                this.tooltip = new GuiTooltip(this.minecraft, this.tooltipString, this.x, this.y, this.width, this.height);
            }
            this.tooltip.render(stack, mouseX, mouseY, partialTicks);
        }
    }

    onPress() {
        if (this.enabled) {
            // Play click sound
            if (this.minecraft && this.minecraft.soundManager) {
                this.minecraft.soundManager.playGuiClick();
            }
            this.callback();
        }
    }

    onTick() {

    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        this.onPress();
    }

    mouseReleased(mouseX, mouseY, mouseButton) {

    }

    mouseDragged(mouseX, mouseY, mouseButton) {

    }

    keyTyped(key, character) {

    }

    keyReleased(key) {

    }

    isMouseOver(mouseX, mouseY) {
        return mouseX > this.x && mouseX < this.x + this.width && mouseY > this.y && mouseY < this.y + this.height;
    }

    drawButton(stack, enabled, mouseOver, x, y, width, height) {
        let textureGui = this.getTexture("gui/gui.png");
        let spriteY = 66 + (enabled ? (mouseOver ? 20 : 0) : -20);

        this.drawSprite(stack, textureGui, 0, spriteY, width / 2, 20, x, y, width / 2, height);
        this.drawSprite(stack, textureGui, 200 - width / 2, spriteY, width / 2, 20, x + width / 2, y, width / 2, height);
    }

    setTooltip(string) {
        this.tooltipString = string;
        this.tooltip = null;
        return this;
    }

    isSelectable() {
        return this.enabled;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        return this;
    }

}