import GuiScreen from "../GuiScreen.js";
import { smoothLoadingProgress, loadingBarFillWidth, loadingBarBounds } from '../../../../../loading/LoadingProgress.mjs';

export default class GuiLoadingScreen extends GuiScreen {

    static loadingBackground = null;
    static loadingImage = null;

    constructor() {
        super();
        this.progress = 0;
        this.currentProgress = 0;
    }

    init() {
        super.init();
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.loadLoadingArtwork();
        const background = GuiLoadingScreen.loadingBackground;
        if (background?.complete && background.naturalWidth > 0) {
            // OptiFine loading.properties specifies scaleMode=stretch.
            stack.drawImage(background, 0, 0, this.width, this.height);
            this.drawRect(stack, 0, 0, this.width, this.height, '#000000', 0.28);
        } else {
            this.drawBackground(stack, this.textureBackground, this.width, this.height);
        }

        const { left, top, width: barWidth, height: barHeight } = loadingBarBounds(this.width, this.height);
        this.currentProgress = smoothLoadingProgress(this.currentProgress, this.progress);
        const image = GuiLoadingScreen.loadingImage;
        if (image?.complete && image.naturalWidth > 0) {
            const imageWidth = Math.min(this.width * .75, 498, this.height * 1.15);
            const imageHeight = imageWidth * 280 / 498;
            const x = (this.width - imageWidth) / 2;
            const y = (this.height - imageHeight) / 2;
            stack.save();
            stack.beginPath();
            stack.roundRect(x, y, imageWidth, imageHeight, Math.min(18, imageHeight / 2));
            stack.clip();
            stack.drawImage(image, x, y, imageWidth, imageHeight);
            stack.restore();
        }

        // the reference client LoadingOverlay: a thin white outline with a white,
        // smoothed fill near the bottom of the screen.
        this.drawRect(stack, left + 1, top, left + barWidth - 1, top + 1, '#ffffff');
        this.drawRect(stack, left + 1, top + barHeight - 1, left + barWidth - 1, top + barHeight, '#ffffff');
        this.drawRect(stack, left, top, left + 1, top + barHeight, '#ffffff');
        this.drawRect(stack, left + barWidth - 1, top, left + barWidth, top + barHeight, '#ffffff');
        const fillWidth = loadingBarFillWidth(barWidth, this.currentProgress);
        if (fillWidth > 0) {
            this.drawRect(stack, left + 2, top + 2, left + 2 + fillWidth, top + barHeight - 2, '#ffffff');
        }

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    loadLoadingArtwork() {
        if (typeof Image === 'undefined') return;
        if (!GuiLoadingScreen.loadingBackground) {
            GuiLoadingScreen.loadingBackground = new Image();
            GuiLoadingScreen.loadingBackground.src = 'src/resources/gui/loading/background.png';
        }
        if (!GuiLoadingScreen.loadingImage) {
            GuiLoadingScreen.loadingImage = new Image();
            GuiLoadingScreen.loadingImage.src = 'src/resources/gui/loading/steve-sunset.gif';
        }
    }

    setTitle(title) {
        this.title = title;
    }

    setProgress(progress) {
        if (Number.isFinite(progress)) this.progress = Math.max(0, Math.min(1, progress));
    }

    keyTyped(key) {
        // Cancel key inputs
    }
}
