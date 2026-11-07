export default class ScreenRenderer {

    constructor(minecraft, window) {
        this.minecraft = minecraft;
        this.window = window;
    }

    initialize() {
        let scale = this.getLimitedScaleFactor();

        // Update camera size
        this.window.canvas.width = this.window.width * scale;
        this.window.canvas.height = this.window.height * scale;

        // Get context stack of 2d canvas
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

        // The item layers hold the hotbar's 3D block models and its sprites.
        // They used to be composited after the current screen unconditionally,
        // which painted them over the chat bar and every menu. They belong
        // under the screen - except for container screens, which place their
        // own slot items and cursor stack in those same layers.
        const itemsAboveScreen = screen !== null && screen.usesGuiItems?.() === true;

        this.stack2d.save();

        // Draw world to canvas
        if (this.minecraft.isInGame()) {
            this.stack2d.drawImage(this.window.canvasWorld, 0, 0, this.window.width * scale, this.window.height * scale);
        } else {
            this.reset();
        }

        // Scale GUI
        this.stack2d.scale(scale, scale, scale);

        try {
            // Render in-game overlay
            if (this.minecraft.isInGame() && this.minecraft.loadingScreen === null) {
                this.minecraft.ingameOverlay.render(this.stack2d, mouseX, mouseY, partialTicks);
            }

            // HUD item layers and their labels, kept under the screen.
            if (!itemsAboveScreen) {
                this.drawItemLayers(actualScale);
                this.renderHudLabels(mouseX, mouseY, partialTicks);
            }

            // Render current screen
            if (screen !== null) {
                screen.drawScreen(this.stack2d, mouseX, mouseY, partialTicks)
            }
        } catch (e) {
            console.error(e);
            console.log(e.stack);
        }

        // Screens that place their own items: the layers belong above them.
        if (itemsAboveScreen) {
            this.drawItemLayers(actualScale);
            this.renderHudLabels(mouseX, mouseY, partialTicks);
        }

        // Render post-item elements
        if (screen !== null && screen.renderPostItem) {
            screen.renderPostItem(this.stack2d, mouseX, mouseY, partialTicks);
        }

        // Render post-screen elements
        if (screen !== null && screen.renderPostScreen) {
            screen.renderPostScreen(this.stack2d, mouseX, mouseY, partialTicks);
        }

        this.stack2d.restore();
    }

    /**
     * Composite the 3D item models and the 2D item sprites. Both canvases carry
     * their own resolution, so the GUI transform is divided out for the blit
     * and put back afterwards, leaving the context in GUI units.
     */
    drawItemLayers(actualScale) {
        const itemRenderer = this.minecraft.itemRenderer;
        if (!itemRenderer) return;

        this.stack2d.scale(1 / actualScale, 1 / actualScale, 1 / actualScale);

        // Both layers are window-sized, so compositing one that holds nothing
        // is a wasted full-screen blit.
        if (itemRenderer.hasBlockItems()) {
            this.stack2d.drawImage(this.window.canvasItems, 0, 0);
        }
        if (itemRenderer.canvas2d && itemRenderer.hasSprites()) {
            this.stack2d.drawImage(itemRenderer.canvas2d, 0, 0);
        }

        this.stack2d.scale(actualScale, actualScale, actualScale);
    }

    /**
     * HUD text that sits on top of the item layers (item counts). Drawn next to
     * them so it follows them under an open screen instead of floating above
     * it.
     */
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
