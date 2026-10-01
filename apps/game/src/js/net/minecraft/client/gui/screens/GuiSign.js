import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiTextField from "../widgets/GuiTextField.js";
import ClientUpdateSignTextPacket from "../../network/packet/play/client/ClientUpdateSignTextPacket.js";
import BlockPosition from "../../../util/BlockPosition.js";

export default class GuiSign extends GuiScreen {

    constructor(player, blockPosition) {
        super();
        this.player = player;
        this.blockPosition = blockPosition;
        this.signText = "";
    }

    init() {
        super.init();

        // Clear button list to ensure fresh state
        this.buttonList = [];

        // Load sign texture from resources
        this.textureSign = this.minecraft.resources["terrain/pack/minecraft/textures/blocks/oak_planks.png"];

        // Load existing sign text if any
        if (this.player.world && this.player.world.blockInventories) {
            const key = `${this.blockPosition.x},${this.blockPosition.y},${this.blockPosition.z}`;
            const signData = this.player.world.blockInventories.get(key);
            if (signData && signData.text) {
                this.signText = signData.text;
            } else {
                this.signText = "";
            }
        } else {
            this.signText = "";
        }

        // Split existing text into lines (max 4 lines)
        const lines = this.signText.split('\n', 4);
        while (lines.length < 4) {
            lines.push("");
        }

        // Create 4 text fields for sign content
        this.textFields = [];
        const signHeight = 50;
        const signWidth = Math.floor(signHeight * (1 / 0.5625)); // ~85 pixels
        const signY = this.height / 2 - signHeight / 2;
        const totalTextHeight = 4 * 10; // 4 lines with 10px spacing
        const startY = signY + (signHeight - totalTextHeight) / 2 + 2; // Center on sign texture
        const fieldWidth = Math.floor(signWidth * 0.8); // Scale to fit sign width
        for (let i = 0; i < 4; i++) {
            const textField = new GuiTextField(this.width / 2 - fieldWidth / 2, startY + i * 10, fieldWidth, 10);
            textField.setText(lines[i]);
            textField.maxLength = 25; // Limit per line
            textField.isFocused = (i === 0);
            textField.cursorPosition = lines[i].length;
            textField.renderBackground = false; // Remove background
            textField.centered = true; // Center text
            textField.noShadow = true; // No shadow for sign text
            this.buttonList.push(textField);
            this.textFields.push(textField);
        }

        // Save button
        this.buttonSave = new GuiButton(this.minecraft, "Save", this.width / 2 - 50, this.height / 2 + 60, 100, 20, () => {
            this.saveSign();
        });
        this.buttonList.push(this.buttonSave);
    }

    saveSign() {
        // Combine all text fields into single text with newlines
        this.signText = this.textFields.map(tf => tf.getText()).join('\n').trim();
        
        // Store sign text in world
        if (this.player.world) {
            if (!this.player.world.blockInventories) {
                this.player.world.blockInventories = new Map();
            }
            
            const key = `${this.blockPosition.x},${this.blockPosition.y},${this.blockPosition.z}`;
            this.player.world.blockInventories.set(key, {
                text: this.signText
            });

            // Update sign text rendering
            if (this.minecraft.worldRenderer.signTextRenderer) {
                this.minecraft.worldRenderer.signTextRenderer.updateSign(
                    this.player.world,
                    this.blockPosition.x,
                    this.blockPosition.y,
                    this.blockPosition.z
                );
            }

            // Send sign text update to server if connected
            if (!this.minecraft.isSingleplayer()) {
                const nm = this.minecraft.playerController?.getNetworkHandler?.()?.getNetworkManager?.();
                if (nm) {
                    const blockPos = new BlockPosition(this.blockPosition.x, this.blockPosition.y, this.blockPosition.z);
                    const packet = new ClientUpdateSignTextPacket(blockPos, this.signText);
                    nm.sendPacket(packet);
                }
            } else {
                // Trigger immediate save in singleplayer
                this.minecraft.saveWorld();
            }
        }

        // Close the GUI
        this.minecraft.displayScreen(null);
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        
        // Draw sign background with 8:16 aspect ratio
        const signHeight = 50; // ~44 pixels
        const signWidth = Math.floor(signHeight * (1 / 0.5625)); // ~85 pixels
        const signX = this.width / 2 - signWidth / 2;
        const signY = this.height / 2 - signHeight / 2;
        
        // Draw sign background using loaded texture
        if (this.textureSign) {
            this.drawSprite(stack, this.textureSign, 0, 0, 16, 8, signX, signY, signWidth, signHeight);
        } else {
            // Fallback to colored rectangles
            this.drawRect(stack, signX, signY, signX + signWidth, signY + signHeight, '#C6A664');
            this.drawRect(stack, signX + 2, signY + 2, signX + signWidth - 2, signY + signHeight - 2, '#8B7355');
        }
        
        // Draw title
        this.drawCenteredString(stack, "Sign Editor", this.width / 2, this.height / 2 - 65);
        
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    keyTyped(key, character) {
        super.keyTyped(key, character);
        
        // Allow moving between lines with Tab
        if (key === "Tab") {
            const currentField = this.textFields.find(tf => tf.isFocused);
            if (currentField) {
                const currentIndex = this.textFields.indexOf(currentField);
                currentField.isFocused = false;
                const nextIndex = (currentIndex + 1) % this.textFields.length;
                this.textFields[nextIndex].isFocused = true;
                this.textFields[nextIndex].cursorPosition = this.textFields[nextIndex].text.length;
            }
            return true;
        }

        // Allow saving with Enter key (only on last line)
        if (key === "Enter") {
            const currentField = this.textFields.find(tf => tf.isFocused);
            if (currentField && this.textFields.indexOf(currentField) === 3) {
                this.saveSign();
                return true;
            }
            // Otherwise move to next line
            if (currentField) {
                const currentIndex = this.textFields.indexOf(currentField);
                if (currentIndex < 3) {
                    currentField.isFocused = false;
                    this.textFields[currentIndex + 1].isFocused = true;
                    this.textFields[currentIndex + 1].cursorPosition = this.textFields[currentIndex + 1].text.length;
                }
            }
            return true;
        }
        
        // Allow closing with Escape
        if (key === "Escape") {
            this.minecraft.displayScreen(null);
            return true;
        }
        
        return false;
    }
}
