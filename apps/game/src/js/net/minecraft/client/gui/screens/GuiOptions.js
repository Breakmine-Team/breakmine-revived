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

export default class GuiOptions extends GuiScreen {

    constructor(previousScreen, pagesOrItems = null, options = {}) {
        super();

        this.pauseGame = true;
        this.previousScreen = previousScreen;

        this.pages = this._normalizePages(pagesOrItems || this._defaultPages());

        this.itemsPerPage = options.itemsPerPage !== undefined ? options.itemsPerPage : 5;

        this.pages = this._autoChunk(this.pages, this.itemsPerPage);

        this.currentPage = 0;
    }

    _defaultPages() {
        return [
            {
                title: "Options",
                items: [
                    {
                        name: "Ambient Occlusion",
                        settingKey: "ambientOcclusion",
                        type: "toggle",
                        tooltip: "Shades the edges where blocks meet",
                        onchange: (_v, mc) => mc.worldRenderer.rebuildAll()
                    },
                    {
                        name: "View Bobbing",
                        settingKey: "viewBobbing",
                        type: "toggle",
                        tooltip: "Makes camera bob up and down when moving"
                    },
                    {
                        name: "FOV",
                        settingKey: "fov",
                        type: "fov",
                        min: 50,
                        max: 110
                    },
                    {
                        name: "Render Distance",
                        settingKey: "viewDistance",
                        type: "slider",
                        min: 2,
                        max: 16
                    },
                    {
                        name: "Controls...",
                        type: "action",
                        action: () => this.minecraft.displayScreen(new GuiControls(this))
                    },
                    {
                        name: "Show Publix servers",
                        settingKey: "showPublix",
                        type: "toggle"
                    },
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
                    },
                    {
                        name: "Dynamic Lighting",
                        settingKey: "dynamicLights",
                        type: "toggle",
                        tooltip: "This feature can cause lag and\nis still in development."
                    },
                    {
                        name: "Placement Preview",
                        settingKey: "showPreview",
                        type: "toggle",
                        tooltip: "Render a ghost of the placed block."
                    }
                ]
            }
        ];
    }

    _normalizePages(input) {
        if (!Array.isArray(input) || input.length === 0) {
            return [{ title: "Settings", items: [] }];
        }
        const looksLikePage = (p) =>
            p && typeof p === "object" && Array.isArray(p.items);

        if (!looksLikePage(input[0])) {
            return [{ title: "Settings", items: input }];
        }
        return input;
    }

    _autoChunk(pages, itemsPerPage) {
        if (!itemsPerPage || itemsPerPage <= 0) return pages;

        const out = [];
        for (const page of pages) {
            const items = page.items || [];
            if (items.length <= itemsPerPage) {
                out.push(page);
                continue;
            }
            const chunkCount = Math.ceil(items.length / itemsPerPage);
            for (let i = 0; i < chunkCount; i++) {
                const slice = items.slice(i * itemsPerPage, (i + 1) * itemsPerPage);
                out.push({
                    title: page.title,
                    items: slice
                });
            }
        }
        return out;
    }

    init() {
        super.init();
        this._buildPage();
    }

    _buildPage() {
        this.buttonList = [];
        this.selectedButtonIndex = -1;

        const page = this.pages[this.currentPage];
        if (!page) return;

        const settings = this.minecraft.settings;

        const buttonWidth = 200;
        const itemHeight = 24;
        const startX = this.width / 2 - buttonWidth / 2;
        const startY = this.height / 2 - 60;

        const items = page.items || [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const y = startY + i * itemHeight;
            const button = this._createItemButton(item, startX, y, buttonWidth, 20, settings);
            this.buttonList.push(button);
        }

        const navY = startY + this.itemsPerPage * itemHeight + 10;
        const navButtonWidth = Math.floor((buttonWidth - 8) / 2);

        if (this.pages.length > 1) {
            const prevButton = new GuiButton(this.minecraft, "< Prev", startX, navY, navButtonWidth, 20, () => {
                this.currentPage--;
                this._buildPage();
                this.selectFirstEnabledButton();
            });
            prevButton.setEnabled(this.currentPage > 0);
            this.buttonList.push(prevButton);

            const nextButton = new GuiButton(this.minecraft, "Next >", startX + navButtonWidth + 8, navY, navButtonWidth, 20, () => {
                this.currentPage++;
                this._buildPage();
                this.selectFirstEnabledButton();
            });
            nextButton.setEnabled(this.currentPage < this.pages.length - 1);
            this.buttonList.push(nextButton);
        }

        const doneY = navY + 26;
        this.buttonList.push(new GuiButton(this.minecraft, "Done", startX, doneY, buttonWidth, 20, () => {
            for (const b of this.buttonList) {
                if (b instanceof GuiStringButton && b.editing) {
                    b.confirmEdit();
                }
            }
            this.minecraft.displayScreen(this.previousScreen);
        }));

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.tooltip) {
                const y = startY + i * itemHeight;
                this.buttonList.push(new GuiTooltip(this.minecraft, item.tooltip, startX, y, buttonWidth, 20));
            }
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
                const slider = new GuiSliderButton(item.name, currentValue, min, max, x, y, width, height, newValue => {
                    settings[item.settingKey] = newValue;
                    if (item.onchange) item.onchange(newValue, this.minecraft);
                });
                if (item.step !== undefined && slider.setDisplayNameBuilder) {
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
                        this.drawString(stack, label, x, y + height / 2 - 4, 0xFFFFFF);
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

        const page = this.pages[this.currentPage];
        const title = (page && page.title) || "Settings";
        this.drawCenteredString(stack, title, this.width / 2, 40);

        if (this.pages.length > 1) {
            const pageIndicator = `${this.currentPage + 1}/${this.pages.length}`;
            this.drawCenteredString(stack, pageIndicator, this.width / 2, 52);
        }

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
        for (const b of this.buttonList) {
            if (b instanceof GuiStringButton && b.editing) {
                b.confirmEdit();
            }
        }
        this.minecraft.settings.save();
    }
}