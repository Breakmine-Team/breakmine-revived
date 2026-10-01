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

            // Render current screen
            if (this.minecraft.currentScreen !== null) {
                this.minecraft.currentScreen.drawScreen(this.stack2d, mouseX, mouseY, partialTicks)
            }
        } catch (e) {
            console.error(e);
            console.log(e.stack);
        }

        // Scale GUI back
        let actualScale = this.window.scaleFactor;
        this.stack2d.scale(1 / actualScale, 1 / actualScale, 1 / actualScale);

        // Render 3D block items
        this.stack2d.drawImage(this.window.canvasItems, 0, 0);
        // Render 2D item sprites (torches, etc.)
        let itemCanvas2d = this.minecraft.itemRenderer?.canvas2d;
        if (itemCanvas2d) {
            this.stack2d.drawImage(itemCanvas2d, 0, 0);
        }

        // Scale GUI again for post-screen rendering
        this.stack2d.scale(actualScale, actualScale, actualScale);

        if (this.minecraft.isInGame() && this.minecraft.ingameOverlay && this.minecraft.ingameOverlay.renderPostItem) {
            this.minecraft.ingameOverlay.renderPostItem(this.stack2d, mouseX, mouseY, partialTicks);
        }

        // Render post-item elements
        if (this.minecraft.currentScreen !== null && this.minecraft.currentScreen.renderPostItem) {
            this.minecraft.currentScreen.renderPostItem(this.stack2d, mouseX, mouseY, partialTicks);
        }

        // Render post-screen elements
        if (this.minecraft.currentScreen !== null && this.minecraft.currentScreen.renderPostScreen) {
            this.minecraft.currentScreen.renderPostScreen(this.stack2d, mouseX, mouseY, partialTicks);
        }

        this.stack2d.restore();
    }

    reset() {
        this.stack2d.clearRect(0, 0, this.window.canvas.width, this.window.canvas.height);
    }

    getLimitedScaleFactor() {
        return Math.min(this.window.scaleFactor, 4);
    }

}