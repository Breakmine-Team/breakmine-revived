import Gui from "./Gui.js";

export default class GuiScreen extends Gui {

    constructor() {
        super();

        this.buttonList = [];
        this.previousScreen = null;
        this.pauseGame = false;
        this.selectedButtonIndex = -1;
    }

    setup(minecraft, width, height) {
        this.minecraft = minecraft;
        this.width = width;
        this.height = height;
        this.textureBackground = this.getTexture("gui/background.png");

        this.init();

        // TV mode: auto-select first enabled button
        this.selectFirstEnabledButton();
    }

    init() {
        this.buttonList = [];
        this.selectedButtonIndex = -1;
    }

    selectFirstEnabledButton() {
        if (!this.minecraft || !this.minecraft.settings.tvmode) return;
        this.selectedButtonIndex = -1;
        for (let i = 0; i < this.buttonList.length; i++) {
            if (this.buttonList[i].isSelectable()) {
                this.selectedButtonIndex = i;
                break;
            }
        }
        this.updateFocusedButtons();
    }

    updateFocusedButtons() {
        for (let i = 0; i < this.buttonList.length; i++) {
            this.buttonList[i].focused = (i === this.selectedButtonIndex);
        }
    }

    onClose() {

    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        for (let i in this.buttonList) {
            let button = this.buttonList[i];
            if (!button.minecraft) {
                button.minecraft = this.minecraft;
            }
            button.render(stack, mouseX, mouseY, partialTicks);
        }
    }

    updateScreen() {
        if (typeof this.onTick === "function") {
            this.onTick();
        }

        for (let i in this.buttonList) {
            let button = this.buttonList[i];

            button.onTick();
        }
    }

    keyTyped(key, character) {
        // Escape cancels key listening before going back
        if (key === "Escape") {
            let focusedButton = this.selectedButtonIndex >= 0 ? this.buttonList[this.selectedButtonIndex] : null;
            if (focusedButton && focusedButton.listening) {
                focusedButton.listening = false;
                focusedButton.string = focusedButton.name + ": " + focusedButton.key;
                return true;
            }
            this.minecraft.displayScreen(this.previousScreen);
            return true;
        }

        // TV mode: arrow key navigation between buttons
        if (this.minecraft && this.minecraft.settings.tvmode) {
            let focusedButton = this.selectedButtonIndex >= 0 ? this.buttonList[this.selectedButtonIndex] : null;

            // If a key button is listening, forward all keys to it
            if (focusedButton && focusedButton.listening) {
                focusedButton.keyTyped(key, character);
                return true;
            }

            // If a slider is focused and editing, let it handle arrows
            if (focusedButton && focusedButton.editing) {
                focusedButton.keyTyped(key, character);
                return true;
            }

            if (key === "ArrowUp" || key === "ArrowDown") {
                let direction = key === "ArrowUp" ? -1 : 1;
                let startIndex = this.selectedButtonIndex;
                let nextIndex = startIndex;

                // Find next enabled button in the direction
                for (let attempts = 0; attempts < this.buttonList.length; attempts++) {
                    nextIndex += direction;
                    if (nextIndex < 0) nextIndex = this.buttonList.length - 1;
                    if (nextIndex >= this.buttonList.length) nextIndex = 0;
                    if (this.buttonList[nextIndex].isSelectable()) {
                        this.selectedButtonIndex = nextIndex;
                        this.updateFocusedButtons();
                        return true;
                    }
                }
                return true;
            }

            if (key === "Enter") {
                if (this.selectedButtonIndex >= 0 && this.selectedButtonIndex < this.buttonList.length) {
                    let button = this.buttonList[this.selectedButtonIndex];
                    if (button.isSelectable()) {
                        // Sliders: Enter toggles editing mode
                        if (typeof button.editing !== 'undefined') {
                            button.keyTyped(key, character);
                        } else {
                            button.mouseClicked(0, 0, 0);
                        }
                    }
                }
                return true;
            }
        }

        for (let i in this.buttonList) {
            let button = this.buttonList[i];

            button.keyTyped(key, character);
        }

        return false;
    }

    keyReleased(key) {
        for (let i in this.buttonList) {
            let button = this.buttonList[i];

            button.keyReleased(key);
        }

        return false;
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        const buttonList = this.buttonList;
        for (let i in buttonList) {
            let button = buttonList[i];

            if (button.isMouseOver(mouseX, mouseY)) {
                button.mouseClicked(mouseX, mouseY, mouseButton);
            }
        }
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        for (let i in this.buttonList) {
            let button = this.buttonList[i];

            button.mouseReleased(mouseX, mouseY, mouseButton);
        }
    }

    mouseDragged(mouseX, mouseY, mouseButton) {
        for (let i in this.buttonList) {
            let button = this.buttonList[i];

            button.mouseDragged(mouseX, mouseY, mouseButton);
        }
    }

    // Default no-op. Subclasses (e.g. GuiWorldSlotContainer) override this to
    // handle mouse wheel scrolling. `amount` is the wheel delta sign:
    //   positive => scroll up (content moves down)
    //   negative => scroll down (content moves up)
    mouseScrolled(mouseX, mouseY, amount) {

    }

    drawDefaultBackground(stack) {
        if (this.minecraft.isInGame()) {
            // Render transparent background
            this.drawRect(stack, 0, 0, this.width, this.height, 'black', 0.6);
        } else {
            // Render dirt background
            this.drawBackground(stack, this.textureBackground, this.width, this.height);
        }
    }
}
