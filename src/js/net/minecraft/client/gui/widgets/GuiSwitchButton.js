import GuiButton from "./GuiButton.js";

export default class GuiSwitchButton extends GuiButton {

    constructor(name, value, x, y, width, height, callback) {
        super(name, x, y, width, height, _ => callback(this.value));

        this.settingName = name;
        this.value = value;

        this.string = this.getDisplayName();
    }

    isSelectable() {
        return true;
    }

    onPress() {
        // Play click sound
        if (this.minecraft && this.minecraft.soundManager) {
            this.minecraft.soundManager.playGuiClick();
        }
        this.value = !this.value;
        this.string = this.getDisplayName();
        this.callback();
    }

    getDisplayName() {
        return this.settingName + ": " + (this.value ? "ON" : "OFF");
    }
}