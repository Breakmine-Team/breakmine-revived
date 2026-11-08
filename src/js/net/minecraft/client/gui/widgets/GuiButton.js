import Gui from "../Gui.js";
import GuiTooltip from "./GuiTooltip.js";

export default class GuiButton extends Gui {

    constructor(minecraftOrString, stringOrX, xOrY, yOrWidth, widthOrHeight, heightOrCallback, callback) {
        if (typeof minecraftOrString === 'string') {
            super(null);
            this.string = minecraftOrString;
            this.x = stringOrX;
            this.y = xOrY;
            this.width = yOrWidth;
            this.height = widthOrHeight;
            this.callback = heightOrCallback;
        } else {
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

        const leftWidth = Math.ceil(width / 2);
        const rightWidth = width - leftWidth;

        this.drawSprite(stack, textureGui, 0, spriteY, leftWidth, 20, x, y, leftWidth, height);
        this.drawSprite(stack, textureGui, 200 - rightWidth, spriteY, rightWidth, 20, x + leftWidth, y, rightWidth, height);
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