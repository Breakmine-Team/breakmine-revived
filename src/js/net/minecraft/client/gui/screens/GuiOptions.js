import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiSwitchButton from "../widgets/GuiSwitchButton.js";
import GuiSliderButton from "../widgets/GuiSliderButton.js";
import GuiFovSliderButton from "../widgets/GuiFovSliderButton.js";
import GuiStringButton from "../widgets/GuiStringButton.js";
import GuiListButton from "../widgets/GuiListButton.js";
import GuiTextField from "../widgets/GuiTextField.js";
import GuiTooltip from "../widgets/GuiTooltip.js";
import GuiControls from "./GuiControls.js";
import I18n from "../../i18n/I18n.js";
import BlockLeave from "../../world/block/type/BlockLeave.js";

export default class GuiOptions extends GuiScreen {

    constructor(previousScreen, pagesOrItems = null, options = {}) {
        super();

        this.pauseGame = true;
        this.previousScreen = previousScreen;

        this.categories = this._normalizeCategories(pagesOrItems || this._defaultCategories());
        this.items = [];
        for (const category of this.categories) {
            for (const item of category.items) {
                this.items.push(item);
            }
        }

        this.rows = [];
        this.listButtons = [];

        this.amountScrolled = 0;
        this.isDragging = false;
        this.dragOffsetY = 0;

        this.scrollBarWidth = 6;
        this.scrollBarMinThumb = 12;
        this.scrollStep = 20;

    }

    _defaultCategories() {
        return [
            {
                title: "",
                items: [
                    {
                        name: "Controls...",
                        type: "action",
                        action: () => this.minecraft.displayScreen(new GuiControls(this))
                    },
                    {
                        name: "Language",
                        settingKey: "language",
                        type: "list",
                        options: I18n.getLanguageOptions(),
                        tooltip: "Choose the language used by the game UI",
                        onchange: (value, mc) => {
                            mc.settings.language = value;
                            I18n.setLanguage(value);
                            mc.settings.save();
                        }
                    }
                ]
            },
            {
                title: "Graphics",
                items: [
                    {
                        name: "Ambient Occlusion",
                        settingKey: "ambientOcclusion",
                        type: "toggle",
                        tooltip: "Shades the edges where blocks meet",
                        onchange: (_v, mc) => mc.worldRenderer.rebuildAll()
                    },
                    {
                        name: "Render Distance",
                        settingKey: "viewDistance",
                        type: "slider",
                        min: 2,
                        max: 16
                    },
                    {
                        name: "FOV",
                        settingKey: "fov",
                        type: "fov",
                        min: 50,
                        max: 110
                    },
                    {
                        name: "Resolution",
                        settingKey: "resolution",
                        type: "slider",
                        min: 10,
                        max: 100,
                        toSlider: (value) => Math.round(Math.min(1, Math.max(0.1, Number(value) || 1)) * 100),
                        fromSlider: (value) => value / 100,
                        display: (name, value) => `${name}: ${(value / 100).toFixed(1)}x`,
                        onchange: (_value, mc) => mc.window.applyWorldResolution()
                    },
                    {
                        name: "Clouds",
                        settingKey: "clouds",
                        type: "list",
                        options: [
                            { key: "fancy", name: "Fancy" },
                            { key: "fast", name: "Fast" }
                        ],
                        onchange: (value, mc) => {
                            if (mc.world) mc.world.setCloudMode(value);
                        }
                    },
                    {
                        name: "Transparent Leaves",
                        settingKey: "fancyLeaves",
                        type: "toggle",
                        onchange: (value, mc) => {
                            BlockLeave.setFancyLeaves(value);
                            mc.worldRenderer.rebuildAll();
                        }
                    },
                    {
                        name: "Particles",
                        settingKey: "particles",
                        type: "list",
                        options: [
                            { key: "all", name: "All" },
                            { key: "minimal", name: "Minimal" },
                            { key: "off", name: "Off" }
                        ],
                        onchange: (value, mc) => {
                            if (value === "off") mc.particleRenderer.clearParticles();
                        }
                    },
                    {
                        name: "Fog Type",
                        settingKey: "fogType",
                        type: "list",
                        options: [
                            { key: "modern", name: "Modern" },
                            { key: "classic", name: "Classic" }
                        ],
                        tooltip: "Modern: Gradual fog\nClassic: Exponential fog"
                    },
                    {
                        name: "Shadows",
                        settingKey: "shadows",
                        type: "toggle",
                        tooltip: "This feature can cause lag and\nis still in development.",
                        onchange: (_v, mc) => mc.worldRenderer.setShadowsEnabled(_v)
                    },
                ]
            },
            {
                title: "Gameplay",
                items: [
                    {
                        name: "View Bobbing",
                        settingKey: "viewBobbing",
                        type: "toggle"
                    },
                    {
                        name: "Dynamic Lighting",
                        settingKey: "dynamicLights",
                        type: "toggle",
                        tooltip: "This feature can cause lag and\nis still in development.",
                        onchange: (_v, mc) => mc.worldRenderer.setDynamicLightsEnabled(_v)
                    },
                    {
                        name: "Placement Preview",
                        settingKey: "showPreview",
                        type: "toggle",
                        tooltip: "Render a ghost of the placed block."
                    },
                    {
                        name: "Controller Sensitivity",
                        settingKey: "remoteSensitivity",
                        type: "slider",
                        min: 10,
                        max: 200
                    }
                ]
            },
            {
                title: "Interface",
                items: [
                    {
                        name: "FPS Overlay",
                        settingKey: "showFps",
                        type: "toggle"
                    },
                    {
                        name: "Version Overlay",
                        settingKey: "showVersion",
                        type: "toggle"
                    },
                    {
                        name: "GUI Scale",
                        settingKey: "guiScale",
                        type: "list",
                        options: [
                            { key: "auto", name: "Auto" },
                            { key: "1", name: "1" },
                            { key: "2", name: "2" },
                            { key: "3", name: "3" }
                        ],
                        onchange: (_value, mc) => mc.window.updateWindowSize()
                    }
                ]
            },
            {
                title: "Miscellaneous",
                items: [
                    {
                        name: "Show Nino servers",
                        settingKey: "showNino",
                        type: "toggle"
                    },
                    {
                        name: "Realms",
                        settingKey: "showRealmsButton",
                        type: "toggle",
                        tooltip: "Show the Realms button on the main menu"
                    },
                    {
                        name: "API URL",
                        settingKey: "apiUrl",
                        type: "text",
                        tooltip: "Default: api.breakmine.com\n§7Don't trust random API URLs!\n§7They could be stealing passwords! >:["
                    },
                    {
                        name: "Tunnel URL",
                        settingKey: "tunnelServer",
                        type: "text",
                        tooltip: "Default: tunnel.breakmine.com\n§7Don't trust random Tunnel URLs!"
                    }
                ]
            }
        ];
    }

    _normalizeCategories(input) {
        if (!Array.isArray(input) || input.length === 0) {
            return [];
        }

        const looksLikeCategory = (entry) =>
            entry && typeof entry === "object" && Array.isArray(entry.items);

        if (!looksLikeCategory(input[0])) {
            return [{ title: "", items: input }];
        }

        return input.map((category) => ({
            title: typeof category.title === "string" ? category.title : "",
            items: Array.isArray(category.items) ? category.items : []
        }));
    }

    init() {
        super.init();

        const settings = this.minecraft.settings;

        this.listWidth = Math.min(200, this.width - 20);
        this.listX = Math.floor((this.width - this.listWidth) / 2);
        this.rowHeight = 20;
        this.rowGap = 4;
        this.headerHeight = 12;
        this.headerGap = 2;
        this.categoryGap = 6;

        this.top = 34;
        this.footerY = this.height - 28;
        this.bottom = this.footerY - 10;
        if (this.bottom < this.top + this.rowHeight) {
            this.bottom = Math.min(this.height - 20, this.top + this.rowHeight);
        }

        this.rows = [];
        this.listButtons = [];
        this.amountScrolled = 0;

        let y = 4;
        for (const category of this.categories) {
            if (!category.items || category.items.length === 0) {
                continue;
            }

            if (category.title) {
                if (this.rows.length > 0) {
                    y += this.categoryGap;
                }
                this.rows.push({ kind: "header", offset: y, height: this.headerHeight, title: category.title });
                y += this.headerHeight + this.headerGap;
            }

            for (const item of category.items) {
                const button = this._createItemButton(item, this.listX, 0, this.listWidth, this.rowHeight, settings);
                this.rows.push({ kind: "setting", offset: y, height: this.rowHeight, button: button, item: item });
                y += this.rowHeight + this.rowGap;
            }
        }
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

        this.buttonList.push(new GuiButton(this.minecraft, "Done", this.listX, this.footerY, this.listWidth, 20, () => {
            this.confirmPendingEdits();
            this.minecraft.displayScreen(this.previousScreen);
        }));

        this.clampScroll();
    }

    confirmPendingEdits() {
        for (const button of this.buttonList) {
            if (button instanceof GuiStringButton && button.editing) {
                button.confirmEdit();
            }
        }
    }

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

    updateListPositions() {
        for (const row of this.rows) {
            if (!row.button) {
                continue;
            }
            row.button.y = this.rowY(row);
        }
    }

    _createItemButton(item, x, y, width, height, settings) {
        const currentValue = settings[item.settingKey];

        switch (item.type) {
            case "toggle":
                return new GuiSwitchButton(item.name, !!currentValue, x, y, width, height, newValue => {
                    settings[item.settingKey] = newValue;
                    if (item.onchange) item.onchange(newValue, this.minecraft);
                });

            case "fov": {
                const min = item.min !== undefined ? item.min : 50;
                const max = item.max !== undefined ? item.max : 110;
                return new GuiFovSliderButton(item.name, currentValue, min, max, x, y, width, height, newValue => {
                    settings[item.settingKey] = newValue;
                    if (item.onchange) item.onchange(newValue, this.minecraft);
                });
            }

            case "slider": {
                const min = item.min !== undefined ? item.min : 0;
                const max = item.max !== undefined ? item.max : 100;
                const toSlider = typeof item.toSlider === "function" ? item.toSlider : (value => value);
                const fromSlider = typeof item.fromSlider === "function" ? item.fromSlider : (value => value);
                const slider = new GuiSliderButton(item.name, toSlider(currentValue), min, max, x, y, width, height, newValue => {
                    settings[item.settingKey] = fromSlider(newValue);
                    if (item.onchange) item.onchange(newValue, this.minecraft);
                });
                if (typeof item.display === "function") {
                    slider.setDisplayNameBuilder(item.display);
                } else if (item.step !== undefined && slider.setDisplayNameBuilder) {
                    slider.setDisplayNameBuilder((name, value) => `${name}: ${value}`);
                }
                return slider;
            }

            case "list": {
                const options = Array.isArray(item.options) ? item.options : [];
                return new GuiListButton(item.name, currentValue, options, x, y, width, height, newValue => {
                    settings[item.settingKey] = newValue;
                    if (item.onchange) item.onchange(newValue, this.minecraft);
                });
            }

            case "action":
                return new GuiButton(this.minecraft, item.name, x, y, width, height, () => {
                    if (item.action) item.action(this, this.minecraft);
                });

            case "text": {
                const label = item.name || "";
                const labelWidth = label ? Math.min(this.getStringWidth(label) + 2, width - 60) : 0;
                const fieldX = x + labelWidth;
                const fieldWidth = width - labelWidth;
                const field = new GuiTextField(fieldX, y, fieldWidth, height);
                field.setText(currentValue);
                if (item.centered) field.centered = true;
                if (item.maxLength !== undefined) field.maxLength = item.maxLength;
                if (item.renderBackground !== undefined) field.renderBackground = item.renderBackground;
                const originalOnTick = field.onTick.bind(field);
                field.onTick = () => {
                    originalOnTick();
                    settings[item.settingKey] = field.getText();
                };
                if (label) {
                    const originalRender = field.render.bind(field);
                    field.render = (stack, mouseX, mouseY, partialTicks) => {
                        this.drawString(stack, label, x, field.y + field.height / 2 - 4, 0xFFFFFF);
                        originalRender(stack, mouseX, mouseY, partialTicks);
                    };
                }
                return field;
            }

            case "string":
            default:
                return new GuiStringButton(item.name, currentValue, x, y, width, height, newValue => {
                    settings[item.settingKey] = newValue;
                    if (item.onchange) item.onchange(newValue, this.minecraft);
                });
        }
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);

        this.clampScroll();
        this.updateListPositions();

        this.drawCenteredString(stack, "Options", this.width / 2, 16);

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
                this.drawString(stack, row.title, this.listX + 2, rowY + 2, 0xAAAAAA);
                continue;
            }

            if (row.button) {
                row.button.render(stack, mouseX, mouseY, partialTicks);
            }
        }

        stack.restore();

        this.drawEdgeFades(stack, 0, this.width, this.top, this.bottom);

        for (const button of this.buttonList) {
            if (button.isListButton) {
                continue;
            }
            if (!button.minecraft) {
                button.minecraft = this.minecraft;
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
            if (!row.item || !row.item.tooltip) {
                continue;
            }

            const rowY = this.rowY(row);
            if (mouseY < rowY || mouseY > rowY + row.height) {
                continue;
            }

            if (!row.tooltipWidget) {
                row.tooltipWidget = new GuiTooltip(this.minecraft, row.item.tooltip, this.listX, rowY, this.listWidth, row.height);
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

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.handleScrollBarClick(mouseX, mouseY)) {
            return;
        }

        const overList = mouseY >= this.top && mouseY <= this.bottom;

        for (const button of this.buttonList) {
            if (!button.isMouseOver(mouseX, mouseY)) {
                continue;
            }
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
        const handled = super.keyTyped(key, character);

        if (this.minecraft.settings.tvmode) {
            this.ensureFocusVisible();
        }

        return handled;
    }

    onClose() {
        this.confirmPendingEdits();
        this.minecraft.settings.save();
    }
}
