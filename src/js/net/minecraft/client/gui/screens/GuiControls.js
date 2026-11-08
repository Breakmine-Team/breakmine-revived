import GuiScreen from "../GuiScreen.js";
import GuiKeyButton from "../widgets/GuiKeyButton.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiSliderButton from "../widgets/GuiSliderButton.js";
import GuiSwitchButton from "../widgets/GuiSwitchButton.js";
import GuiTooltip from "../widgets/GuiTooltip.js";
import GameSettings from "../../GameSettings.js";

// Grouped the way Minecraft's own Controls screen groups its key binds.
const KEY_BINDING_GROUPS = [
    {
        category: "Movement",
        bindings: [
            { name: "Forward", setting: "keyForward" },
            { name: "Left", setting: "keyLeft" },
            { name: "Back", setting: "keyBack" },
            { name: "Right", setting: "keyRight" },
            { name: "Jump", setting: "keyJump" },
            { name: "Sneak", setting: "keyCrouching" },
            { name: "Sprint", setting: "keySprinting" }
        ]
    },
    {
        category: "Gameplay",
        bindings: [
            { name: "Drop Item", setting: "keyDrop" },
            { name: "Toggle Perspective", setting: "keyTogglePerspective" },
            { name: "Toggle HUD", setting: "keyToggleGui" },
            { name: "Screenshot", setting: "keyScreenshot" },
            { name: "Debug Screen", setting: "keyDebug" }
        ]
    },
    {
        category: "Inventory",
        bindings: [
            { name: "Open Inventory", setting: "keyOpenInventory" },
            { name: "Hotbar Slot 1", setting: "keyHotbar1" },
            { name: "Hotbar Slot 2", setting: "keyHotbar2" },
            { name: "Hotbar Slot 3", setting: "keyHotbar3" },
            { name: "Hotbar Slot 4", setting: "keyHotbar4" },
            { name: "Hotbar Slot 5", setting: "keyHotbar5" },
            { name: "Hotbar Slot 6", setting: "keyHotbar6" },
            { name: "Hotbar Slot 7", setting: "keyHotbar7" },
            { name: "Hotbar Slot 8", setting: "keyHotbar8" },
            { name: "Hotbar Slot 9", setting: "keyHotbar9" }
        ]
    },
    {
        category: "Multiplayer",
        bindings: [
            { name: "Open Chat", setting: "keyOpenChat" },
            { name: "Open Command", setting: "keyOpenCommands" },
            { name: "Player List", setting: "keyPlayerList" },
            { name: "Voice Chat", setting: "keyVoiceChat" }
        ]
    }
];

const KEY_BUTTON_HINT = "§7Click to change\n§7Right-click: reset to default\n§7Backspace: clear";

const TV_MODE_HINT = `For playing Breakmine on Smart TVs
§7Arrow keys: move | Arrow Keys + Enter: Look
§7Back/return: pause / go back
§7Red: Break | Green: Place
§7Yellow: Open inventory | Blue: Cycle hotbar`;

export default class GuiControls extends GuiScreen {

    constructor(previousScreen) {
        super();

        this.previousScreen = previousScreen;
        this.pauseGame = true;

        this.rows = [];
        this.listButtons = [];

        this.amountScrolled = 0;
        this.isDragging = false;
        this.dragOffsetY = 0;

        this.scrollBarWidth = 6;
        this.scrollBarMinThumb = 12;
        this.scrollStep = 20;
    }

    init() {
        super.init();

        const settings = this.minecraft.settings;
        const defaults = new GameSettings();

        this.listWidth = Math.min(200, this.width - 20);
        this.listX = Math.floor((this.width - this.listWidth) / 2);
        this.keyButtonWidth = 84;
        this.rowHeight = 20;
        this.rowGap = 4;
        this.headerHeight = 12;

        this.top = 34;
        this.footerY = this.height - 28;
        this.bottom = this.footerY - 10;
        if (this.bottom < this.top + this.rowHeight) {
            this.bottom = Math.min(this.height - 20, this.top + this.rowHeight);
        }

        this.rows = [];
        this.listButtons = [];
        this.amountScrolled = 0;

        const rows = [];
        let y = 4;

        const addRow = (row) => {
            row.offset = y;
            rows.push(row);
            y += row.height + (row.gap !== undefined ? row.gap : this.rowGap);
        };

        // General controls stay at the top of the list.
        const sensitivity = new GuiSliderButton("Mouse Sensitivity", settings.getMouseSensitivity(), 50, 150, this.listX, 0, this.listWidth, this.rowHeight, value => {
            settings.sensitivity = value;
        });
        sensitivity.setDisplayNameBuilder((name, value) => name + ": " + value + "%");
        addRow({ kind: "setting", height: this.rowHeight, button: sensitivity });

        const tvMode = new GuiSwitchButton("TV Mode", settings.tvmode, this.listX, 0, this.listWidth, this.rowHeight, value => {
            settings.tvmode = value;
        });
        addRow({ kind: "setting", height: this.rowHeight, button: tvMode, tooltip: TV_MODE_HINT });

        // Key binds: click the key on the right to rebind it.
        for (const group of KEY_BINDING_GROUPS) {
            addRow({ kind: "header", height: this.headerHeight, label: group.category, gap: 2 });

            for (const binding of group.bindings) {
                const keyButton = new GuiKeyButton(
                    binding.name,
                    settings[binding.setting],
                    this.listX + this.listWidth - this.keyButtonWidth,
                    0,
                    this.keyButtonWidth,
                    this.rowHeight,
                    key => {
                        // Write the pressed key back into the settings, otherwise the
                        // button only shows the new bind and nothing gets saved.
                        settings[binding.setting] = key;
                        this.refreshConflicts();
                    },
                    defaults[binding.setting]
                );

                addRow({
                    kind: "binding",
                    height: this.rowHeight,
                    button: keyButton,
                    label: binding.name,
                    binding: binding,
                    tooltip: KEY_BUTTON_HINT
                });
            }
        }

        // Mods register their own rebindable keys through ModAPI. Group them
        // by category below the built-in bindings so users can change them
        // alongside the normal controls.
        const modGroups = new Map();
        for (const keybind of this.minecraft.modLoader?.getKeybinds?.() || []) {
            const category = keybind.category || keybind.modName || keybind.modId || 'Mod';
            if (!modGroups.has(category)) modGroups.set(category, []);
            modGroups.get(category).push(keybind);
        }

        for (const [category, keybinds] of modGroups) {
            addRow({ kind: "header", height: this.headerHeight, label: `Mods: ${category}`, gap: 2 });

            for (const keybind of keybinds) {
                const key = settings.getModKeybind(keybind.setting, keybind.defaultKey);
                const binding = {
                    name: keybind.name,
                    modKeybind: keybind.setting,
                    defaultKey: keybind.defaultKey
                };
                const keyButton = new GuiKeyButton(
                    keybind.name,
                    key,
                    this.listX + this.listWidth - this.keyButtonWidth,
                    0,
                    this.keyButtonWidth,
                    this.rowHeight,
                    newKey => {
                        settings.setModKeybind(keybind.setting, newKey);
                        this.refreshConflicts();
                    },
                    keybind.defaultKey
                );

                addRow({
                    kind: "binding",
                    height: this.rowHeight,
                    button: keyButton,
                    label: keybind.name,
                    binding: binding,
                    tooltip: KEY_BUTTON_HINT
                });
            }
        }

        this.rows = rows;
        this.contentHeight = y + 4;

        for (const row of this.rows) {
            if (!row.button) {
                continue;
            }
            row.button.minecraft = this.minecraft;
            row.button.isListButton = true;
            this.buttonList.push(row.button);
            this.listButtons.push(row.button);
        }

        // Footer: reset all binds, then leave.
        const footerWidth = Math.floor((this.listWidth - 4) / 2);
        this.buttonList.push(new GuiButton(this.minecraft, "Reset Keys", this.listX, this.footerY, footerWidth, 20, () => {
            this.resetAllKeys();
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Done", this.listX + footerWidth + 4, this.footerY, footerWidth, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));

        this.clampScroll();
        this.refreshConflicts();
    }

    // --- Layout / scroll math ----------------------------------------------

    rowY(row) {
        return Math.floor(this.top + row.offset - this.amountScrolled);
    }

    getContentHeight() {
        return this.contentHeight;
    }

    getMaxScroll() {
        return Math.max(0, this.contentHeight - (this.bottom - this.top));
    }

    clampScroll() {
        const max = this.getMaxScroll();
        if (this.amountScrolled < 0) this.amountScrolled = 0;
        if (this.amountScrolled > max) this.amountScrolled = max;
    }

    getScrollBarBounds() {
        const trackTop = this.top;
        const trackBottom = this.bottom;
        const trackHeight = trackBottom - trackTop;
        const contentHeight = this.getContentHeight();
        const max = this.getMaxScroll();

        let thumbHeight;
        if (contentHeight <= trackHeight || trackHeight <= 0) {
            thumbHeight = trackHeight;
        } else {
            thumbHeight = Math.max(
                this.scrollBarMinThumb,
                Math.floor(trackHeight * trackHeight / contentHeight)
            );
            if (thumbHeight > trackHeight) thumbHeight = trackHeight;
        }

        let thumbY;
        if (max <= 0) {
            thumbY = trackTop;
        } else {
            const usable = trackHeight - thumbHeight;
            thumbY = trackTop + Math.floor((this.amountScrolled / max) * usable);
        }

        return {
            x: this.width - this.scrollBarWidth - 2,
            y: thumbY,
            width: this.scrollBarWidth,
            height: thumbHeight,
            trackTop,
            trackBottom,
            trackHeight,
            visible: max > 0
        };
    }

    setScrollFromThumbY(thumbY, sb) {
        const usable = sb.trackHeight - sb.height;
        if (usable <= 0) {
            this.amountScrolled = 0;
            return;
        }
        const relativeY = thumbY - sb.trackTop;
        const ratio = Math.max(0, Math.min(1, relativeY / usable));
        this.amountScrolled = ratio * this.getMaxScroll();
    }

    // Keep the TV-mode selection inside the visible part of the list.
    ensureFocusVisible() {
        const button = this.selectedButtonIndex >= 0 ? this.buttonList[this.selectedButtonIndex] : null;
        if (!button || !button.isListButton) {
            return;
        }

        const row = this.rows.find(entry => entry.button === button);
        if (!row) {
            return;
        }

        const viewport = this.bottom - this.top;
        const rowY = this.rowY(row);

        if (rowY < this.top) {
            this.amountScrolled = row.offset;
        } else if (rowY + row.height > this.bottom) {
            this.amountScrolled = row.offset + row.height - viewport;
        }

        this.clampScroll();
    }

    // --- Rendering ---------------------------------------------------------

    updateListPositions() {
        for (const row of this.rows) {
            if (!row.button) {
                continue;
            }
            row.button.y = this.rowY(row);
        }
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);

        this.clampScroll();
        this.updateListPositions();

        this.drawCenteredString(stack, "Controls", this.width / 2, 16);

        stack.save();
        stack.beginPath();
        stack.rect(0, this.top, this.width, this.bottom - this.top);
        stack.clip();

        this.drawRect(stack, 0, this.top, this.width, this.bottom, "#000000", 0.45);

        for (const row of this.rows) {
            const rowY = this.rowY(row);
            if (rowY + row.height < this.top || rowY > this.bottom) {
                continue;
            }

            if (row.kind === "header") {
                this.drawCenteredString(stack, row.label, this.width / 2, rowY + 2, 0xAAAAAA);
            } else if (row.label) {
                this.drawString(stack, row.label, this.listX, rowY + row.height / 2 - 4, 0xFFFFFF, true, false);
            }
        }

        for (const button of this.listButtons) {
            button.render(stack, mouseX, mouseY, partialTicks);
        }

        stack.restore();

        for (const button of this.buttonList) {
            if (button.isListButton) {
                continue;
            }
            button.render(stack, mouseX, mouseY, partialTicks);
        }

        this.drawTooltips(stack, mouseX, mouseY, partialTicks);
        this.drawScrollBar(stack, mouseX, mouseY);
    }

    drawTooltips(stack, mouseX, mouseY, partialTicks) {
        if (mouseY < this.top || mouseY > this.bottom) {
            return;
        }
        if (mouseX < this.listX || mouseX > this.listX + this.listWidth) {
            return;
        }

        for (const row of this.rows) {
            if (!row.tooltip) {
                continue;
            }

            const rowY = this.rowY(row);
            if (mouseY < rowY || mouseY > rowY + row.height) {
                continue;
            }

            if (!row.tooltipWidget) {
                row.tooltipWidget = new GuiTooltip(this.minecraft, row.tooltip, this.listX, rowY, this.listWidth, row.height);
            }

            row.tooltipWidget.x = this.listX;
            row.tooltipWidget.y = rowY;
            row.tooltipWidget.width = this.listWidth;
            row.tooltipWidget.height = row.height;

            row.tooltipWidget.render(stack, mouseX, mouseY, partialTicks);
            return;
        }
    }

    drawScrollBar(stack, mouseX, mouseY) {
        const sb = this.getScrollBarBounds();
        if (!sb.visible) {
            return;
        }

        this.drawRect(stack, sb.x, sb.trackTop, sb.x + sb.width, sb.trackBottom, "rgba(0, 0, 0, 0.4)");

        const isHover =
            mouseX >= sb.x && mouseX <= sb.x + sb.width &&
            mouseY >= sb.y && mouseY <= sb.y + sb.height;
        const thumbColor = (isHover || this.isDragging) ? "rgb(210, 210, 210)" : "rgb(150, 150, 150)";
        this.drawRect(stack, sb.x, sb.y, sb.x + sb.width, sb.y + sb.height, thumbColor);
    }

    // --- Key conflicts -----------------------------------------------------

    getBindingKey(binding) {
        if (binding.modKeybind) {
            return this.minecraft.settings.getModKeybind(binding.modKeybind, binding.defaultKey);
        }
        return this.minecraft.settings[binding.setting];
    }

    // Minecraft marks binds that share a key in red; do the same here.
    refreshConflicts() {
        const counts = new Map();
        for (const row of this.rows) {
            if (!row.binding) {
                continue;
            }
            const key = this.getBindingKey(row.binding);
            if (!key) {
                continue;
            }
            counts.set(key, (counts.get(key) || 0) + 1);
        }

        for (const row of this.rows) {
            if (!row.binding) {
                continue;
            }
            const key = this.getBindingKey(row.binding);
            row.button.conflict = !!key && (counts.get(key) || 0) > 1;
        }
    }

    resetAllKeys() {
        const defaults = new GameSettings();
        const settings = this.minecraft.settings;

        for (const row of this.rows) {
            if (!row.binding) {
                continue;
            }

            const defaultValue = row.binding.modKeybind
                ? row.binding.defaultKey
                : defaults[row.binding.setting];
            if (row.binding.modKeybind) {
                settings.setModKeybind(row.binding.modKeybind, defaultValue);
            } else {
                settings[row.binding.setting] = defaultValue;
            }

            row.button.listening = false;
            row.button.key = defaultValue;
            row.button.updateString();
        }

        this.refreshConflicts();
    }

    // --- Input -------------------------------------------------------------

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.handleScrollBarClick(mouseX, mouseY)) {
            return;
        }

        const overList = mouseY >= this.top && mouseY <= this.bottom;

        for (const button of this.buttonList) {
            if (!button.isMouseOver(mouseX, mouseY)) {
                continue;
            }
            // List rows scrolled out of the viewport must not catch clicks.
            if (button.isListButton && !overList) {
                continue;
            }
            button.mouseClicked(mouseX, mouseY, mouseButton);
        }
    }

    handleScrollBarClick(mouseX, mouseY) {
        const sb = this.getScrollBarBounds();
        if (!sb.visible) {
            return false;
        }
        if (mouseX < sb.x || mouseX > sb.x + sb.width) {
            return false;
        }
        if (mouseY < sb.trackTop || mouseY > sb.trackBottom) {
            return false;
        }

        if (mouseY < sb.y || mouseY > sb.y + sb.height) {
            // Click on the track: jump the thumb under the cursor, then drag.
            this.setScrollFromThumbY(mouseY - sb.height / 2, sb);
            this.dragOffsetY = mouseY - this.getScrollBarBounds().y;
        } else {
            this.dragOffsetY = mouseY - sb.y;
        }

        this.isDragging = true;
        return true;
    }

    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.isDragging) {
            this.setScrollFromThumbY(mouseY - this.dragOffsetY, this.getScrollBarBounds());
            return;
        }

        for (const button of this.buttonList) {
            button.mouseDragged(mouseX, mouseY, mouseButton);
        }
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        this.isDragging = false;
        this.dragOffsetY = 0;

        for (const button of this.buttonList) {
            button.mouseReleased(mouseX, mouseY, mouseButton);
        }
    }

    mouseScrolled(mouseX, mouseY, amount) {
        if (amount === 0) {
            return;
        }
        if (mouseY < this.top || mouseY > this.bottom) {
            return;
        }

        const delta = Math.max(Math.min(amount, 1), -1);
        this.amountScrolled += delta * this.scrollStep;
        this.clampScroll();
    }

    onScroll(mouseX, mouseY, amount) {
        this.mouseScrolled(mouseX, mouseY, amount);
    }

    keyTyped(key, character) {
        // A key bind button waiting for input swallows the next key press.
        for (const button of this.listButtons) {
            if (!button.listening) {
                continue;
            }

            if (key === "Escape") {
                button.cancelListening();
                return true;
            }

            button.keyTyped(key, character);
            this.refreshConflicts();
            return true;
        }

        const handled = super.keyTyped(key, character);

        if (this.minecraft.settings.tvmode) {
            this.ensureFocusVisible();
        }

        return handled;
    }

    onClose() {
        // Save settings
        this.minecraft.settings.save();
    }

}
