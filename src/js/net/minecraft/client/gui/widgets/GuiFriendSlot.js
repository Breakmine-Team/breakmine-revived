import GuiButton from "./GuiButton.js";
import * as AuthLib from "../../network/AuthLib.js";

const headCache = new Map();

function loadHeadImage(username) {
    if (!username) return null;

    let entry = headCache.get(username);
    if (entry === undefined) {
        entry = { image: null };
        headCache.set(username, entry);

        try {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                entry.image = image;
            };
            image.onerror = () => {
                entry.image = null;
            };
            image.src = `${AuthLib.getSkinUrl(username)}?t=${Date.now()}`;
        } catch (error) {
            entry.image = null;
        }
    }

    return entry.image;
}

export default class GuiFriendSlot extends GuiButton {

    static ICON_SIZE = 34;

    constructor(friend, x, y, width, height, callback, minecraft) {
        super(minecraft, friend.username, x, y, width, height, callback);

        this.friend = friend;
        this.username = friend.username;
        this.addedAt = friend.addedAt;

        this.drawButton = () => {};
        this.renderE = true;
    }

    isInWorld() {
        const manager = this.minecraft && this.minecraft.friendsManager;
        return !!(manager && typeof manager.isInCurrentWorld === "function" && manager.isInCurrentWorld(this.username));
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) return;

        const iconSize = GuiFriendSlot.ICON_SIZE;
        const slotX = this.x;
        const slotY = this.y;
        const slotW = this.width;

        const textX = slotX + iconSize + 4;
        const textWidth = Math.max(20, slotX + slotW - 2 - textX);

        this.drawHead(stack, slotX + 1, slotY - 1, iconSize);

        this.drawString(stack, this.trimToWidth(stack, this.username, textWidth), textX, slotY + 1, 0xFFFFFF, true, false);

        const since = this.addedAt > 0 ? new Date(this.addedAt).toLocaleDateString() : "";
        const subtitle = since ? `Friend since ${since}` : "Friend";
        this.drawString(stack, this.trimToWidth(stack, subtitle, textWidth), textX, slotY + 12, 0xAAAAAA, true, false);

        if (this.isInWorld()) {
            const status = "In world";
            const statusX = slotX + slotW - 2 - this.getStringWidth(stack, status);

            if (statusX > textX + 8) {
                this.drawString(stack, status, statusX, slotY + 22, 0x55FF55, true, false);
            }
        }
    }

    drawHead(stack, x, y, size) {
        const skin = loadHeadImage(this.username);
        const fallback = this.minecraft ? this.minecraft.resources["char.png"] : null;
        const image = skin && skin.complete && skin.naturalWidth > 0 && skin.naturalHeight > 0
            ? skin
            : fallback;

        const drawable = image && image.complete && image.naturalWidth >= 16 && image.naturalHeight >= 16;

        stack.save();
        stack.beginPath();
        stack.rect(x, y, size, size);
        stack.clip();

        if (drawable) {
            const headSize = 8 * Math.max(1, Math.floor((image.naturalWidth || 0) / 64));
            stack.imageSmoothingEnabled = headSize > 8;
            stack.imageSmoothingQuality = "high";
            stack.drawImage(image, headSize, headSize, headSize, headSize, x, y, size, size);
        } else {
            stack.fillStyle = "rgb(0, 0, 0)";
            stack.fillRect(x, y, size, size);
        }

        stack.restore();

        if (!drawable) {
            this.drawCenteredString(stack, "?", x + size / 2, y + size / 2 - 4, 0xAAAAAA, false);
        }
    }

    trimToWidth(stack, text, maxWidth) {
        const value = String(text ?? "");
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
