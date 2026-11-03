import GuiButton from "./GuiButton.js";

/**
 * One row in the Mods sidebar. Laid out like GuiWorldSlot: a 34x34 icon on the
 * left and three lines of text beside it, so installed mods read the same way
 * singleplayer worlds do. The icon comes from `icon.png` in the mod root,
 * which ModLoader hands over as a data URL.
 */
export default class GuiModSlot extends GuiButton {

    static ICON_SIZE = 34;

    constructor(modData, x, y, width, height, callback, minecraft) {
        super(minecraft, modData.name, x, y, width, height, callback);

        this.modData = modData;
        this.modName = modData.name;
        this.modId = modData.id;
        this.modVersion = modData.version;
        this.modAuthor = modData.author;

        // Loads asynchronously; the row draws a placeholder until it is ready.
        this.iconImage = null;
        if (modData.icon) {
            const image = new Image();
            image.onerror = () => {
                if (this.iconImage === image) this.iconImage = null;
            };
            image.src = modData.icon;
            this.iconImage = image;
        }

        this.drawButton = () => {};
        this.renderE = true;
    }

    isEnabled() {
        // Default to true if undefined or null on initial boot, handle string "true"/"false"
        if (this.modData.enabled !== undefined && this.modData.enabled !== null) {
            return this.modData.enabled === true || this.modData.enabled === "true";
        }
        if (this.modData.disabled !== undefined) {
            return !this.modData.disabled;
        }
        return true;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) return;

        const isEnabled = this.isEnabled();

        const slotX = this.x;
        const slotY = this.y;
        const slotW = this.width;

        const WHITE = 16777215;
        const GRAY = 8421504;
        const DARK_GRAY = 5592405;

        const iconSize = GuiModSlot.ICON_SIZE;
        const textX = slotX + iconSize + 4;
        const textWidth = Math.max(20, slotX + slotW - 2 - textX);

        this.drawModIcon(stack, slotX + 1, slotY - 1, iconSize);

        const nameColor = isEnabled ? WHITE : DARK_GRAY;
        this.drawString(stack, this.trimToWidth(stack, this.modName, textWidth), textX, slotY + 1, nameColor, true, false);

        this.drawString(
            stack,
            this.trimToWidth(stack, `by ${this.modAuthor}`, textWidth),
            textX,
            slotY + 12,
            GRAY,
            true,
            false
        );

        const versionStr = `v${this.modVersion}`;
        this.drawString(stack, versionStr, textX, slotY + 22, GRAY, true, false);

        // Status is right-aligned when the sidebar is wide enough for it.
        const statusStr = isEnabled ? "Enabled" : "Disabled";
        const statusColor = isEnabled ? 5635925 : 16733525;
        const statusX = slotX + slotW - 2 - this.getStringWidth(stack, statusStr);
        if (statusX > textX + this.getStringWidth(stack, versionStr) + 4) {
            this.drawString(stack, statusStr, statusX, slotY + 22, statusColor, true, false);
        }
    }

    drawModIcon(stack, x, y, size) {
        if (this.iconImage !== null && this.iconImage.complete && this.iconImage.naturalWidth > 0) {
            stack.drawImage(this.iconImage, x, y, size, size);
            return;
        }

        // No icon.png: the shared placeholder icon.
        const placeholder = this.getTexture("gui/placeholder_mod.png");
        if (placeholder) {
            this.drawSprite(stack, placeholder, 0, 0, placeholder.width, placeholder.height, x, y, size, size);
            return;
        }

        // Placeholder texture missing: a dim tile with the mod's initial.
        this.drawRect(stack, x, y, x + size, y + size, "rgba(0, 0, 0, 0.45)");
        this.drawRect(stack, x + 1, y + 1, x + size - 1, y + size - 1, "rgba(255, 255, 255, 0.08)");

        const initial = String(this.modName || "?").trim().charAt(0).toUpperCase() || "?";
        this.drawCenteredString(stack, initial, x + size / 2, y + size / 2 - 4, 0xAAAAAA, false);
    }

    /** Cut text to fit `maxWidth`, ending in an ellipsis. */
    trimToWidth(stack, text, maxWidth) {
        const value = String(text ?? '');
        if (this.getStringWidth(stack, value, true) <= maxWidth) return value;

        let result = value;
        while (result.length > 1 && this.getStringWidth(stack, result + '\u2026', true) > maxWidth) {
            result = result.slice(0, -1);
        }
        return result + '\u2026';
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.isMouseOver(mouseX, mouseY)) {
            this.callback();
        }
    }
}
