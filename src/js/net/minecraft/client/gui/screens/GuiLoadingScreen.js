import GuiScreen from "../GuiScreen.js";
import { LoadingTips } from "../../../../../../resources/tips.js";

export default class GuiLoadingScreen extends GuiScreen {

    constructor() {
        super();
        this.progress = 0;
        this.title = "Loading terrain...";
        this.tip = LoadingTips.generateTip();
        this.tipTimer = 0;
        this.tipInterval = 5000; 
    }

    init() {
        super.init();
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        this.drawCenteredString(stack, this.title, this.width / 2, this.height / 2 - 20);

        let progressWidth = 100;
        let progressHeight = 2;

        this.drawRect(
            stack,
            this.width / 2 - progressWidth / 2,
            this.height / 2 - progressHeight / 2,
            this.width / 2 + progressWidth / 2,
            this.height / 2 + progressHeight / 2,
            '#808080',
        );

        this.drawRect(
            stack,
            this.width / 2 - progressWidth / 2,
            this.height / 2 - progressHeight / 2,
            this.width / 2 - progressWidth / 2 + progressWidth * this.progress,
            this.height / 2 + progressHeight / 2,
            '#80ff80',
        );

        let percent = Math.floor(this.progress * 100);
        this.drawCenteredString(stack, percent + '%', this.width / 2, this.height / 2 + 6);

        if (this.tip) {
            this.drawCenteredString(stack, this.tip, this.width / 2, this.height / 2 + 24, 0xAAAAAA);
        }

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    setTitle(title) {
        if (typeof title === 'string' && title.length > 0) {
            this.title = title;
        }
    }

    setProgress(progress) {
        if (progress < this.progress || progress > 1) {
            return;
        }
        this.progress = progress;
    }

    updateScreen() {
        super.updateScreen();

        this.tipTimer += 16; 

        if (this.tipTimer >= this.tipInterval) {
            this.tip = LoadingTips.generateTip();
            this.tipTimer = 0;
        }
    }

    keyTyped(key) {
    }
}