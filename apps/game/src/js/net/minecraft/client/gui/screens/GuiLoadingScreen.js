import GuiScreen from "../GuiScreen.js";

export default class GuiLoadingScreen extends GuiScreen {

    constructor() {
        super();
        this.progress = 0;
    }

    init() {
        super.init();
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        // Render dirt background
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        // Render title
        this.drawCenteredString(stack, this.title, this.width / 2, this.height / 2 - 20);

        let progressWidth = 100;
        let progressHeight = 2;

        // Render background of progress
        this.drawRect(
            stack,
            this.width / 2 - progressWidth / 2,
            this.height / 2 - progressHeight / 2,
            this.width / 2 + progressWidth / 2,
            this.height / 2 + progressHeight / 2,
            '#808080',
        );

        // Render progress
        this.drawRect(
            stack,
            this.width / 2 - progressWidth / 2,
            this.height / 2 - progressHeight / 2,
            this.width / 2 - progressWidth / 2 + progressWidth * this.progress,
            this.height / 2 + progressHeight / 2,
            '#80ff80',
        );

        // Render progress percentage
        let percent = Math.floor(this.progress * 100);
        this.drawCenteredString(stack, percent + '%', this.width / 2, this.height / 2 + 6);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    setTitle(title) {
        this.title = title;
    }

    setProgress(progress) {
        if (progress < this.progress || progress > 1) {
            return;
        }
        this.progress = progress;
    }

    keyTyped(key) {
        // Cancel key inputs
    }
}