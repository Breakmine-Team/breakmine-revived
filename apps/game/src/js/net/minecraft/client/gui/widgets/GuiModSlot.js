import GuiButton from "./GuiButton.js";

export default class GuiModSlot extends GuiButton {

    constructor(modData, x, y, width, height, callback, minecraft) {
        super(minecraft, modData.name, x, y, width, height, callback);

        this.modData = modData;
        this.modName = modData.name;
        this.modId = modData.id;
        this.modVersion = modData.version;
        this.modAuthor = modData.author;

        this.drawButton = () => {};
        this.renderE = true;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) return;

        // Default to true if undefined or null on initial boot, handle string "true"/"false"
        let isEnabled = true;
        if (this.modData.enabled !== undefined && this.modData.enabled !== null) {
            isEnabled = this.modData.enabled === true || this.modData.enabled === "true";
        } else if (this.modData.disabled !== undefined) {
            isEnabled = !this.modData.disabled;
        }

        const slotX = this.x;
        const slotY = this.y;
        const slotW = this.width;

        const WHITE = 16777215;
        const GRAY = 8421504;
        const DARK_GRAY = 5592405;

        const nameColor = isEnabled ? WHITE : DARK_GRAY;
        this.drawString(stack, this.modName, slotX + 2, slotY + 1, nameColor, true, false);

        this.drawString(stack, `${this.modId} v${this.modVersion}`, slotX + 2, slotY + 12, GRAY, true, false);

        const authorStr = `by ${this.modAuthor}`;
        this.drawString(stack, authorStr, slotX + slotW - 2 - this.getStringWidth(stack, authorStr), slotY + 1, GRAY, true, false);

        const statusStr = isEnabled ? "[ON]" : "[OFF]";
        const statusColor = isEnabled ? 5635925 : 16733525;
        this.drawString(stack, statusStr, slotX + slotW - 2 - this.getStringWidth(stack, statusStr), slotY + 12, statusColor, true, false);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.isMouseOver(mouseX, mouseY)) {
            this.callback();
        }
    }
}