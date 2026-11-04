import GuiButton from "./GuiButton.js";

function keyName(key) {
    return key.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'L Shift')
        .replace('ShiftRight', 'R Shift').replace('ControlLeft', 'L Ctrl')
        .replace('ControlRight', 'R Ctrl').replace('AltLeft', 'L Alt').replace('AltRight', 'R Alt');
}

export default class GuiKeyButton extends GuiButton {
    constructor(name, key, x, y, width, height, callback) {
        super('', x, y, width, height, () => callback(this.key));
        this.name = name;
        this.key = key;
        this.listening = false;
        this.updateLabel();
    }

    updateLabel() { this.string = `${this.name}: ${keyName(this.key)}`; }
    cancel() { this.listening = false; this.updateLabel(); }

    onPress() {
        if (!this.enabled) return;
        this.minecraft?.soundManager?.playGuiClick();
        this.listening = true;
        this.string = `${this.name}: ...`;
    }

    keyTyped(key) {
        if (!this.listening) return;
        this.key = key;
        this.listening = false;
        this.updateLabel();
        this.callback();
    }
}
