export default class GuiCapeUpload extends GuiScreen {
    constructor(service, previousScreen) {
        super();
        this.service = service;
        this.previousScreen = previousScreen;
        this.status = "Choose a cape atlas PNG (64×32 or 64×64).";
        this.fileInput = null;
        this.preview = null;
        this.animationMode = "idle";
        this.previewDragging = false;
        this.previewLastMouseX = 0;
    }

    init() {
        super.init();

        this._buildButtons();
        this.service.disposePlayerPreview(this.preview);
        this.preview = this.service.createPlayerPreview(92, 150);

        this.fileInput = document.createElement("input");
        this.fileInput.type = "file";
        this.fileInput.accept = "image/png";
        this.fileInput.style.display = "none";
        this.fileInput.addEventListener("change", async () => {
            const file = this.fileInput.files?.[0];
            if (!file) return;
            try {
                await this.service.setCapeFromFile(file);
                this.status = "Cape saved locally and added to Recent.";
                this._buildButtons();
            } catch (error) {
                this.status = error?.message || "Cape upload failed.";
            }
            this.fileInput.value = "";
        });
        document.body.appendChild(this.fileInput);
    }

    _buildButtons() {
        this.buttonList = [];

        const center = this._getControlCenter();
        const top = this.height / 2 - 36;
        this.buttonList.push(new GuiButton(this.minecraft, "Default Cape", center - 100, top, 98, 20, () => {
            try {
                this.service.useDefaultCape();
                this.status = "Default cape selected.";
            } catch (error) {
                this.status = error?.message || "Default cape failed to load.";
            }
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Upload PNG", center + 2, top, 98, 20, () => {
            this.fileInput?.click();
        }));

        const recentCapes = this.service.getRecentCapes();
        const recentWidth = 64;
        for (let index = 0; index < 3; index++) {
            const cape = recentCapes[index];
            const button = new GuiButton(
                this.minecraft,
                cape ? `Recent ${index + 1}` : "—",
                center - 100 + index * 68,
                top + 24,
                recentWidth,
                20,
                () => {
                    try {
                        this.service.selectRecentCape(index);
                        this.status = `Recent cape ${index + 1} selected.`;
                        this._buildButtons();
                    } catch (error) {
                        this.status = error?.message || "Recent cape failed to load.";
                    }
                }
            );
            button.setEnabled(Boolean(cape));
            this.buttonList.push(button);
        }

        this._addAnimationButtons(center, top);

        const compact = this.width >= 340;
        this.buttonList.push(new GuiButton(this.minecraft, "Remove cape", center - 100, top + (compact ? 52 : 80), 200, 20, () => {
            this.service.clearCape();
            this.status = "Cape removed.";
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Done", center - 100, top + (compact ? 80 : 108), 200, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
    }

    _addAnimationButtons(center, top) {
        const animations = [
            { mode: "idle", short: "I", label: "Idle" },
            { mode: "walk", short: "W", label: "Walk" },
            { mode: "sprint", short: "S", label: "Sprint" }
        ];
        const compact = this.width >= 340;
        const bounds = this._getPreviewBounds();

        for (let index = 0; index < animations.length; index++) {
            const animation = animations[index];
            const x = compact ? bounds.x - 24 : center - 34 + index * 24;
            const y = compact ? bounds.y + 43 + index * 24 : top + 52;
            const text = this.animationMode === animation.mode
                ? `[${animation.short}]`
                : animation.short;
            this.buttonList.push(new GuiButton(
                this.minecraft,
                text,
                x,
                y,
                20,
                20,
                () => {
                    this.animationMode = animation.mode;
                    this.status = `${animation.label} preview selected.`;
                    this._buildButtons();
                }
            ).setTooltip(animation.label));
        }
    }

    _getControlCenter() {
        return this.width >= 340 ? this.width / 2 + 62 : this.width / 2;
    }

    _getPreviewBounds() {
        return {
            x: Math.floor(this._getControlCenter() - 224),
            y: Math.floor(this.height / 2 - 78),
            width: this.preview?.width || 92,
            height: this.preview?.height || 150
        };
    }

    _isPreviewHovered(mouseX, mouseY) {
        if (!this.preview || this.width < 340) return false;
        const bounds = this._getPreviewBounds();
        return mouseX >= bounds.x && mouseX <= bounds.x + bounds.width
            && mouseY >= bounds.y && mouseY <= bounds.y + bounds.height;
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (mouseButton === 0 && this._isPreviewHovered(mouseX, mouseY)) {
            this.previewDragging = true;
            this.previewLastMouseX = mouseX;
            return;
        }
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.previewDragging) {
            this.service.rotatePlayerPreview(this.preview, mouseX - this.previewLastMouseX);
            this.previewLastMouseX = mouseX;
            return;
        }
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        this.previewDragging = false;
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawCenteredString(stack, "Cape Plus", this.width / 2, 45);
        const titleIcon = this.minecraft?.resources?.["gui/cape_plus/cape_icon"];
        if (titleIcon) {
            stack.save();
            stack.imageSmoothingEnabled = false;
            stack.drawImage(titleIcon, Math.floor(this.width / 2 + 29), 42, 14, 14);
            stack.restore();
        }
        this.drawCenteredString(stack, this.status, this.width / 2, this.height / 2 - 92);
        if (this.preview && this.width >= 340) {
            const bounds = this._getPreviewBounds();
            const localX = mouseX - (bounds.x + bounds.width / 2);
            const localY = mouseY - (bounds.y + bounds.height / 2);
            const hovered = this._isPreviewHovered(mouseX, mouseY) || this.previewDragging;
            this.service.renderPlayerPreview(this.preview, localX, localY, hovered, this.animationMode);
            stack.save();
            stack.imageSmoothingEnabled = false;
            stack.drawImage(this.preview.canvas, bounds.x, bounds.y, bounds.width, bounds.height);
            stack.restore();
            this.drawCenteredString(stack, "Hover: pause", bounds.x + bounds.width / 2, bounds.y + bounds.height + 1, 0xB0B0B0);
            this.drawCenteredString(stack, "Drag: rotate", bounds.x + bounds.width / 2, bounds.y + bounds.height + 11, 0xB0B0B0);
        }
        this.drawCenteredString(stack, "Cape PNG: 64×32 or 64×64", this._getControlCenter(), this.height / 2 + 72, 0xB0B0B0);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
        this.fileInput?.remove();
        this.fileInput = null;
        this.service.disposePlayerPreview(this.preview);
        this.preview = null;
        this.previewDragging = false;
    }
}
