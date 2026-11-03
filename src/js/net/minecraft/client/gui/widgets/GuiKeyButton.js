import GuiButton from "./GuiButton.js";

export default class GuiKeyButton extends GuiButton {

    // event.code -> the label Minecraft-style key bind menus show.
    static KEY_NAMES = {
        "Escape": "Esc",
        "Tab": "Tab",
        "CapsLock": "Caps Lock",
        "Space": "Space",
        "Enter": "Enter",
        "NumpadEnter": "Numpad Enter",
        "Backspace": "Backspace",
        "Delete": "Delete",
        "Insert": "Insert",
        "Home": "Home",
        "End": "End",
        "PageUp": "Page Up",
        "PageDown": "Page Down",
        "ArrowUp": "Up Arrow",
        "ArrowDown": "Down Arrow",
        "ArrowLeft": "Left Arrow",
        "ArrowRight": "Right Arrow",
        "ShiftLeft": "Left Shift",
        "ShiftRight": "Right Shift",
        "ControlLeft": "Left Control",
        "ControlRight": "Right Control",
        "AltLeft": "Left Alt",
        "AltRight": "Right Alt",
        "MetaLeft": "Left Super",
        "MetaRight": "Right Super",
        "ContextMenu": "Menu",
        "PrintScreen": "Print Screen",
        "ScrollLock": "Scroll Lock",
        "Pause": "Pause",
        "Slash": "/",
        "Backslash": "\\",
        "Comma": ",",
        "Period": ".",
        "Semicolon": ";",
        "Quote": "'",
        "BracketLeft": "[",
        "BracketRight": "]",
        "Minus": "-",
        "Equal": "=",
        "Backquote": "`",
        "NumpadAdd": "Numpad +",
        "NumpadSubtract": "Numpad -",
        "NumpadMultiply": "Numpad *",
        "NumpadDivide": "Numpad /",
        "NumpadDecimal": "Numpad .",
        "ColorRed": "Red",
        "ColorGreen": "Green",
        "ColorYellow": "Yellow",
        "ColorBlue": "Blue"
    };

    static getDisplayName(key) {
        if (!key) {
            return "Not Bound";
        }

        const named = GuiKeyButton.KEY_NAMES[key];
        if (named) {
            return named;
        }

        let match = /^Key([A-Z])$/.exec(key);
        if (match) {
            return match[1];
        }

        match = /^Digit([0-9])$/.exec(key);
        if (match) {
            return match[1];
        }

        match = /^Numpad([0-9])$/.exec(key);
        if (match) {
            return "Numpad " + match[1];
        }

        return key;
    }

    constructor(name, key, x, y, width, height, callback, defaultKey = key) {
        super(name, x, y, width, height, _ => callback(this.key));

        this.name = name;
        this.key = key;
        this.defaultKey = defaultKey;

        // While true the next key press becomes the binding (" > ... < ").
        this.listening = false;
        // Another action already uses this key.
        this.conflict = false;

        this.updateString();
    }

    updateString() {
        this.string = GuiKeyButton.getDisplayName(this.key);
    }

    setKey(key) {
        this.key = key;
        this.updateString();
        this.callback();
    }

    resetToDefault() {
        this.listening = false;
        this.setKey(this.defaultKey);
    }

    startListening() {
        if (!this.enabled) {
            return;
        }
        if (this.minecraft && this.minecraft.soundManager) {
            this.minecraft.soundManager.playGuiClick();
        }
        this.listening = true;
    }

    cancelListening() {
        this.listening = false;
        this.updateString();
    }

    onPress() {
        this.startListening();
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (!this.enabled) {
            return;
        }

        // Right-click resets this binding, like Minecraft's key bind menu.
        if (mouseButton === 2) {
            this.resetToDefault();
            return;
        }

        this.startListening();
    }

    keyTyped(key) {
        if (!this.listening) {
            return;
        }

        if (key === "Escape") {
            this.cancelListening();
            return;
        }

        this.listening = false;

        // Backspace/Delete unbind the action instead of binding that key.
        if (key === "Backspace" || key === "Delete") {
            this.setKey(null);
        } else {
            this.setKey(key);
        }
    }

    render(stack, mouseX, mouseY, partialTicks) {
        const mouseOver = this.isMouseOver(mouseX, mouseY) || this.focused;

        this.drawButton(stack, this.enabled, mouseOver, this.x, this.y, this.width, this.height);

        let label;
        if (this.listening) {
            label = "> ... <";
        } else {
            label = GuiKeyButton.getDisplayName(this.key);
        }

        if (!this.enabled) {
            label = "§7" + label;
        } else if (this.listening) {
            label = "§e" + label;
        } else if (!this.key || this.conflict) {
            label = "§c" + label;
        } else if (mouseOver) {
            label = "§e" + label;
        }

        this.drawCenteredString(stack, label, this.x + this.width / 2, this.y + this.height / 2 - 4, 0xFFFFFFFF, false);
    }

}
