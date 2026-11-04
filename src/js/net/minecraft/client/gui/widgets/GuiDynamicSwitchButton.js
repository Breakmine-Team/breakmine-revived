import GuiButton from "./GuiButton.js";

export default class GuiDynamicSwitchButton extends GuiButton {

    constructor(name, value, x, y, width, height, options = {}) {
        super(name, x, y, width, height, _ => {
            if (options.callback) options.callback(this.value);
        });

        this.settingName = name;
        this.value = value;
        this.options = options;
        this.index = this.options.values ? this.options.values.indexOf(this.value) : 0;
        if (this.index === -1) this.index = 0;

        this.string = this.getDisplayName();
    }

    onPress() {
        if (!this.options.values || this.options.values.length === 0) return;

        // Play click sound
        if (this.minecraft && this.minecraft.soundManager) {
            this.minecraft.soundManager.playGuiClick();
        }

        this.index = (this.index + 1) % this.options.values.length;
        this.value = this.options.values[this.index];
        this.string = this.getDisplayName();        
        this.callback(); 
    }

    getDisplayName() {
        const displayValue = this.options.values ? this.options.values[this.index] : this.value;
        return this.settingName + ": " + displayValue;
    }
}