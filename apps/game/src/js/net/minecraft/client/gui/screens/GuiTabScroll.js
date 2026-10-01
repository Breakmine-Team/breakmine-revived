import FontRenderer from "../../render/gui/FontRenderer.js";

export default class GuiTabScroll {

    static BASE_COMMANDS = [
        "help", "time", "tp", "gamemode", "util", "setblock", "place", "heal", "world"
    ];

    static COMMAND_TREE = {
        "gamemode": ["survival", "creative", "spectator"],
        "time": {
            "set": ["day", "night"]
        },
        "heal": "players"
    };

    constructor(minecraft, inputField) {
        this.minecraft = minecraft;
        this.inputField = inputField;
        this.suggestions = [];
        this.selectedIndex = -1;
        this.isActive = false;
        this._lastSuggestionKey = "";
    }

    update(text, force = false) {
        if (!text.startsWith("/")) {
            this._clear();
            return;
        }

        const parts = text.split(" ");
        const prevKey = this._lastSuggestionKey;

        if (parts.length === 1) {
            const partial = parts[0].substring(1).toLowerCase();

            if (partial.length === 0 && !force) {
                this._clear();
                return;
            }

            this.suggestions = force
                ? GuiTabScroll.BASE_COMMANDS.slice()
                : GuiTabScroll.BASE_COMMANDS.filter(c => c.startsWith(partial));
            this.isActive = this.suggestions.length > 0 && (partial.length > 0 || force);
            if (!force) this._updateSelection(prevKey);
            return;
        }

        const cmd = parts[0].substring(1).toLowerCase();
        const cmdData = GuiTabScroll.COMMAND_TREE[cmd];

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
        }
    }

    _clear() {
        this.isActive = false;
        this.suggestions = [];
        this.selectedIndex = -1;
        this._lastSuggestionKey = "";
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

    moveUp() {
        if (!this.isActive || this.suggestions.length === 0) return;
        this.selectedIndex--;
        if (this.selectedIndex < 0) {
            this.selectedIndex = this.suggestions.length - 1;
        }
    }

    moveDown() {
        if (!this.isActive || this.suggestions.length === 0) return;
        this.selectedIndex = (this.selectedIndex + 1) % this.suggestions.length;
    }

    confirm() {
        if (!this.isActive || this.selectedIndex < 0 || this.selectedIndex >= this.suggestions.length) {
            return null;
        }
        return this.suggestions[this.selectedIndex];
    }

    applySuggestion(selection) {
        const text = this.inputField.getText();
        const parts = text.split(" ");

        if (parts.length === 1) {
            this.inputField.setText("/" + selection + " ");
        } else {
            parts[parts.length - 1] = selection;
            this.inputField.setText(parts.join(" ") + " ");
        }

        this.update(this.inputField.getText());
    }

    getHoveredIndex(mouseX, mouseY) {
        if (!this.isActive) return -1;

        const inputY = this.inputField.y;
        const boxHeight = this.suggestions.length * FontRenderer.FONT_HEIGHT + 4;
        const boxY = inputY - 4 - boxHeight;

        const boxWidth = this._getBoxWidth();

        if (mouseX < 2 || mouseX > 2 + boxWidth) return -1;

        const relY = mouseY - (boxY + 2);
        if (relY < 0 || relY >= this.suggestions.length * FontRenderer.FONT_HEIGHT) return -1;

        return Math.floor(relY / FontRenderer.FONT_HEIGHT);
    }

    handleKey(key, character) {
        if (key === "Tab") {
            this.update(this.inputField.getText(), true);
            if (this.isActive) {
                this.moveDown();
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

        if (key === "Enter") {
            const selection = this.confirm();
            if (selection !== null) {
                this.applySuggestion(selection);
                return true;
            }
        }

        return false;
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
        const boxHeight = this.suggestions.length * FontRenderer.FONT_HEIGHT + 4;
        const boxWidth = this._getBoxWidth();
        const boxX = 2;
        const boxY = inputY - 4 - boxHeight;

        const hoveredIdx = this.getHoveredIndex(mouseX, mouseY);
        if (hoveredIdx >= 0) {
            this.selectedIndex = hoveredIdx;
        }

        stack.fillStyle = '#000000';
        stack.fillRect(boxX, boxY, boxWidth, boxHeight);

        for (let i = 0; i < this.suggestions.length; i++) {
            const y = boxY + 2 + i * FontRenderer.FONT_HEIGHT;
            const color = i === this.selectedIndex ? 0xFFFF00 : 0xAAAAAA;
            this.minecraft.fontRenderer.drawString(stack, this.suggestions[i], boxX + 4, y, color, false);
        }
    }
}
