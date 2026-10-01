import GuiButton from "./GuiButton.js";

export default class GuiListButton extends GuiButton {

    constructor(name, value, options, x, y, width, height, callback) {
        super(name, x, y, width, height, _ => callback(this.value));

        this.settingName = name;
        this.options = Array.isArray(options) ? options : [];

        if (!this._findOption(value) && this.options.length > 0) {
            value = this.options[0].key;
        }
        this.value = value;

        this.string = this.getDisplayName();
    }

    isSelectable() {
        return true;
    }

    _findOption(key) {
        for (let i = 0; i < this.options.length; i++) {
            if (this.options[i].key === key) return this.options[i];
        }
        return null;
    }

    _currentIndex() {
        for (let i = 0; i < this.options.length; i++) {
            if (this.options[i].key === this.value) return i;
        }
        return -1;
    }

    getDisplayName() {
        const current = this._findOption(this.value);
        const label = current ? current.name : String(this.value);
        return this.settingName + ": " + label;
    }

    _advance(step) {
        if (this.options.length === 0) return;

        const idx = this._currentIndex();
        let nextIdx = idx + step;
        nextIdx = ((nextIdx % this.options.length) + this.options.length) % this.options.length;

        this.value = this.options[nextIdx].key;
        this.string = this.getDisplayName();
        if (this.minecraft && this.minecraft.soundManager) {
            this.minecraft.soundManager.playGuiClick();
        }
        this.callback();
    }

    onPress() {
        this._advance(1);
    }

    keyTyped(key, character) {
        if (!this.focused || !this.minecraft || !this.minecraft.settings.tvmode) return;

        if (key === "ArrowRight" || key === "Enter") {
            this._advance(1);
            return;
        }
        if (key === "ArrowLeft") {
            this._advance(-1);
            return;
        }
    }

    setValue(newValue) {
        if (this._findOption(newValue)) {
            this.value = newValue;
        } else if (this.options.length > 0) {
            this.value = this.options[0].key;
        } else {
            this.value = newValue;
        }
        this.string = this.getDisplayName();
        return this;
    }

    getValue() {
        return this.value;
    }
}
