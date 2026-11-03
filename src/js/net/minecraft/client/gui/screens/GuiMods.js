import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiModSlotContainer from "../widgets/GuiModSlotContainer.js";
import GuiModSlot from "../widgets/GuiModSlot.js";
import GuiYesNo from "./GuiYesNo.js";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 300;
const SLOT_HEIGHT = 36;
const PANE_BACKGROUND = "rgba(0, 0, 0, 0.45)";
const INFO_ICON_SIZE = 64;

/**
 * Mods screen. Installed mods live in a scrollable sidebar on the left, drawn
 * like the singleplayer world list (icon + three text lines); the selected
 * mod's details, including a larger icon, fill the pane on the right.
 */
export default class GuiMods extends GuiScreen {

    constructor(minecraft, previousScreen) {
        super();
        this.minecraft = minecraft;
        this.previousScreen = previousScreen;
        this.mods = [];
        this.modSlotContainer = null;
        this.selectedIndex = -1;
        this.dirty = false;

        // data URL -> decoded image, so the info pane and the rows share one
        // decode per mod icon instead of starting a new load every frame.
        this.iconImages = new Map();
    }

    setSelectedWorld(index) {
        this.selectedIndex = index;
        this.updateButtonStates();
    }

    getSelectedMod() {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.mods.length) {
            return null;
        }
        return this.mods[this.selectedIndex];
    }

    rebuildSlotList() {
        if (!this.modSlotContainer) return;
        this.modSlotContainer.slotList = this.mods.map((data, index) =>
            new GuiModSlot(
                data, this.modSlotContainer.slotX, 0, this.modSlotContainer.slotWidth, SLOT_HEIGHT,
                () => {
                    this.modSlotContainer.setSelected(index);
                    this.setSelectedWorld(index); // Sync selectedIndex in GuiMods
                },
                this.minecraft
            )
        );
    }

    async init() {
        super.init();

        // --- Layout -------------------------------------------------------
        // Computed before the first await: drawScreen can run while the mod
        // list is still loading, and a layout that is still undefined fed NaN
        // into the fade gradients. The sidebar runs the full height of the
        // window; only the info pane stops short, because two rows of buttons
        // live underneath it.
        this.top = 34;
        this.bottom = this.height - 8;

        this.sidebarX = 6;
        this.sidebarWidth = Math.max(
            SIDEBAR_MIN_WIDTH,
            Math.min(SIDEBAR_MAX_WIDTH, Math.floor(this.width * 0.38))
        );
        this.paneX = this.sidebarX + this.sidebarWidth + 6;
        this.paneRight = this.width - 6;
        this.paneBottom = this.height - 58;

        await this.refreshModList();

        // Ensure mod.enabled defaults to true if missing from the modloader startup response
        this.mods.forEach(mod => {
            if (mod.enabled === undefined || mod.enabled === null) {
                mod.enabled = true;
            }
        });

        this.modSlotContainer = new GuiModSlotContainer(this, this.mods);
        // Use the list as a sidebar instead of a full-width list.
        this.modSlotContainer.viewLeft = this.sidebarX;
        this.modSlotContainer.viewRight = this.sidebarX + this.sidebarWidth;
        this.modSlotContainer.top = this.top;
        this.modSlotContainer.bottom = this.bottom;
        // 4px inset left and right, plus clearance for the 6px scrollbar and
        // its 2px margin, so rows never run underneath it.
        this.modSlotContainer.slotX = this.sidebarX + 4;
        this.modSlotContainer.slotWidth = this.sidebarWidth - 16;
        this.modSlotContainer.scrollBarX = this.sidebarX + this.sidebarWidth - 8;
        this.modSlotContainer.scrollStep = SLOT_HEIGHT / 6;
        this.modSlotContainer.drawBackgroundTexture = false;
        // The sidebar always shows its scrollbar, even when every mod fits.
        this.modSlotContainer.alwaysShowScrollBar = true;

        this.selectedIndex = -1;
        this.rebuildSlotList();

        // Check if running in Electron
        const isElectron = typeof navigator === 'object' &&
            typeof navigator.userAgent === 'string' &&
            navigator.userAgent.indexOf('Electron') !== -1;

        const paneWidth = Math.max(120, this.paneRight - this.paneX);
        const gap = 4;
        const topY = this.height - 52;
        const bottomY = this.height - 28;

        // Split a row of `count` buttons evenly, giving the remainder to the
        // last one so the row always ends at paneRight.
        const rowWidths = (count) => {
            const each = Math.floor((paneWidth - gap * (count - 1)) / count);
            return Array.from({ length: count }, (_, i) =>
                i === count - 1 ? paneWidth - (each + gap) * (count - 1) : each
            );
        };
        const rowXs = (widths) => {
            const xs = [];
            let x = this.paneX;
            for (const width of widths) {
                xs.push(x);
                x += width + gap;
            }
            return xs;
        };

        // Top row: three buttons. Bottom row: two (three in the Electron build,
        // where Open Folder joins Delete and Cancel).
        const topWidths = rowWidths(3);
        const topXs = rowXs(topWidths);
        const bottomCount = isElectron ? 3 : 2;
        const bottomWidths = rowWidths(bottomCount);
        const bottomXs = rowXs(bottomWidths);

        this.buttonToggle = new GuiButton(this.minecraft, "Toggle", topXs[0], topY, topWidths[0], 20, async () => {
            const mod = this.getSelectedMod();
            if (!mod) return;
            const newState = !mod.enabled;
            await this.minecraft.modLoader.toggleMod(mod.id, newState);
            this.dirty = true;
            await this.refreshModList();
            this.rebuildSlotList();
            this.updateButtonStates();
        });

        this.buttonUpload = new GuiButton(this.minecraft, "Upload .zip", topXs[1], topY, topWidths[1], 20, () => {
            this.uploadMod();
        });

        this.buttonUploadFolder = new GuiButton(this.minecraft, "Upload folder", topXs[2], topY, topWidths[2], 20, () => {
            this.uploadModFolder();
        });

        this.buttonDelete = new GuiButton(this.minecraft, "Delete", bottomXs[0], bottomY, bottomWidths[0], 20, async () => {
            const mod = this.getSelectedMod();
            if (!mod) return;
            this.minecraft.displayScreen(new GuiYesNo(this, `Delete mod "${mod.name}" by ${mod.author}?`, "This action cannot be undone!", "Delete", "Cancel", async () => {
                try {
                    await this.minecraft.modLoader.uninstallMod(mod.id);
                } catch (err) {
                    alert('Failed to delete mod: ' + err.message);
                    return;
                }
                this.dirty = true;
                await this.refreshModList();
                this.rebuildSlotList();
                this.selectedIndex = -1;
                this.updateButtonStates();
            }));
        });

        if (isElectron) {
            this.buttonOpenFolder = new GuiButton(this.minecraft, "Open Folder", bottomXs[1], bottomY, bottomWidths[1], 20, () => {
                this.openModsFolder();
            });
        }

        this.buttonBack = new GuiButton(
            this.minecraft,
            "Cancel",
            bottomXs[bottomCount - 1],
            bottomY,
            bottomWidths[bottomCount - 1],
            20,
            () => {
                this.goBack();
            }
        );

        this.buttonList.push(this.buttonUploadFolder);
        this.buttonList.push(this.buttonUpload);
        this.buttonList.push(this.buttonToggle);
        this.buttonList.push(this.buttonDelete);
        this.buttonList.push(this.buttonBack);
        if (this.buttonOpenFolder) {
            this.buttonList.push(this.buttonOpenFolder);
        }

        this.updateButtonStates();
    }

    openModsFolder() {
        // Use the modsBridge to open the mods folder
        if (typeof window !== 'undefined' && window.modsBridge && typeof window.modsBridge.openFolder === 'function') {
            window.modsBridge.openFolder();
        } else {
            console.warn('[GuiMods] Cannot open mods folder: no bridge method available');
        }
    }

    goBack() {
        if (this.dirty) {
            window.location.reload();
        } else {
            this.minecraft.displayScreen(this.previousScreen);
        }
    }

    updateButtonStates() {
        const mod = this.getSelectedMod();
        const hasSelection = mod !== null;
        // Folder mods live in the physical mods/ directory, which the game
        // never writes to - deleting them is a filesystem action, not a UI one.
        const isDiskMod = !!mod?.disk;

        this.buttonToggle.enabled = hasSelection;
        this.buttonDelete.enabled = hasSelection && !isDiskMod;

        if (hasSelection) {
            this.buttonToggle.string = mod.enabled ? "Disable" : "Enable";
        } else {
            this.buttonToggle.string = "Toggle";
        }

        if (this.buttonDelete) {
            this.buttonDelete.string = isDiskMod ? "In mods/" : "Delete";
        }

        if (this.buttonBack) {
            this.buttonBack.string = this.dirty ? "Reload" : "Cancel";
        }
    }

    async refreshModList() {
        if (!this.minecraft.modLoader) return;
        // init() awaits this before it builds any buttons, so a rejection here
        // used to leave the whole screen blank with nothing on screen to
        // explain it. Report the failure and render an empty list instead: the
        // buttons are still useful (Delete/Toggle on a refresh, Upload for
        // recovery), and the console now carries the reason.
        try {
            this.mods = await this.minecraft.modLoader.getInstalledMods();
        } catch (err) {
            console.error('[Patchwork] Could not list installed mods:', err);
            this.mods = [];
        }
    }

    uploadModFolder() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.webkitdirectory = true;
        input.setAttribute('webkitdirectory', '');
        input.onchange = async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            try {
                await this.minecraft.modLoader.installModFromFolder(files);
                this.dirty = true;
                await this.refreshModList();
                this.rebuildSlotList();
                this.selectedIndex = this.mods.length - 1;
                this.updateButtonStates();
            } catch (err) {
                alert('Failed to install mod: ' + err.message);
            }
        };
        input.click();
    }

    uploadMod() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                await this.minecraft.modLoader.installModFromZip(file);
                this.dirty = true;
                await this.refreshModList();
                this.rebuildSlotList();
                this.selectedIndex = this.mods.length - 1;
                this.updateButtonStates();
            } catch (err) {
                alert('Failed to install mod: ' + err.message);
            }
        };
        input.click();
    }

    // --- Rendering ---------------------------------------------------------

    getIconImage(mod) {
        if (!mod.icon) return null;
        let image = this.iconImages.get(mod.icon);
        if (!image) {
            image = new Image();
            image.src = mod.icon;
            this.iconImages.set(mod.icon, image);
        }
        return image;
    }

    drawModIcon(stack, mod, x, y, size) {
        const image = this.getIconImage(mod);
        if (image !== null && image.complete && image.naturalWidth > 0) {
            stack.drawImage(image, x, y, size, size);
            return;
        }

        // No icon.png: the shared placeholder icon.
        const placeholder = this.getTexture("gui/placeholder_mod.png");
        if (placeholder) {
            this.drawSprite(stack, placeholder, 0, 0, placeholder.width, placeholder.height, x, y, size, size);
            return;
        }
    }

    drawInfoPane(stack, mouseX, mouseY, partialTicks) {
        const left = this.paneX;
        const right = this.paneRight;
        const top = this.top;
        const bottom = this.paneBottom;

        this.drawRect(stack, left, top, right, bottom, PANE_BACKGROUND);

        // Clip the details to the pane, like the sidebar list, and fade its
        // edges so content never ends on a hard line.
        stack.save();
        stack.beginPath();
        stack.rect(left, top, right - left, bottom - top);
        stack.clip();

        const mod = this.getSelectedMod();
        if (mod) {
            this.drawSelectedModInfo(stack, mod);
        } else {
            this.drawCenteredString(
                stack,
                this.mods.length === 0 ? "No mods installed." : "Select a mod to see its details.",
                (left + right) / 2,
                (top + bottom) / 2 - 4,
                0xAAAAAA
            );
        }

        this.drawEdgeFades(stack, left, right, top, bottom);

        stack.restore();
    }

    drawSelectedModInfo(stack, mod) {
        const left = this.paneX;
        const right = this.paneRight;
        const top = this.top;
        const bottom = this.paneBottom;

        const iconX = left + 5;
        const iconY = top + 5;
        this.drawModIcon(stack, mod, iconX, iconY, INFO_ICON_SIZE);

        const textX = iconX + INFO_ICON_SIZE + 5;
        const textWidth = Math.max(40, right - 5 - textX);

        this.drawString(stack, this.trimToWidth(stack, mod.name, textWidth), textX, iconY + 3, 0xFFFFFF, true, false);
        this.drawString(stack, this.trimToWidth(stack, `by ${mod.author}`, textWidth), textX, iconY + 15, 0xAAAAAA, true, false);
        this.drawString(stack, this.trimToWidth(stack, `Version: ${mod.version}`, textWidth), textX, iconY + 27 + 4, 0xAAAAAA, true, false);
        this.drawString(stack, this.trimToWidth(stack, `License: ${mod.license || 'Unspecified'}`, textWidth), textX, iconY + 39 + 4, 0x888888, true, false);
        this.drawString(stack, this.trimToWidth(stack, `§oID: ${mod.id || 'Unknown'}`, textWidth), textX - 1, iconY + 51 + 4, 0x666666, true, true);

        let y = iconY + INFO_ICON_SIZE + 5;
        this.drawRect(stack, left + 5, y, right - 5, y + 1, "rgba(255, 255, 255, 0.15)");
        y += 6;

        const bodyX = left + 5;
        const bodyWidth = right - 10;
        const textBottom = bottom - 34;

        const description = String(mod.description || '').trim();
        const lines = description
            ? this.wrapText(stack, description, bodyWidth)
            : ["No description provided."];

        for (const line of lines) {
            if (y + 8 > textBottom) break;
            this.drawString(stack, line, bodyX, y, description ? 0xDDDDDD : 0x808080, true, false);
            y += 10;
        }
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);

        if (this.mods.length === 0) {
            this.drawRect(stack, this.sidebarX, this.top, this.sidebarX + this.sidebarWidth, this.bottom, PANE_BACKGROUND);
        } else if (this.modSlotContainer) {
            this.modSlotContainer.drawScreen(stack, mouseX, mouseY, partialTicks);
        }

        this.drawInfoPane(stack, mouseX, mouseY, partialTicks);

        this.drawCenteredString(stack, "Mods", this.width / 2, 16);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    // --- Text helpers ------------------------------------------------------

    /** Greedy word wrap, measuring with § color codes preserved. */
    wrapText(stack, text, maxWidth) {
        const lines = [];

        for (const paragraph of String(text).split(/\r?\n/)) {
            const words = paragraph.split(/\s+/).filter(Boolean);
            if (words.length === 0) {
                lines.push("");
                continue;
            }

            let current = words[0];
            for (let i = 1; i < words.length; i++) {
                const candidate = current + " " + words[i];
                if (this.getStringWidth(stack, candidate, false) > maxWidth) {
                    lines.push(current);
                    current = words[i];
                } else {
                    current = candidate;
                }
            }
            lines.push(current);
        }

        return lines;
    }

    trimToWidth(stack, text, maxWidth) {
        const value = String(text ?? '');
        if (this.getStringWidth(stack, value, false) <= maxWidth) return value;

        let result = value;
        while (result.length > 1 && this.getStringWidth(stack, result + '\u2026', false) > maxWidth) {
            result = result.slice(0, -1);
        }
        return result + '\u2026';
    }

    // --- Input -------------------------------------------------------------

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseClicked(mouseX, mouseY, mouseButton);
        }
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    mouseScrolled(mouseX, mouseY, delta) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseScrolled(mouseX, mouseY, delta);
        }
    }

    // Forward drag/release so the scrollbar thumb can be dragged.
    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseDragged(mouseX, mouseY, mouseButton);
        }
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseReleased(mouseX, mouseY, mouseButton);
        }
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

    onScroll(mouseX, mouseY, amount) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseScrolled(mouseX, mouseY, amount);
        }
    }

    keyTyped(key, character) {
        if (key === "Escape") {
            this.goBack();
            return true;
        }
        return super.keyTyped(key, character);
    }

    onClose() {

    }
}
