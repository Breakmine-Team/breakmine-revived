import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiTextField from "../widgets/GuiTextField.js";
import GuiWorldSlotContainer from "../widgets/GuiWorldSlotContainer.js";
import GuiModBrowserSlot from "../widgets/GuiModBrowserSlot.js";
import GuiYesNo from "./GuiYesNo.js";

// The public mod catalogue (the modding site in ./wiki). Both /api/mods and
// the download URLs it hands out send CORS headers, so the game can read them
// from any origin, including the packaged Electron build.
const MODS_SITE = "https://mods.breakmine.com";
const SEARCH_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 60000;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 300;
const SLOT_HEIGHT = 36;
const PANE_BACKGROUND = "rgba(0, 0, 0, 0.45)";
const INFO_ICON_SIZE = 64;

const GREEN = 0x55FF55;
const RED = 0xFF5555;
const ORANGE = 0xFFAA00;
const GRAY = 0xAAAAAA;
const DIM = 0x888888;

/**
 * Browse Mods screen. Lists the mod site's catalogue in the same sidebar style
 * as the installed-mods screen, with a search bar across the top and a details
 * pane that can download and install the selected mod on the spot.
 */
export default class GuiModBrowser extends GuiScreen {

    constructor(minecraft, previousScreen) {
        super();
        this.minecraft = minecraft;
        this.previousScreen = previousScreen;
        this.mods = [];
        // Normalised mod name -> the installed mod's metadata, so a catalogue
        // entry can be mapped back to the ID uninstallMod() needs.
        this.installedMods = new Map();
        this.selectedIndex = -1;
        this.modListContainer = null;
        this.searchField = null;

        this.loading = false;
        this.loadError = "";
        this.statusMessage = "";
        this.statusColor = GRAY;
        this.installingModId = null;

        this._searchSerial = 0;
        this._downloadController = null;
    }

    // --- Selection ---------------------------------------------------------

    setSelectedWorld(index) {
        this.selectedIndex = index;
        // A message about the previously selected mod would be misleading.
        this.statusMessage = "";
        this.updateButtonStates();
    }

    getSelectedMod() {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.mods.length) {
            return null;
        }
        return this.mods[this.selectedIndex];
    }

    rebuildSlotList() {
        if (!this.modListContainer) return;
        this.modListContainer.slotList = this.mods.map((data, index) =>
            new GuiModBrowserSlot(
                data,
                this.modListContainer.slotX,
                0,
                this.modListContainer.slotWidth,
                SLOT_HEIGHT,
                () => {
                    this.modListContainer.setSelected(index);
                    this.setSelectedWorld(index);
                },
                this.minecraft
            )
        );
    }

    // --- Lifecycle ---------------------------------------------------------

    async init() {
        super.init();

        // --- Layout -------------------------------------------------------
        // Computed before the first await: drawScreen can run while the
        // catalogue is still loading, and an unset layout would feed NaN into
        // the fades below.
        this.top = 50;
        this.bottom = this.height - 8;
        this.paneBottom = this.height - 34;

        this.sidebarX = 6;
        this.sidebarWidth = Math.max(
            SIDEBAR_MIN_WIDTH,
            Math.min(SIDEBAR_MAX_WIDTH, Math.floor(this.width * 0.38))
        );
        this.paneX = this.sidebarX + this.sidebarWidth + 6;
        this.paneRight = this.width - 6;

        // --- Search bar ---------------------------------------------------
        const searchY = 24;
        const searchButtonWidth = 64;
        const searchWidth = Math.max(
            80,
            this.width - this.sidebarX * 2 - searchButtonWidth - 4
        );
        this.searchField = new GuiTextField(this.sidebarX, searchY, searchWidth, 20, false);
        this.searchField.maxLength = 64;
        this.buttonSearch = new GuiButton(
            this.minecraft,
            "Search",
            this.width - this.sidebarX - searchButtonWidth,
            searchY,
            searchButtonWidth,
            20,
            () => this.search()
        );

        // --- Installation buttons ----------------------------------------
        const paneWidth = Math.max(120, this.paneRight - this.paneX);
        const gap = 4;
        const buttonY = this.height - 28;
        const installWidth = Math.floor((paneWidth - gap) / 2);

        this.buttonInstall = new GuiButton(this.minecraft, "Install", this.paneX, buttonY, installWidth, 20, () => {
            this.onPrimaryAction();
        });
        this.buttonBack = new GuiButton(
            this.minecraft,
            "Back",
            this.paneX + installWidth + gap,
            buttonY,
            paneWidth - installWidth - gap,
            20,
            () => this.back()
        );

        this.buttonList.push(this.searchField);
        this.buttonList.push(this.buttonSearch);
        this.buttonList.push(this.buttonInstall);
        this.buttonList.push(this.buttonBack);

        // --- Catalogue list (sidebar) ------------------------------------
        this.modListContainer = new GuiWorldSlotContainer(this, []);
        this.modListContainer.viewLeft = this.sidebarX;
        this.modListContainer.viewRight = this.sidebarX + this.sidebarWidth;
        this.modListContainer.top = this.top;
        this.modListContainer.bottom = this.bottom;
        // 4px inset each side plus clearance for the scrollbar and its margin.
        this.modListContainer.slotX = this.sidebarX + 4;
        this.modListContainer.slotWidth = this.sidebarWidth - 16;
        this.modListContainer.scrollBarX = this.sidebarX + this.sidebarWidth - 8;
        this.modListContainer.scrollStep = SLOT_HEIGHT / 6;
        this.modListContainer.drawBackgroundTexture = false;
        this.modListContainer.alwaysShowScrollBar = true;

        this.selectedIndex = -1;
        this.rebuildSlotList();
        this.updateButtonStates();

        await this.refreshInstalledMods();
        this.applyInstalledFlags();
        this.rebuildSlotList();
        await this.loadMods("");
    }

    back() {
        this.minecraft.displayScreen(this.previousScreen);
    }

    onClose() {
        // Leaving the screen cancels an in-flight download instead of letting
        // it install a mod the user has navigated away from.
        if (this._downloadController) {
            this._downloadController.abort();
            this._downloadController = null;
        }
    }

    // --- Catalogue loading -------------------------------------------------

    normalizeName(name) {
        return String(name ?? '').trim().toLowerCase();
    }

    async refreshInstalledMods() {
        if (!this.minecraft.modLoader) return;
        try {
            const installed = await this.minecraft.modLoader.getInstalledMods();
            this.installedMods = new Map(installed.map((mod) => [this.normalizeName(mod.name), mod]));
        } catch (err) {
            console.warn('[Patchwork] Could not list installed mods:', err);
            this.installedMods = new Map();
        }
    }

    applyInstalledFlags() {
        for (const mod of this.mods) {
            const entry = this.installedMods.get(this.normalizeName(mod.name)) || null;
            mod.installed = !!entry;
            mod.installedId = entry ? entry.id : null;
            // Folder mods live in the physical mods/ directory, which the game
            // never writes to; they cannot be uninstalled from here.
            mod.installedDisk = !!entry?.disk;
        }
    }

    search() {
        if (this.searchField) {
            this.searchField.setFocused(false);
        }
        this.loadMods(this.searchField ? this.searchField.getText() : "");
    }

    async loadMods(query) {
        const serial = ++this._searchSerial;
        this.loading = true;
        this.loadError = "";
        this.statusMessage = "";

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

        try {
            const url = new URL("/api/mods", MODS_SITE);
            const trimmed = String(query || "").trim();
            if (trimmed) url.searchParams.set("q", trimmed);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: { "Accept": "application/json" }
            });
            if (!response.ok) {
                throw new Error(`The mod site returned HTTP ${response.status}.`);
            }

            const data = await response.json();
            if (serial !== this._searchSerial) return;

            const installed = this.installedMods;
            this.mods = (Array.isArray(data.mods) ? data.mods : []).map((mod) => {
                const entry = installed.get(this.normalizeName(mod.name)) || null;
                return {
                    ...mod,
                    installed: !!entry,
                    installedId: entry ? entry.id : null,
                    installedDisk: !!entry?.disk
                };
            });

            this.selectedIndex = -1;
            this.modListContainer.selectedWorld = -1;
            this.modListContainer.amountScrolled = 0;
            this.rebuildSlotList();
        } catch (err) {
            if (serial !== this._searchSerial) return;

            this.loadError = err.name === "AbortError"
                ? "The mod site took too long to respond."
                : `Could not reach the mod site. ${err.message}`;
            this.mods = [];
            this.selectedIndex = -1;
            this.modListContainer.selectedWorld = -1;
            this.rebuildSlotList();
        } finally {
            clearTimeout(timeout);
            if (serial === this._searchSerial) {
                this.loading = false;
                this.updateButtonStates();
            }
        }
    }

    // --- Installation ------------------------------------------------------

    downloadUrlFor(mod) {
        const raw = typeof mod.download_url === "string" ? mod.download_url : "";
        if (!raw) return null;
        try {
            const url = new URL(raw, MODS_SITE);
            if (url.protocol !== "http:" && url.protocol !== "https:") return null;
            // The site reports download URLs as http:// behind its proxy, but
            // the game is normally served over https, where fetching them as
            // http would be blocked as mixed content.
            if (url.protocol === "http:") url.protocol = "https:";
            return url;
        } catch {
            return null;
        }
    }

    async installSelectedMod() {
        const mod = this.getSelectedMod();
        if (!mod || this.installingModId !== null) return;
        if (!this.minecraft.modLoader) {
            this.statusMessage = "Mods are unavailable in this build.";
            this.statusColor = RED;
            return;
        }

        const url = this.downloadUrlFor(mod);
        if (!url) {
            this.statusMessage = "The mod site did not provide a download URL.";
            this.statusColor = RED;
            return;
        }

        this.installingModId = mod.id;
        this.updateButtonStates();
        this.statusMessage = `Installing ${mod.name}...`;
        this.statusColor = GRAY;

        const controller = new AbortController();
        this._downloadController = controller;
        const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`Download failed (HTTP ${response.status}).`);
            }

            const blob = await response.blob();
            if (blob.size === 0) {
                throw new Error("The downloaded archive is empty.");
            }

            const filename = `${String(mod.name || "mod").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64) || "mod"}.zip`;
            // JSZip accepts any Blob; File is only constructed for the nicer name.
            const archive = typeof File === "function"
                ? new File([blob], filename, { type: "application/zip" })
                : blob;

            await this.minecraft.modLoader.installModFromZip(archive);

            await this.refreshInstalledMods();
            this.applyInstalledFlags();
            this.rebuildSlotList();
            this.statusMessage = `Installed ${mod.name}.`;
            this.statusColor = GREEN;
        } catch (err) {
            if (err.name === "AbortError") {
                this.statusMessage = "Download cancelled.";
                this.statusColor = ORANGE;
            } else if (/already loaded|already installed|already exists/i.test(err.message || "")) {
                // The catalogue has no ID to match against, and the names did
                // not line up, so mark the row installed without an ID. It can
                // still be removed from the installed-mods screen.
                mod.installed = true;
                mod.installedId = null;
                mod.installedDisk = false;
                this.rebuildSlotList();
                this.statusMessage = `${mod.name} is already installed.`;
                this.statusColor = ORANGE;
            } else {
                this.statusMessage = `Install failed: ${err.message}`;
                this.statusColor = RED;
            }
        } finally {
            clearTimeout(timeout);
            if (this._downloadController === controller) {
                this._downloadController = null;
            }
            this.installingModId = null;
            this.updateButtonStates();
        }
    }

    onPrimaryAction() {
        const mod = this.getSelectedMod();
        if (!mod) return;

        if (mod.installed) {
            this.confirmUninstall(mod);
        } else {
            this.installSelectedMod();
        }
    }

    confirmUninstall(mod) {
        if (!this.minecraft.modLoader || !mod.installedId) return;

        this.minecraft.displayScreen(new GuiYesNo(
            this,
            `Uninstall mod "${mod.name}"?`,
            "This action cannot be undone!",
            "Uninstall",
            "Cancel",
            async () => {
                try {
                    await this.minecraft.modLoader.uninstallMod(mod.installedId);
                } catch (err) {
                    this.statusMessage = `Uninstall failed: ${err.message}`;
                    this.statusColor = RED;
                    return;
                }

                // The confirmation screen re-opens this one, so refresh its
                // installed map once the files are actually gone.
                await this.refreshInstalledMods();
                this.applyInstalledFlags();
                this.rebuildSlotList();
                this.updateButtonStates();
            }
        ));
    }

    updateButtonStates() {
        if (!this.buttonInstall) return;

        const mod = this.getSelectedMod();
        if (!mod) {
            this.buttonInstall.enabled = false;
            this.buttonInstall.string = "Install";
            return;
        }

        if (mod.installed) {
            if (mod.installedDisk) {
                this.buttonInstall.enabled = false;
                this.buttonInstall.string = "In mods/";
            } else if (!mod.installedId) {
                this.buttonInstall.enabled = false;
                this.buttonInstall.string = "Installed";
            } else {
                this.buttonInstall.enabled = this.installingModId === null;
                this.buttonInstall.string = "Uninstall";
            }
            return;
        }

        this.buttonInstall.enabled = this.installingModId === null;
        this.buttonInstall.string = this.installingModId !== null ? "Installing..." : "Install";
    }

    // --- Rendering ---------------------------------------------------------

    drawInfoPane(stack) {
        const left = this.paneX;
        const right = this.paneRight;
        const top = this.top;
        const bottom = this.paneBottom;

        this.drawRect(stack, left, top, right, bottom, PANE_BACKGROUND);

        stack.save();
        stack.beginPath();
        stack.rect(left, top, right - left, bottom - top);
        stack.clip();

        const mod = this.getSelectedMod();
        if (mod) {
            this.drawSelectedModInfo(stack, mod);
        } else {
            this.drawEmptyInfoPane(stack);
        }

        this.drawEdgeFades(stack, left, right, top, bottom);
        stack.restore();
    }

    drawEmptyInfoPane(stack) {
        const left = this.paneX;
        const right = this.paneRight;
        const centerX = (left + right) / 2;
        const centerY = (this.top + this.paneBottom) / 2 - 4;

        if (this.loading) {
            this.drawCenteredString(stack, "Loading mods...", centerX, centerY, GRAY, false);
        } else if (this.loadError) {
            const lines = this.wrapText(stack, this.loadError, right - left - 12);
            let y = centerY - (lines.length - 1) * 5;
            for (const line of lines) {
                this.drawCenteredString(stack, line, centerX, y, RED, false);
                y += 10;
            }
        } else if (this.mods.length === 0) {
            this.drawCenteredString(stack, "No mods found.", centerX, centerY, GRAY, false);
        } else {
            this.drawCenteredString(stack, "Select a mod to see its details.", centerX, centerY, GRAY, false);
        }
    }

    drawSelectedModInfo(stack, mod) {
        const left = this.paneX;
        const right = this.paneRight;
        const bottom = this.paneBottom;

        const iconX = left + 5;
        const iconY = this.top + 5;
        this.drawModIcon(stack, iconX, iconY, INFO_ICON_SIZE);

        const textX = iconX + INFO_ICON_SIZE + 5;
        const textWidth = Math.max(40, right - 5 - textX);

        this.drawString(stack, this.trimToWidth(stack, mod.name, textWidth), textX, iconY + 3, 0xFFFFFF, true, false);
        this.drawString(stack, this.trimToWidth(stack, `by ${mod.author}`, textWidth), textX, iconY + 15, GRAY, true, false);
        this.drawString(stack, this.trimToWidth(stack, `Version: ${mod.version}`, textWidth), textX, iconY + 27, GRAY, true, false);
        this.drawString(stack, this.trimToWidth(stack, `Category: ${mod.category || 'mod'}`, textWidth), textX, iconY + 41, DIM, true, false);
        this.drawString(
            stack,
            this.trimToWidth(stack, `Downloads: ${mod.downloads ?? 0} - ${mod.file_size_formatted || ''}`, textWidth),
            textX,
            iconY + 53,
            DIM,
            true,
            false
        );

        let y = iconY + INFO_ICON_SIZE + 5;
        this.drawRect(stack, left + 5, y, right - 5, y + 1, "rgba(255, 255, 255, 0.15)");
        y += 6;

        const bodyX = left + 5;
        const bodyWidth = Math.max(40, right - 5 - bodyX);
        const textBottom = bottom - (this.statusMessage ? 24 : 8);

        if (mod.min_patchwork) {
            this.drawString(stack, this.trimToWidth(stack, `Requires Patchwork ${mod.min_patchwork}+`, bodyWidth), bodyX, y, ORANGE, true, false);
            y += 11;
        }

        const description = String(mod.description || '').trim();
        const lines = description
            ? this.wrapText(stack, description, bodyWidth)
            : ["No description provided."];

        for (const line of lines) {
            if (y + 8 > textBottom) break;
            this.drawString(stack, line, bodyX, y, description ? 0xDDDDDD : 0x808080, true, false);
            y += 10;
        }

        if (this.statusMessage) {
            const status = this.trimToWidth(stack, this.statusMessage, right - left - 10);
            this.drawCenteredString(stack, status, (left + right) / 2, bottom - 14, this.statusColor, false);
        }
    }

    drawModIcon(stack, x, y, size) {
        // The catalogue does not serve icons, so use the same placeholder the
        // installed-mods screen falls back to.
        const placeholder = this.getTexture("gui/placeholder_mod.png");
        if (placeholder) {
            this.drawSprite(stack, placeholder, 0, 0, placeholder.width, placeholder.height, x, y, size, size);
            return;
        }

        this.drawRect(stack, x, y, x + size, y + size, "rgba(0, 0, 0, 0.45)");
        this.drawRect(stack, x + 1, y + 1, x + size - 1, y + size - 1, "rgba(255, 255, 255, 0.08)");
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);

        if (this.mods.length === 0) {
            this.drawRect(stack, this.sidebarX, this.top, this.sidebarX + this.sidebarWidth, this.bottom, PANE_BACKGROUND);
        } else if (this.modListContainer) {
            this.modListContainer.drawScreen(stack, mouseX, mouseY, partialTicks);
        }

        this.drawInfoPane(stack);

        this.drawCenteredString(stack, "Browse Mods", this.width / 2, 12);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);

        // Placeholder for the empty search box, drawn after the field so its
        // background does not cover it.
        if (this.searchField && this.searchField.getText().length === 0 && !this.searchField.isFocused) {
            this.drawString(
                stack,
                "Search mods...",
                this.searchField.x + 3,
                this.searchField.y + this.searchField.height / 2 - 4,
                0x707070,
                true,
                false
            );
        }
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
        if (this.modListContainer) {
            this.modListContainer.mouseClicked(mouseX, mouseY, mouseButton);
        }
        super.mouseClicked(mouseX, mouseY, mouseButton);

        // GuiTextField only holds focus while the cursor is over it, which
        // makes typing a query awkward. Keep focus until the next click.
        if (this.searchField) {
            const field = this.searchField;
            const inside = mouseX >= field.x - 1 && mouseX <= field.x + field.width + 1
                && mouseY >= field.y - 1 && mouseY <= field.y + field.height + 1;
            field.setFocused(inside);
        }
    }

    mouseScrolled(mouseX, mouseY, delta) {
        if (this.modListContainer) {
            this.modListContainer.mouseScrolled(mouseX, mouseY, delta);
        }
    }

    // Forward drag/release so the scrollbar thumb can be dragged.
    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.modListContainer) {
            this.modListContainer.mouseDragged(mouseX, mouseY, mouseButton);
        }
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        if (this.modListContainer) {
            this.modListContainer.mouseReleased(mouseX, mouseY, mouseButton);
        }
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

    onScroll(mouseX, mouseY, amount) {
        if (this.modListContainer) {
            this.modListContainer.mouseScrolled(mouseX, mouseY, amount);
        }
    }

    keyTyped(key, character) {
        if (key === "Escape") {
            this.back();
            return true;
        }
        if (key === "Enter" && this.searchField && this.searchField.isFocused) {
            this.search();
            return true;
        }
        return super.keyTyped(key, character);
    }
}
