import FontRenderer from "../../render/gui/FontRenderer.js";
import CommandRegistry from "../../command/CommandRegistry.js";
import { BlockRegistry } from "../../world/block/BlockRegistry.js";

export default class GuiTabScroll {

    static BASE_COMMANDS = [
        "help", "time", "tp", "gamemode", "util", "setblock", "place", "heal", "world", "give", "summon"
    ];

    static COMMAND_TREE = {
        "gamemode": ["survival", "creative", "spectator"],
        "time": {
            "set": ["day", "night"]
        },
        "heal": "players",
        "give": "blocks"
    };

    /** Built-in commands plus everything mods registered. */
    static commandNames() {
        return [...new Set([
            ...GuiTabScroll.BASE_COMMANDS,
            ...CommandRegistry.getAll().map(command => command.command)
        ])];
    }

    constructor(minecraft, inputField) {
        this.minecraft = minecraft;
        this.inputField = inputField;
        this.suggestions = [];
        this.selectedIndex = -1;
        this.isActive = false;
        this._lastSuggestionKey = "";
        this.scrollOffset = 0;
        this.maxVisible = 10;
    }

    update(text, force = false) {
        if (!text.startsWith("/")) {
            this._clear();
            return;
        }

        // Use text up to cursor position for autocomplete
        const cursorPos = this.inputField.cursorPosition;
        const textToCursor = text.substring(0, cursorPos);
        const parts = textToCursor.split(" ");
        const prevKey = this._lastSuggestionKey;

        if (parts.length === 1) {
            const partial = parts[0].substring(1).toLowerCase();

            if (partial.length === 0 && !force) {
                this._clear();
                return;
            }

            const names = GuiTabScroll.commandNames();
            this.suggestions = force
                ? names.slice()
                : names.filter(c => c.startsWith(partial));
            this.isActive = this.suggestions.length > 0 && (partial.length > 0 || force);
            if (!force) this._updateSelection(prevKey);
            return;
        }

        const cmd = parts[0].substring(1).toLowerCase();
        const cmdData = GuiTabScroll.COMMAND_TREE[cmd];

        // Special handling for summon command (has x y z entity structure)
        if (cmd === "summon") {
            if (parts.length > 4) {
                this._clear();
                return;
            }

            if (parts.length === 4) {
                this.suggestions = this._getEntityNames();
                if (!force && parts[3].length > 0) {
                    const entityPartial = parts[3].toLowerCase();
                    this.suggestions = this.suggestions.filter(e => e.toLowerCase().startsWith(entityPartial));
                }
                this.isActive = this.suggestions.length > 0;
                if (!force) this._updateSelection(prevKey);
                return;
            }

            this._clear();
            return;
        }

        if (!cmdData) {
            this._clear();
            return;
        }

        if (cmdData === "players") {
            if (parts.length > 2) {
                this._clear();
                return;
            }

            this.suggestions = this._getPlayerNames();
            if (!force && parts.length === 2 && parts[1].length > 0) {
                const namePartial = parts[1].toLowerCase();
                this.suggestions = this.suggestions.filter(n => n.toLowerCase().startsWith(namePartial));
            }

            this.isActive = this.suggestions.length > 0;
            if (!force) this._updateSelection(prevKey);
            return;
        }

        if (cmdData === "blocks") {
            if (parts.length > 2) {
                this._clear();
                return;
            }

            this.suggestions = this._getBlockNames();
            if (!force && parts.length === 2 && parts[1].length > 0) {
                const namePartial = parts[1].toLowerCase();
                this.suggestions = this.suggestions.filter(n => {
                    const lower = n.toLowerCase();
                    // Match if starts with partial, or if the name part (after colon) starts with partial
                    return lower.startsWith(namePartial) || lower.split(':')[1]?.startsWith(namePartial);
                });
            }

            this.isActive = this.suggestions.length > 0;
            if (!force) this._updateSelection(prevKey);
            return;
        }

        if (Array.isArray(cmdData)) {
            if (parts.length > 2) {
                this._clear();
                return;
            }

            this.suggestions = cmdData.slice();
            if (!force && parts.length === 2 && parts[1].length > 0) {
                const partial = parts[1].toLowerCase();
                this.suggestions = this.suggestions.filter(s => s.startsWith(partial));
            }

            this.isActive = this.suggestions.length > 0;
            if (!force) this._updateSelection(prevKey);
            return;
        }

        if (typeof cmdData === "object") {
            const subCmd = parts[1] ? parts[1].toLowerCase() : "";

            if (parts.length === 2) {
                const keys = Object.keys(cmdData);
                this.suggestions = force ? keys : (!subCmd ? keys : keys.filter(k => k.startsWith(subCmd)));
                this.isActive = this.suggestions.length > 0;
                if (!force) this._updateSelection(prevKey);
                return;
            }

            if (parts.length > 3) {
                this._clear();
                return;
            }

            const subData = cmdData[subCmd];
            if (!subData || !Array.isArray(subData)) {
                this._clear();
                return;
            }

            this.suggestions = force
                ? subData.slice()
                : (!parts[2] ? subData.slice() : subData.filter(s => s.startsWith(parts[2].toLowerCase())));

            this.isActive = this.suggestions.length > 0;
            if (!force) this._updateSelection(prevKey);
            return;
        }

        this._clear();
    }

    _updateSelection(prevKey) {
        const newKey = this.suggestions.join("\0");
        this._lastSuggestionKey = newKey;
        if (newKey !== prevKey && this.isActive) {
            this.selectedIndex = 0;
            this.scrollOffset = 0;
        }
    }

    _clear() {
        this.isActive = false;
        this.suggestions = [];
        this.selectedIndex = -1;
        this._lastSuggestionKey = "";
        this.scrollOffset = 0;
    }

    _getPlayerNames() {
        if (this.minecraft.isSingleplayer()) {
            return [this.minecraft.player.username];
        }

        try {
            const handler = this.minecraft.playerController?.getNetworkHandler?.();
            if (handler) {
                const playerMap = handler.getPlayerInfoMap();
                if (playerMap) {
                    const names = [];
                    for (const [uuid, info] of playerMap) {
                        if (info && info.profile) {
                            names.push(info.displayName || info.profile.getUsername());
                        }
                    }
                    if (names.length > 0) return names;
                }
            }
        } catch (e) {
        }

        return [this.minecraft.player.username];
    }

    _getBlockNames() {
        const names = [];
        // Get all registered block identifiers with namespace
        for (const [key, block] of BlockRegistry.registry) {
            // Include namespaced keys (e.g., "breakmine:tnt")
            if (key.includes(':')) {
                names.push(key);
            }
        }
        return names.sort();
    }

    _getEntityNames() {
        // Hardcoded list of summonable entities (matches SummonCommand.js)
        return ["creeper", "player"];
    }

    moveUp() {
        if (!this.isActive || this.suggestions.length === 0) return;
        this.selectedIndex--;
        if (this.selectedIndex < 0) {
            this.selectedIndex = this.suggestions.length - 1;
        }
        this._updateScrollOffset();
    }

    moveDown() {
        if (!this.isActive || this.suggestions.length === 0) return;
        this.selectedIndex = (this.selectedIndex + 1) % this.suggestions.length;
        this._updateScrollOffset();
    }

    _updateScrollOffset() {
        if (this.suggestions.length <= this.maxVisible) {
            this.scrollOffset = 0;
            return;
        }

        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
            this.scrollOffset = this.selectedIndex - this.maxVisible + 1;
        }
    }

    confirm() {
        if (!this.isActive || this.selectedIndex < 0 || this.selectedIndex >= this.suggestions.length) {
            return null;
        }
        return this.suggestions[this.selectedIndex];
    }

    applySuggestion(selection) {
        const text = this.inputField.getText();
        const cursorPos = this.inputField.cursorPosition;
        const textBeforeCursor = text.substring(0, cursorPos);
        const textAfterCursor = text.substring(cursorPos);
        const parts = textBeforeCursor.split(" ");

        if (parts.length === 1) {
            // Replace command name
            const newText = "/" + selection + " " + textAfterCursor;
            this.inputField.setText(newText);
            this.inputField.cursorPosition = newText.length - textAfterCursor.length;
        } else {
            // Special handling for summon command (entity is 4th argument)
            if (parts[0].toLowerCase() === "/summon" && parts.length === 4) {
                parts[3] = selection;
                const newText = parts.join(" ") + textAfterCursor;
                this.inputField.setText(newText);
                this.inputField.cursorPosition = newText.length - textAfterCursor.length;
            } else {
                // For blocks with namespace, replace the last part with full selection
                parts[parts.length - 1] = selection;
                const newText = parts.join(" ") + " " + textAfterCursor;
                this.inputField.setText(newText);
                this.inputField.cursorPosition = newText.length - textAfterCursor.length;
            }
        }

        this.update(this.inputField.getText());
    }

    getHoveredIndex(mouseX, mouseY) {
        if (!this.isActive) return -1;

        const inputY = this.inputField.y;
        const visibleCount = Math.min(this.suggestions.length, this.maxVisible);
        const boxHeight = visibleCount * FontRenderer.FONT_HEIGHT + 4;
        const boxY = inputY - 4 - boxHeight;

        const boxWidth = this._getBoxWidth();
        const boxX = this._getBoxX();

        if (mouseX < boxX || mouseX > boxX + boxWidth) return -1;

        const relY = mouseY - (boxY + 2);
        if (relY < 0 || relY >= visibleCount * FontRenderer.FONT_HEIGHT) return -1;

        const visibleIndex = Math.floor(relY / FontRenderer.FONT_HEIGHT);
        return this.scrollOffset + visibleIndex;
    }

    handleKey(key, character) {
        if (key === "Tab") {
            // Show suggestions if not active
            if (!this.isActive) {
                this.update(this.inputField.getText(), true);
                return true;
            }
            // Apply the selected suggestion if active
            const selection = this.confirm();
            if (selection !== null) {
                this.applySuggestion(selection);
                return true;
            }
            return false;
        }

        if (!this.isActive) return false;

        if (key === "ArrowUp") {
            this.moveUp();
            return true;
        }

        if (key === "ArrowDown") {
            this.moveDown();
            return true;
        }

        return false;
    }

    /** Screen X where the suggestion list starts: the beginning of the word being typed, kept inside the field. */
    _getBoxX() {
        const text = this.inputField.getText();
        const cursorPosition = Math.min(this.inputField.cursorPosition, text.length);

        // Start of the word the caret sits in, so the list lines up with the argument being completed
        const wordStart = Math.min(text.lastIndexOf(" ", cursorPosition - 1) + 1, cursorPosition);
        const wordOffset = this.minecraft.fontRenderer.getStringWidth(null, text.substring(0, wordStart));

        let textX;
        if (this.inputField.centered) {
            const textWidth = this.minecraft.fontRenderer.getStringWidth(null, text);
            textX = this.inputField.x + (this.inputField.width - textWidth) / 2;
        } else {
            textX = this.inputField.x + 2;
        }

        const fieldLeft = this.inputField.x + 2;
        const fieldRight = this.inputField.x + this.inputField.width;
        const maxX = Math.max(fieldLeft, fieldRight - this._getBoxWidth());
        return Math.min(Math.max(textX + wordOffset, fieldLeft), maxX);
    }

    _getBoxWidth() {
        let maxW = 0;
        for (const s of this.suggestions) {
            const w = this.minecraft.fontRenderer.getStringWidth(null, s);
            if (w > maxW) maxW = w;
        }
        return maxW + 8;
    }

    render(stack, mouseX, mouseY) {
        if (!this.isActive || this.suggestions.length === 0) return;

        const inputY = this.inputField.y;
        const visibleCount = Math.min(this.suggestions.length, this.maxVisible);
        const boxHeight = visibleCount * FontRenderer.FONT_HEIGHT + 4;
        const boxWidth = this._getBoxWidth();
        const boxX = this._getBoxX();
        const boxY = inputY - 4 - boxHeight;

        const hoveredIdx = this.getHoveredIndex(mouseX, mouseY);
        if (hoveredIdx >= 0) {
            this.selectedIndex = hoveredIdx;
        }

        stack.fillStyle = '#000000';
        stack.fillRect(boxX, boxY, boxWidth, boxHeight);

        // Render visible suggestions based on scroll offset
        for (let i = 0; i < visibleCount; i++) {
            const actualIndex = this.scrollOffset + i;
            if (actualIndex >= this.suggestions.length) break;

            const y = boxY + 2 + i * FontRenderer.FONT_HEIGHT;
            const color = actualIndex === this.selectedIndex ? 0xFFFF00 : 0xAAAAAA;
            this.minecraft.fontRenderer.drawString(stack, this.suggestions[actualIndex], boxX + 4, y, color, false);
        }

        // Draw scroll indicators (checkerboard pattern) if there are more items
        if (this.suggestions.length > this.maxVisible) {
            // Top indicator (checkerboard pattern if can scroll up)
            if (this.scrollOffset > 0) {
                for (let x = 0; x < boxWidth; x++) {
                    for (let y = 0; y < 1; y++) {
                        if ((x + y) % 2 === 1) {
                            stack.fillStyle = '#FFFFFF';
                            stack.fillRect(boxX + x, boxY + y, 1, 1);
                        }
                    }
                }
            }

            // Bottom indicator (checkerboard pattern if can scroll down)
            if (this.scrollOffset + this.maxVisible < this.suggestions.length) {
                for (let x = 0; x < boxWidth; x++) {
                    for (let y = 0; y < 1; y++) {
                        if ((x + y) % 2 === 1) {
                            stack.fillStyle = '#FFFFFF';
                            stack.fillRect(boxX + x, boxY + boxHeight - 1 + y, 1, 1);
                        }
                    }
                }
            }
        }
    }
}
