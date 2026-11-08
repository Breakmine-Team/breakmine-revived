import GuiTooltip from "../../gui/widgets/GuiTooltip.js";

export default class ScreenRenderer {

    constructor(minecraft, window) {
        this.minecraft = minecraft;
        this.window = window;
    }

    initialize() {
        let scale = this.getLimitedScaleFactor();

        this.window.canvas.width = this.window.width * scale;
        this.window.canvas.height = this.window.height * scale;

        this.stack2d = this.window.canvas.getContext('2d');
        this.stack2d.webkitImageSmoothingEnabled = false;
        this.stack2d.mozImageSmoothingEnabled = false;
        this.stack2d.imageSmoothingEnabled = false;
    }

    render(partialTicks) {
        let scale = this.getLimitedScaleFactor();

        let mouseX = this.minecraft.window.mouseX;
        let mouseY = this.minecraft.window.mouseY;

        const actualScale = this.window.scaleFactor;
        const screen = this.minecraft.currentScreen;

        const itemsAboveScreen = screen !== null && screen.usesGuiItems?.() === true;

        this.stack2d.save();

        if (this.minecraft.isInGame()) {
            this.stack2d.drawImage(this.window.canvasWorld, 0, 0, this.window.width * scale, this.window.height * scale);
        } else {
            this.reset();
        }

        this.stack2d.scale(scale, scale, scale);

        try {
            if (this.minecraft.isInGame() && this.minecraft.loadingScreen === null) {
                this.minecraft.ingameOverlay.render(this.stack2d, mouseX, mouseY, partialTicks);
            }

            if (!itemsAboveScreen) {
                this.drawItemLayers(actualScale);
                this.renderHudLabels(mouseX, mouseY, partialTicks);
            }

            if (screen !== null) {
                screen.drawScreen(this.stack2d, mouseX, mouseY, partialTicks)
            }
        } catch (e) {
            console.error(e);
            console.log(e.stack);
        }

        if (itemsAboveScreen) {
            this.drawItemLayers(actualScale);
            this.renderHudLabels(mouseX, mouseY, partialTicks);
        }

        if (screen !== null && screen.renderPostItem) {
            screen.renderPostItem(this.stack2d, mouseX, mouseY, partialTicks);
        }

        if (screen !== null && screen.renderPostScreen) {
            screen.renderPostScreen(this.stack2d, mouseX, mouseY, partialTicks);
        }

        GuiTooltip.flush();

        this.stack2d.restore();
    }

    
    drawItemLayers(actualScale) {
        const itemRenderer = this.minecraft.itemRenderer;
        if (!itemRenderer) return;

        this.stack2d.scale(1 / actualScale, 1 / actualScale, 1 / actualScale);

        if (itemRenderer.hasBlockItems()) {
            this.stack2d.drawImage(this.window.canvasItems, 0, 0);
        }
        if (itemRenderer.canvas2d && itemRenderer.hasSprites()) {
            this.stack2d.drawImage(itemRenderer.canvas2d, 0, 0);
        }

        this.stack2d.scale(actualScale, actualScale, actualScale);
    }

    
    renderHudLabels(mouseX, mouseY, partialTicks) {
        const overlay = this.minecraft.ingameOverlay;
        if (!this.minecraft.isInGame() || !overlay || typeof overlay.renderPostItem !== 'function') {
            return;
        }

        overlay.renderPostItem(this.stack2d, mouseX, mouseY, partialTicks);
    }

    reset() {
        this.stack2d.clearRect(0, 0, this.window.canvas.width, this.window.canvas.height);
    }

    getLimitedScaleFactor() {
        return Math.min(this.window.scaleFactor, 4);
    }

}
