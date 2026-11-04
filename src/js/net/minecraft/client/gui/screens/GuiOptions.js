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
                title: "Performance",
                items: [
                    {
                        name: "Hardware Profile",
                        settingKey: "hardwarePreset",
                        type: "list",
                        options: [{ key: "low", name: "Low" }, { key: "balanced", name: "Balanced" }, { key: "high", name: "High" }, { key: "custom", name: "Custom" }],
                        tooltip: "Manual presets; no hardware auto-detection.\nLow: 2 chunks, 2 ms streaming, smaller cache.\nBalanced: 4 chunks, 4 ms, normal cache.\nHigh: 8 chunks, 6 ms, larger cache; more RAM.\nCustom keeps your individual settings.",
                        onchange: (value, mc) => {
                            const previousAO = mc.settings.ambientOcclusion;
                            mc.settings.applyHardwarePreset(value);
                            mc.world?.chunkProvider?.setMemoryPreset?.(mc.settings.vanillithMemoryPreset);
                            if (previousAO !== mc.settings.ambientOcclusion) mc.worldRenderer?.rebuildAll();
                            this._buildPage();
                            this.selectFirstEnabledButton();
                        }
                    },
                    {
                        name: "Render Distance",
                        settingKey: "viewDistance",
                        type: "slider", min: 2, max: 16,
                        tooltip: "Higher distance costs more CPU, GPU and memory."
                    },
                    {
                        name: "Streaming Budget (ms)",
                        settingKey: "vanillithFrameBudgetMs",
                        type: "slider", min: 1, max: 8,
                        tooltip: "Vanillith main-thread work allowance per frame.\nLower: smoother frames, slower publication.\nHigher: faster publication, more frame pressure.\nThis is cooperative, not a strict time limit."
                    },
                    {
                        name: "Vanillith Memory",
                        settingKey: "vanillithMemoryMiB",
                        type: "slider", min: 256, max: 3072,
                        tooltip: "Memory target in MiB: slide from 256 to 3072.\n~71% goes to caches; rest is nominal headroom.\nWARNING: not a process RAM cap; browser may exceed target.\nFour terrain workers also need RAM. Large targets can crash low-memory devices.",
                        onchange: (value, mc) => {
                            mc.settings.vanillithMemoryCustom = true;
                            mc.world?.chunkProvider?.setMemoryPreset?.(mc.settings.vanillithMemoryPreset);
                        }
                    }
                ]
            },
            {
                title: "Chunk Streaming",
                items: [
                    {
                        name: "Active Radius", settingKey: "vanillithGenerationRadius",
                        type: "slider", min: 1, max: 8,
                        tooltip: "Nearby fully loaded/meshed chunks.\nRadius 3: 7x7. Radius 8: 17x17.\nLarge active areas cost GPU time and RAM."
                    },
                    {
                        name: "Background Radius", settingKey: "vanillithBackgroundRadius",
                        type: "slider", min: 3, max: 48,
                        tooltip: "Generate ahead even standing still; nearby work goes first.\nDefault 16: 33x33 chunks. Maximum 48: 97x97.\nFour terrain workers; decoration batches rotate through four directions.\nFar results stay cached/LOD-only. Large areas take time and RAM."
                    }
                ]
            },
            {
                title: "Distant Terrain",
                items: [
                    {
                        name: "Cached View (chunks)", settingKey: "vanillithCachedViewDistance",
                        type: "slider", min: 2, max: 32,
                        tooltip: "Show retained full meshes beyond the active area.\nOnly already generated chunks; no extra worldgen.\nMore distance costs GPU time and water sorting."
                    },
                    {
                        name: "Surface LOD", settingKey: "vanillithLod", type: "toggle",
                        tooltip: "Lightweight distant surfaces from visited chunks.\nVisual only: no collision, caves or full tree detail.\nNever replaces required nearby chunks.",
                        onchange: (value, mc) => {
                            const provider = mc.world?.chunkProvider;
                            if (!value) provider?.distantTerrain?.clear();
                            else if (provider?.distantTerrain) for (const { value: chunk } of provider.warmRender.entries.values()) {
                                provider.distantTerrain.enqueue(chunk.native);
                            }
                        }
                    },
                    {
                        name: "LOD Distance (chunks)", settingKey: "vanillithLodDistance",
                        type: "slider", min: 4, max: 64,
                        tooltip: "Maximum distance for cached surface LOD.\nThis does not generate unseen terrain.\nBounded cache eviction can shorten visibility."
                    }
                ]
            },
            {
                title: "Graphics",
                items: [
                    {
                        name: "Clouds",
                        settingKey: "clouds",
                        type: "list",
                        options: [
                            { key: "off", name: "Off" },
                            { key: "fast", name: "Fast" },
                            { key: "fancy", name: "Fancy" }
                        ],
                        tooltip: "Off: no clouds. Fast: lightweight flat clouds. Fancy: 3D extruded clouds, like Minecraft.",
                        onchange: (value, mc) => mc.world?.setCloudMode?.(value)
                    }
                ]
            },
            {
                title: "Sound",
                items: [
                    {
                        name: "Music",
                        settingKey: "musicVolume",
                        type: "slider", min: 0, max: 100,
                        tooltip: "Adjust music volume. Changes apply while music is playing.",
                        onchange: (value, mc) => mc.musicManager?.setVolume(value / 100)
                    },
                    {
                        name: "Sound",
                        settingKey: "soundVolume",
                        type: "slider", min: 0, max: 100,
                        tooltip: "Adjust block, item, and interface sound volume.",
                        onchange: (value, mc) => mc.soundManager?.setVolume(value / 100)
                    }
                ]
            },
            {
                title: "Controls",
                items: [
                    { name: "Controls...", type: "action", action: () => this.minecraft.displayScreen(new GuiControls(this)) }
                ]
            },
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
                        name: "Attack Indicator",
                        settingKey: "attackIndicator",
                        type: "list",
                        options: [
                            { key: "off", name: "Off" },
                            { key: "crosshair", name: "Crosshair" },
                            { key: "hotbar", name: "Hotbar" }
                        ]
                    },
                    {
                        name: "FOV",
                        settingKey: "fov",
                        type: "fov",
                        min: 50,
                        max: 110
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

    mouseScrolled(mouseX, mouseY, amount) {
        const button = this.buttonList.find(button => button instanceof GuiSliderButton &&
            button.settingName === 'Vanillith Memory' && button.isMouseOver(mouseX, mouseY));
        if (!button || !amount) return;
        button.value = Math.max(button.min, Math.min(button.max, button.value + Math.sign(amount) * 128));
        button.string = button.getDisplayName(button.settingName, button.value);
        button.callback();
    }

    _createItemButton(item, x, y, width, height, settings) {
        const currentValue = settings[item.settingKey];
        const changed = newValue => {
            settings[item.settingKey] = newValue;
            if (item.onchange) item.onchange(newValue, this.minecraft);
            settings.syncHardwarePreset?.();
            for (const button of this.buttonList) {
                if (button instanceof GuiListButton && button.settingName === 'Hardware Profile') button.setValue(settings.hardwarePreset);
            }
        };

        switch (item.type) {
            case "toggle":
                return new GuiSwitchButton(item.name, !!currentValue, x, y, width, height, newValue => {
                    changed(newValue);
                });

            case "fov": {
                const min = item.min !== undefined ? item.min : 50;
                const max = item.max !== undefined ? item.max : 110;
                return new GuiFovSliderButton(item.name, currentValue, min, max, x, y, width, height, newValue => {
                    changed(newValue);
                });
            }

            case "slider": {
                const min = item.min !== undefined ? item.min : 0;
                const max = item.max !== undefined ? item.max : 100;
                const slider = new GuiSliderButton(item.name, currentValue, min, max, x, y, width, height, newValue => {
                    changed(newValue);
                });
                if (item.settingKey === 'vanillithMemoryMiB') slider.setDisplayNameBuilder((name, value) =>
                    `${name}: ${value} MiB${value >= 2048 ? ' !' : ''}`);
                if (item.settingKey === 'musicVolume' || item.settingKey === 'soundVolume') {
                    slider.setDisplayNameBuilder((name, value) => `${name}: ${value}%`);
                }
                if (item.step !== undefined && slider.setDisplayNameBuilder) {
                    slider.setDisplayNameBuilder((name, value) => `${name}: ${value}`);
                }
                return slider;
            }

            case "list": {
                const options = Array.isArray(item.options) ? item.options : [];
                return new GuiListButton(item.name, currentValue, options, x, y, width, height, newValue => {
                    changed(newValue);
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
                    changed(newValue);
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
