import GuiButton from "./GuiButton.js";
import GuiTooltip from "./GuiTooltip.js";

export default class GuiStringButton extends GuiButton {

    constructor(name, value, x, y, width, height, callback) {
        super(name, x, y, width, height, _ => callback(this.value));

        this.settingName = name;
        this.value = String(value === undefined || value === null ? "" : value);

        this.editing = false;
        this.cursorCounter = 0;
        this.cursorPosition = this.value.length;
        this.maxLength = 80;

        this.string = this.getDisplayName();
    }

    isSelectable() {
        return true;
    }

    getDisplayName() {
        return this.settingName + ": " + this.value;
    }

    onTick() {
        if (this.editing) {
            this.cursorCounter++;
        }
    }

    render(stack, mouseX, mouseY, partialTicks) {
        const mouseOver = this.isMouseOver(mouseX, mouseY) || this.focused;
        const isTv = this.minecraft && this.minecraft.settings && this.minecraft.settings.tvmode;

        this.drawButton(stack, this.enabled, mouseOver, this.x, this.y, this.width, this.height);

        let colorPrefix = "";
        if (isTv && this.focused) {
            colorPrefix = this.editing ? "§a" : "§e";
        } else if (mouseOver) {
            colorPrefix = "§e";
        }
        if (!this.enabled) {
            colorPrefix = "§7";
        }

        let label;
        if (this.editing) {
            const cursorVisible = Math.floor(this.cursorCounter / 6) % 2 === 0;
            const before = this.value.substring(0, this.cursorPosition);
            const after = this.value.substring(this.cursorPosition);
            const cursor = cursorVisible ? "_" : " ";
            label = colorPrefix + this.settingName + ": " + before + cursor + after;
        } else {
            label = colorPrefix + this.string;
        }

        this.drawCenteredString(stack, label, this.x + this.width / 2, this.y + this.height / 2 - 4, 0xFFFFFFFF, false);

        if (this.tooltipString && this.minecraft && mouseOver) {
            if (!this.tooltip) {
                this.tooltip = new GuiTooltip(this.minecraft, this.tooltipString, this.x, this.y, this.width, this.height);
            }
            this.tooltip.render(stack, mouseX, mouseY, partialTicks);
        }
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.isMouseOver(mouseX, mouseY)) {
            this.startEditing();
            if (this.minecraft && this.minecraft.soundManager) {
                this.minecraft.soundManager.playGuiClick();
            }
        } else if (this.editing) {
            this.confirmEdit();
        }
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
    }

    startEditing() {
        if (!this.editing) {
            this.editing = true;
            this.cursorPosition = this.value.length;
            this.cursorCounter = 0;
        }
    }

    confirmEdit() {
        if (!this.editing) return;
        this.editing = false;
        this.string = this.getDisplayName();
        if (this.minecraft && this.minecraft.soundManager) {
            this.minecraft.soundManager.playGuiClick();
        }
        this.callback();
    }

    cancelEdit() {
        if (!this.editing) return;
        this.editing = false;
        this.string = this.getDisplayName();
    }

    keyTyped(key, character) {
        if (!this.editing && !this.focused) return;

        if (key === "Enter") {
            if (!this.editing) {
                this.startEditing();
            } else {
                this.confirmEdit();
            }
            return;
        }

        if (key === "Escape") {
            if (this.editing) {
                this.cancelEdit();
            }
            return;
        }

        if (!this.editing) return;

        if (key === "ArrowLeft") {
            if (this.cursorPosition > 0) {
                this.cursorPosition--;
                this.cursorCounter = 0;
            }
            return;
        }

        if (key === "ArrowRight") {
            if (this.cursorPosition < this.value.length) {
                this.cursorPosition++;
                this.cursorCounter = 0;
            }
            return;
        }

        if (key === "Backspace") {
            if (this.value.length > 0 && this.cursorPosition > 0) {
                this.value = this.value.substring(0, this.cursorPosition - 1) +
                             this.value.substring(this.cursorPosition);
                this.cursorPosition--;
                this.cursorCounter = 0;
            }
            return;
        }

        if (character && character.length === 1 && this.value.length < this.maxLength) {
            this.value = this.value.substring(0, this.cursorPosition) +
                         character +
                         this.value.substring(this.cursorPosition);
            this.cursorPosition++;
            this.cursorCounter = 0;
        }
    }

    keyReleased(key) {
    }

    setValue(newValue) {
        this.value = String(newValue === undefined || newValue === null ? "" : newValue);
        this.cursorPosition = Math.min(this.cursorPosition, this.value.length);
        this.string = this.getDisplayName();
        return this;
    }

    getValue() {
        return this.value;
    }
}
