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
        let textColor = this.noShadow ? 0x000000 : (this.enabled ? 0xffffff : 0x707070ff);

        // Draw background
        if (this.renderBackground) {
            this.drawRect(stack, this.x - 1, this.y - 1, this.x + this.width + 1, this.y + this.height + 1, '#5f5f60');
            this.drawRect(stack, this.x, this.y, this.x + this.width, this.y + this.height, 'black');
        }

        // Draw text
        let textX;
        if (this.centered) {
            const textWidth = this.getStringWidth(stack, this.text, true);
            textX = this.x + (this.width - textWidth) / 2;
        } else {
            textX = this.x + 2;
        }
        this.drawString(stack, this.text, textX, this.y + this.height / 2 - 4, textColor, !this.noShadow, false);

        // TODO: Draw suggestions
        // this.drawString(stack, suggestion[0], this.x + 2 + this.getStringWidth(stack, this.text), this.y + this.height / 2 - 14, textColor);
        
        // Draw cursor
        if (cursorVisible) {
            // Calculate width of text segment BEFORE the cursor
            let textBeforeCursor = this.text.substring(0, this.cursorPosition);
            let cursorOffset = this.getStringWidth(stack, textBeforeCursor, true);
            
            let cursorX;
            if (this.centered) {
                const textWidth = this.getStringWidth(stack, this.text, true);
                cursorX = this.x + (this.width - textWidth) / 2 + cursorOffset;
            } else {
                cursorX = this.x + 2 + cursorOffset;
            }
            this.drawString(stack, "_", cursorX, this.y + this.height / 2 - 3, textColor);
        }
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
        
        this.cursorPosition = this.text.length;
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

        // Move Cursor Left
        if (key === "ArrowLeft") {
            if (this.cursorPosition > 0) {
                this.cursorPosition--;
                this.cursorCounter = 0; // Reset blink
            }
            return;
        }

        // Move Cursor Right
        if (key === "ArrowRight") {
            if (this.cursorPosition < this.text.length) {
                this.cursorPosition++;
                this.cursorCounter = 0; // Reset blink
            }
            return;
        }

        if (key === "Backspace") {
            if (this.text.length > 0 && this.cursorPosition > 0) {
                // Remove character behind cursor
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
                this.text += text;
            });
            return;
        }

        if (key === "KeyA" && this.controlPressed) {
            this.text = ""; // TODO: Select all
            this.cursorPosition = 0;
            return;
        }

        if (character.length !== 1) {
            return;
        }

        if (this.text.length < this.maxLength) {
            // Insert character at cursor position
            this.text = this.text.substring(0, this.cursorPosition) + 
                        character + 
                        this.text.substring(this.cursorPosition);
            this.cursorPosition++;
            this.cursorCounter = 0;
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