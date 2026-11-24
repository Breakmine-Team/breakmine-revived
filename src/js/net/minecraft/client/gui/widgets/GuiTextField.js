import GuiButton from "./GuiButton.js";

export default class GuiTextField extends GuiButton {

    constructor(x, y, width, height, en2 = true, alwaysFocused = false) {
        super("", x, y, width, height);

        this.enableS = en2;
        this.alwaysFocused = alwaysFocused;

        this.text = "";
        this.isFocused = false;
        this.cursorCounter = 0;
        this.maxLength = 80;
        this.renderBackground = true;
        this.centered = false;
        this.customTextColor = null;
        this.textOffsetY = 0;
        this.maxWidth = null;

        this.renderE = true;
        this.cursorPosition = 0;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) {return};
        if (this.enableS === true) {
            this.isFocused = this.isPointInBox(mouseX, mouseY, this.x - 1, this.y - 1, this.x + this.width + 1, this.y + this.height + 1);
        }

        this.isFocused = this.alwaysFocused || this.isFocused;
        
        let cursorVisible = this.isFocused && Math.floor(this.cursorCounter / 6) % 2 === 0;
        let textColor = this.customTextColor ?? (this.noShadow ? 0x000000 : (this.enabled ? 0xffffff : 0x707070ff));

        if (this.renderBackground) {
            this.drawRect(stack, this.x - 1, this.y - 1, this.x + this.width + 1, this.y + this.height + 1, '#5f5f60');
            this.drawRect(stack, this.x, this.y, this.x + this.width, this.y + this.height, 'black');
        }

        let textX;
        let scrollX = 0;
        const caretOffset = this.getStringWidth(stack, this.text.substring(0, this.cursorPosition), true);
        const textWidth = this.getStringWidth(stack, this.text, true);
        if (this.centered) {
            textX = this.x + (this.width - textWidth) / 2;
        } else {
            const visibleWidth = Math.max(0, this.width - 4);
            scrollX = Math.max(0, Math.min(Math.max(0, textWidth - visibleWidth), caretOffset - visibleWidth));
            textX = this.x + 2 - scrollX;
        }

        stack.save();
        stack.beginPath();
        stack.rect(this.x, this.y - 1, this.width, this.height + 2);
        stack.clip();

        this.drawString(stack, this.text, textX, this.y + this.height / 2 - 4 + this.textOffsetY, textColor, !this.noShadow, false);


        if (cursorVisible) {
            let cursorX;
            if (this.centered) {
                cursorX = this.x + (this.width - textWidth) / 2 + caretOffset;
            } else {
                cursorX = this.x + 2 + caretOffset - scrollX;
            }
            this.drawString(stack, "_", cursorX, this.y + this.height / 2 - 3, textColor, !this.noShadow);
        }

        stack.restore();
    }

    setText(newText) {
        if (newText === undefined || newText === null) {
            this.text = "";
        } else {
            this.text = String(newText);
        }
        
        if (this.text.length > this.maxLength) {
            this.text = this.text.substring(0, this.maxLength);
        }

        while (this.text.length > 0 && !this.fitsWidth(this.text)) {
            this.text = this.text.substring(0, this.text.length - 1);
        }
        
        this.cursorPosition = this.text.length;
    }

    // Max pixel width of the text, measured on the actual (variable width) glyphs
    fitsWidth(text) {
        if (this.maxWidth === null || this.maxWidth === undefined) {
            return true;
        }
        if (!this.minecraft || !this.minecraft.fontRenderer) {
            return true;
        }
        return this.getStringWidth(null, text, true) <= this.maxWidth;
    }

    setFocused(focused) {
        this.isFocused = !!focused;
        return this;
    }

    onTick() {
        this.cursorCounter++;
    }
    
    isPointInBox(x, y, x1, y1, x2, y2) {
        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
            return true;
        } else {
            return false;
        }
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        this.isFocused = this.isPointInBox(mouseX, mouseY, this.x - 1, this.y - 1, this.x + this.width + 1, this.y + this.height + 1);
    }

    onPress() {

    }

    keyTyped(key, character) {
        if (!this.isFocused || !this.enabled || !this.renderE) {
            return;
        }

        if (key === "ArrowLeft") {
            if (this.cursorPosition > 0) {
                this.cursorPosition--;
                this.cursorCounter = 0; 
            }
            return;
        }

        if (key === "ArrowRight") {
            if (this.cursorPosition < this.text.length) {
                this.cursorPosition++;
                this.cursorCounter = 0; 
            }
            return;
        }

        if (key === "Backspace") {
            if (this.text.length > 0 && this.cursorPosition > 0) {
                this.text = this.text.substring(0, this.cursorPosition - 1) + 
                            this.text.substring(this.cursorPosition);
                this.cursorPosition--;
                this.cursorCounter = 0;
            }
            return;
        }

        if (key === "ShiftLeft") {
            this.shiftPressed = true;
            return;
        }

        if (key === "ControlLeft") {
            this.controlPressed = true;
            return;
        }

        if (key === "KeyV" && this.controlPressed) {
            this.minecraft.window.getClipboardText().then(text => {
                const room = this.maxLength - this.text.length;
                if (room <= 0 || !text) return;

                const before = this.text.substring(0, this.cursorPosition);
                const after = this.text.substring(this.cursorPosition);
                let inserted = "";
                for (const character of Array.from(text)) {
                    if (inserted.length >= room) break;
                    if (!this.fitsWidth(before + inserted + character + after)) break;
                    inserted += character;
                }
                if (inserted.length === 0) return;

                this.text = before + inserted + after;
                this.cursorPosition += inserted.length;
            });
            return;
        }

        if (key === "KeyA" && this.controlPressed) {
            this.text = ""; 
            this.cursorPosition = 0;
            return;
        }

        if (character.length !== 1) {
            return;
        }

        if (this.text.length < this.maxLength) {
            const newText = this.text.substring(0, this.cursorPosition) + 
                            character + 
                            this.text.substring(this.cursorPosition);
            if (this.fitsWidth(newText)) {
                this.text = newText;
                this.cursorPosition++;
                this.cursorCounter = 0;
            }
        }
    }

    keyReleased(key) {
        if (key === "ShiftLeft") {
            this.shiftPressed = false;
            return;
        }

        if (key === "ControlLeft") {
            this.controlPressed = false;
            return;
        }
    }

    getText() {
        return this.text;
    }
}