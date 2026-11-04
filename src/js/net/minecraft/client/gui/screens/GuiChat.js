import GuiScreen from "../GuiScreen.js";
import GuiTextField from "../widgets/GuiTextField.js";
import GuiTabScroll from "./GuiTabScroll.js";

export default class GuiChat extends GuiScreen {

    constructor(minecraft) {
        super();

        this.minecraft = minecraft;

        this.inputField = new GuiTextField(0, 0, 0, 0);
        this.inputField.renderBackground = false;

        this.historyIndex = -1;
    }

    init() {
        super.init();

        this.inputField.x = 2;
        this.inputField.y = this.height - 14;
        this.inputField.width = this.width - 4;
        this.inputField.height = 12;
        this.inputField.isFocused = true;
        this.inputField.alwaysFocused = true;

        this.buttonList.push(this.inputField);

        this.tabScroll = new GuiTabScroll(this.minecraft, this.inputField);
    }

    onClose() {
        super.onClose();
        this.minecraft.ingameOverlay.chatOverlay.setDirty();
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawRect(stack, 2, this.height - 14, this.width - 2, this.height - 2, '#000000', 0.5);

        this.tabScroll.update(this.inputField.getText());
        this.tabScroll.render(stack, mouseX, mouseY);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    keyTyped(key, character) {
        // Let tab scroll handle navigation / confirm first
        if (this.tabScroll.handleKey(key, character)) {
            return true;
        }

        if (key === "Enter") {
            let message = this.inputField.getText().trim();
            if (message.length === 0) {
                return;
            }

            this.minecraft.displayScreen(null);
            this.minecraft.ingameOverlay.chatOverlay.addMessageToSentHistory(message);
            this.minecraft.playerController.sendChatMessage(message);
            return;
        }

        if (!this.tabScroll.isActive) {
            if (key === "ArrowUp" || key === "ArrowDown") {
                let up = key === "ArrowUp";
                let history = this.minecraft.ingameOverlay.chatOverlay.sentHistory;

                if (up) {
                    if (this.historyIndex + 1 < history.length) {
                        this.historyIndex++;
                    }
                } else {
                    if (this.historyIndex >= 0) {
                        this.historyIndex--;
                    }
                }

                this.inputField.setText(this.historyIndex < 0 ? "" : history[this.historyIndex])
                return true;
            }
        }

        return super.keyTyped(key, character);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.tabScroll.isActive) {
            const idx = this.tabScroll.getHoveredIndex(mouseX, mouseY);
            if (idx >= 0 && idx < this.tabScroll.suggestions.length) {
                this.tabScroll.applySuggestion(this.tabScroll.suggestions[idx]);
                return;
            }
        }

        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

}