import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiSliderButton from "../widgets/GuiSliderButton.js";

const VOLUME_SLIDERS = [
    { name: "Master Volume", setting: "masterVolume" },
    { name: "Music", setting: "musicVolume" },
    { name: "Blocks", setting: "blocksVolume" },
    { name: "Misc", setting: "miscVolume" }
];

export default class GuiSound extends GuiScreen {

    constructor(previousScreen) {
        super();

        this.previousScreen = previousScreen;
        this.pauseGame = true;
    }

    init() {
        super.init();

        const settings = this.minecraft.settings;

        this.listWidth = Math.min(200, this.width - 20);
        this.listX = Math.floor((this.width - this.listWidth) / 2);
        this.rowHeight = 20;
        this.rowGap = 4;

        this.top = 34;
        this.footerY = this.height - 28;

        let y = this.top + 6;
        for (const entry of VOLUME_SLIDERS) {
            const slider = new GuiSliderButton(
                entry.name,
                Math.round(settings[entry.setting] * 100),
                0,
                100,
                this.listX,
                y,
                this.listWidth,
                this.rowHeight,
                value => {
                    settings[entry.setting] = value / 100;
                    this.minecraft.applyAudioVolumes();
                }
            );
            slider.setDisplayNameBuilder((name, value) => name + ": " + value + "%");
            slider.minecraft = this.minecraft;
            this.buttonList.push(slider);

            y += this.rowHeight + this.rowGap;
        }

        this.buttonList.push(new GuiButton(this.minecraft, "Done", this.listX, this.footerY, this.listWidth, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);

        const bottom = this.footerY - 10;

        this.drawCenteredString(stack, "Sound", this.width / 2, 16);

        stack.save();
        stack.beginPath();
        stack.rect(0, this.top, this.width, bottom - this.top);
        stack.clip();

        this.drawRect(stack, 0, this.top, this.width, bottom, "#000000", 0.45);

        stack.restore();

        this.drawEdgeFades(stack, 0, this.width, this.top, bottom);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
        this.minecraft.settings.save();
    }
}
