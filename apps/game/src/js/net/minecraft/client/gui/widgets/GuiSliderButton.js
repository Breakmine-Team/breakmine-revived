import GuiButton from "./GuiButton.js";
import MathHelper from "../../../util/MathHelper.js";

export default class GuiSliderButton extends GuiButton {

    constructor(name, value, min, max, x, y, width, height, callback) {
        super(name, x, y, width, height, _ => callback(this.value));

        this.settingName = name;
        this.value = value;

        this.min = min;
        this.max = max;

        this.enabled = false;
        this.dragging = false;

        this.setDisplayNameBuilder((name, value) => {
            return name + ": " + value;
        })
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.isMouseOver(mouseX, mouseY)) {
            this.dragging = true;
            return true;
        }
    }

    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.dragging) {
            let percent = (this.value - this.min) / (this.max - this.min);
            let offset = -4 + 8 * percent;
            this.value = Math.round(this.min + (mouseX + offset - this.x) / this.width * (this.max - this.min));
            this.value = MathHelper.clamp(this.value, this.min, this.max);

            this.string = this.getDisplayName(this.settingName, this.value);
            this.callback();
        }
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        this.dragging = false;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        let mouseOver = this.isMouseOver(mouseX, mouseY);
        let percent = (this.value - this.min) / (this.max - this.min);
        let offset = Math.round(percent * (this.width - 8));

        this.drawButton(stack, this.enabled, mouseOver || this.focused, this.x, this.y, this.width, this.height);
        this.drawButton(stack, true, false, this.x + offset, this.y, 8, this.height);

        if (this.focused && this.minecraft && this.minecraft.settings.tvmode) {
            this.drawOutlineRect(stack, this.x - 1, this.y - 1, this.x + this.width + 1, this.y + this.height + 1, 'white', 1);
        }

        let label = this.focused && this.minecraft && this.minecraft.settings.tvmode
            ? (this.editing ? "§a" : "§e") + this.string
            : this.string;
        this.drawCenteredString(stack, label, this.x + this.width / 2, this.y + this.height / 2 - 4);
    }

    keyTyped(key, character) {
        if (!this.focused || !this.minecraft || !this.minecraft.settings.tvmode) return;

        if (key === "Enter") {
            this.editing = !this.editing;
            this.string = this.getDisplayName(this.settingName, this.value);
            return;
        }

        if (this.editing && (key === "ArrowLeft" || key === "ArrowRight")) {
            let step = (key === "ArrowLeft") ? -1 : 1;
            this.value = MathHelper.clamp(this.value + step, this.min, this.max);
            this.string = this.getDisplayName(this.settingName, this.value);
            this.callback();
        }
    }

    isSelectable() {
        return true;
    }

    setDisplayNameBuilder(builder) {
        this.getDisplayName = builder;
        this.string = this.getDisplayName(this.settingName, this.value);
        return this;
    }
}