import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiPlayerPreview from "../widgets/GuiPlayerPreview.js";
import GuiWorldSlotContainer from "../widgets/GuiWorldSlotContainer.js";

const SLOT_HEIGHT = 36;
const SLOT_SPACING = 2;

/**
 * One row in the cape sidebar: a thumbnail of the cape artwork (top-left
 * 10x16 region of a 64x32 sheet) and its name, laid out like the Mods rows.
 */
class GuiCapeSlot extends GuiButton {

    constructor(cape, x, y, width, height, callback, minecraft) {
        super(minecraft, cape.name, x, y, width, height, callback);

        this.cape = cape;
        this.drawButton = () => {};

        this.image = null;
        if (cape.texture) {
            const image = new Image();
            image.onerror = () => {
                if (this.image === image) this.image = null;
            };
            image.src = cape.texture;
            this.image = image;
        }
    }

    render(stack, mouseX, mouseY, partialTicks) {
        const thumbX = this.x + 3;
        const thumbY = this.y + 3;
        const thumbWidth = 18;
        const thumbHeight = 28;

        if (this.image && this.image.complete && this.image.naturalWidth > 0) {
            stack.save();
            stack.imageSmoothingEnabled = false;
            stack.drawImage(this.image, 0, 0, 10, 16, thumbX, thumbY, thumbWidth, thumbHeight);
            stack.restore();
        } else {
            this.drawRect(stack, thumbX, thumbY, thumbX + thumbWidth, thumbY + thumbHeight, "rgba(255, 255, 255, 0.06)");
            const label = this.cape.kind === "none" ? "×" : this.cape.kind === "default" ? "D" : "?";
            this.drawCenteredString(stack, label, thumbX + thumbWidth / 2, thumbY + thumbHeight / 2 - 4, 0xFF777777);
        }

        const textX = thumbX + thumbWidth + 6;
        const textWidth = Math.max(20, this.x + this.width - 6 - textX);

        this.drawString(stack, this.trimToWidth(stack, this.cape.name, textWidth), textX, this.y + 5, 0xFFFFFFFF, true, false);

        const subtitle = this.cape.kind === "default"
            ? "Server default"
            : this.cape.kind === "none"
                ? "No cape"
                : "Assigned cape";
        this.drawString(stack, this.trimToWidth(stack, subtitle, textWidth), textX, this.y + 17, 0xFF9A9A9A, true, false);
    }

    trimToWidth(stack, text, maxWidth) {
        const value = String(text ?? '');
        if (this.getStringWidth(stack, value, true) <= maxWidth) return value;

        let result = value;
        while (result.length > 1 && this.getStringWidth(stack, result + '\u2026', true) > maxWidth) {
            result = result.slice(0, -1);
        }
        return result + '\u2026';
    }

}

class GuiCapeSlotContainer extends GuiWorldSlotContainer {

    constructor(parentGui) {
        super(parentGui, []);

        this.slotHeight = SLOT_HEIGHT;
        this.slotSpacing = SLOT_SPACING;
        this.slotX = parentGui.layout.sidebarX + 4;
        this.slotWidth = parentGui.layout.sidebarWidth - 16;
        this.top = parentGui.layout.top;
        this.bottom = parentGui.layout.bottom;
        this.viewLeft = parentGui.layout.sidebarX;
        this.viewRight = parentGui.layout.sidebarX + parentGui.layout.sidebarWidth;
        this.scrollBarX = parentGui.layout.sidebarX + parentGui.layout.sidebarWidth - 8;
        this.scrollStep = (SLOT_HEIGHT + SLOT_SPACING) / 6;
        this.drawBackgroundTexture = false;
        this.alwaysShowScrollBar = true;

        this.slotList = parentGui.entries.map((cape, index) =>
            new GuiCapeSlot(
                cape,
                this.slotX,
                0,
                this.slotWidth,
                SLOT_HEIGHT,
                () => this.setSelected(index),
                parentGui.minecraft
            )
        );
    }

}

export default class GuiCapesScreen extends GuiScreen {

    constructor(minecraft, parentScreen) {
        super();

        this.minecraft = minecraft;
        this.parentScreen = parentScreen;
        this.previousScreen = parentScreen;

        this.status = "Choose the cape you want to wear.";
        this.preview = null;
        this.capeSlotContainer = null;
        this.entries = [];
        this.selectedIndex = -1;
        this.loading = true;
        this.layout = null;
    }

    async init() {
        super.init();

        this.layout = this.calculateLayout();
        this.initPreview();

        const manager = this.minecraft.capeManager;
        const signedIn = Boolean(this.minecraft.settings.loggedIn);

        if (signedIn) {
            this.loading = true;
            await manager?.loadCatalog?.(true);

            // The screen was closed while the catalog was loading.
            if (this.minecraft.currentScreen && this.minecraft.currentScreen !== this) return;
        }

        this.entries = this.buildEntries(manager);
        this.loading = false;
        this.rebuildList();

        if (!signedIn) {
            this.status = "Sign in to choose a cape.";
        } else if (manager?.getCatalogError?.()) {
            this.status = manager.getCatalogError();
        } else if (this.entries.length <= 2) {
            this.status = "No capes have been assigned to you yet.";
        }

        this.buttonList.push(new GuiButton(
            this.minecraft,
            "Done",
            this.layout.paneX,
            this.height - 30,
            this.layout.paneRight - this.layout.paneX,
            20,
            () => this.minecraft.displayScreen(this.parentScreen)
        ));
    }

    initPreview() {
        if (this.preview) this.preview.dispose();

        this.preview = new GuiPlayerPreview(this.minecraft);
        this.preview.setBaseYaw(24);
        this.preview.init();
    }

    calculateLayout() {
        const top = 34;
        const bottom = this.height - 40;
        const sidebarX = 6;
        const sidebarWidth = Math.max(150, Math.min(260, Math.floor(this.width * 0.38)));
        const paneX = sidebarX + sidebarWidth + 8;

        return {
            top,
            bottom,
            sidebarX,
            sidebarWidth,
            paneX,
            paneRight: this.width - 6,
            paneBottom: bottom
        };
    }

    buildEntries(manager) {
        const entries = [
            { kind: "default", id: null, name: "Default cape", texture: null }
        ];

        for (const cape of manager?.getCatalog?.() || []) {
            entries.push({ kind: "cape", id: cape.id, name: cape.name, texture: cape.texture });
        }

        entries.push({ kind: "none", id: "", name: "No cape", texture: null });
        return entries;
    }

    rebuildList() {
        this.capeSlotContainer = new GuiCapeSlotContainer(this);
        this.markSelection();
    }

    markSelection() {
        const choice = this.minecraft.capeManager?.getChoice?.();

        this.selectedIndex = this.entries.findIndex((entry) => {
            if (entry.kind === "default") return choice === null;
            if (entry.kind === "none") return choice === "";
            return entry.id === choice;
        });

        if (!this.capeSlotContainer || this.selectedIndex < 0) return;

        this.capeSlotContainer.selectedWorld = this.selectedIndex;

        // Keep the worn cape visible when the list opens.
        const rowHeight = SLOT_HEIGHT + SLOT_SPACING;
        const viewHeight = this.capeSlotContainer.bottom - this.capeSlotContainer.top;
        const target = Math.max(0, this.selectedIndex * rowHeight + 7 - Math.floor(viewHeight / 2) + Math.floor(rowHeight / 2));

        this.capeSlotContainer.amountScrolled = Math.min(this.capeSlotContainer.getMaxScroll(), target);
    }

    /** Called by the slot container when a row is clicked. */
    setSelectedWorld(index) {
        const entry = this.entries[index];
        if (!entry) return;
        this.applyEntry(entry, index);
    }

    async applyEntry(entry, index) {
        const manager = this.minecraft.capeManager;
        if (!manager) return;

        const previousStatus = this.status;
        this.status = `Choosing ${entry.name}...`;

        try {
            if (entry.kind === "default") await manager.selectCape(null);
            else if (entry.kind === "none") await manager.selectCape("");
            else await manager.selectCape(entry.id);

            this.selectedIndex = index;
            if (this.capeSlotContainer) this.capeSlotContainer.selectedWorld = index;
            this.status = `Wearing ${entry.name}.`;
            this.preview?.reloadCape();
        } catch (error) {
            this.status = error?.message || "Could not save that cape.";
            if (!this.status) this.status = previousStatus;
            this.markSelection();
        }
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawCenteredString(stack, "Capes", this.width / 2, 14, 0xFFFFFFFF);

        if (this.loading) {
            this.drawCenteredString(stack, "Loading your capes...", this.width / 2, this.height / 2 - 4, 0xFFAAAAAA);
            super.drawScreen(stack, mouseX, mouseY, partialTicks);
            return;
        }

        if (this.capeSlotContainer) {
            this.capeSlotContainer.drawScreen(stack, mouseX, mouseY, partialTicks);
        }

        this.drawPane(stack, mouseX, mouseY, partialTicks);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    drawPane(stack, mouseX, mouseY, partialTicks) {
        const { paneX, paneRight, top, paneBottom } = this.layout;
        const centerX = Math.floor((paneX + paneRight) / 2);

        this.drawRect(stack, paneX, top, paneRight, paneBottom, "rgba(0, 0, 0, 0.5)");
        this.drawCenteredString(stack, this.status, centerX, top + 6, 0xFFB0B0B0);

        const availableWidth = paneRight - paneX - 16;
        const availableHeight = paneBottom - top - 34;
        const scale = Math.max(1, Math.min(3,
            Math.floor(availableWidth / GuiPlayerPreview.WIDTH),
            Math.floor(availableHeight / GuiPlayerPreview.HEIGHT)));
        const width = GuiPlayerPreview.WIDTH * scale;
        const height = GuiPlayerPreview.HEIGHT * scale;
        const x = paneX + Math.floor((paneRight - paneX - width) / 2);
        const y = top + 20 + Math.max(0, Math.floor((availableHeight - height) / 2));

        if (!this.preview || !this.preview.modelReady) {
            this.drawCenteredString(stack, "Preview unavailable", centerX, y + 40, 0xFF888888);
            return;
        }

        this.preview.draw(stack, x, y, mouseX, mouseY, partialTicks, scale);

        const entry = this.entries[this.selectedIndex];
        if (entry) {
            this.drawCenteredString(stack, entry.name, centerX, paneBottom - 20, 0xFFFFFFFF);
        }
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.capeSlotContainer) {
            this.capeSlotContainer.mouseClicked(mouseX, mouseY, mouseButton);
        }
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    mouseScrolled(mouseX, mouseY, delta) {
        if (this.capeSlotContainer) {
            this.capeSlotContainer.mouseScrolled(mouseX, mouseY, delta);
        }
    }

    onScroll(mouseX, mouseY, amount) {
        if (this.capeSlotContainer) {
            this.capeSlotContainer.mouseScrolled(mouseX, mouseY, amount);
        }
    }

    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.capeSlotContainer) {
            this.capeSlotContainer.mouseDragged(mouseX, mouseY, mouseButton);
        }
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        if (this.capeSlotContainer) {
            this.capeSlotContainer.mouseReleased(mouseX, mouseY, mouseButton);
        }
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

    keyTyped(key, character) {
        if (key === "Escape") {
            this.minecraft.displayScreen(this.parentScreen);
            return true;
        }
        return super.keyTyped(key, character);
    }

    onClose() {
        if (this.preview) {
            this.preview.dispose();
            this.preview = null;
        }

        this.capeSlotContainer = null;
        this.entries = [];
    }

}
