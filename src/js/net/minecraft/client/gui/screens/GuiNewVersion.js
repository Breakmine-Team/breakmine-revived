import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import { stripGitHash, isPackagedApp } from "../../VersionChecker.js";

/**
 * Shown when the main menu's update check finds a newer build.
 *
 * The version data is passed in by the caller rather than fetched here. This
 * screen used to `import` version.js straight from a remote URL, which meant
 * the screen could not even load if that host was down, unreachable or slow.
 */
export default class GuiVersion extends GuiScreen {

    constructor(updateInfo = {}, parentScreen = null) {
        super();

        this.parentScreen = parentScreen;

        // Show "4.8.5a", never the "-1109693" build hash.
        this.latest = stripGitHash(updateInfo.latest || "");
        this.current = stripGitHash(updateInfo.current || "");

        this.isPackaged = isPackagedApp();
        this.updating = false;
        this.statusLines = [];

        this.templateText =
            `A new version of Breakmine is available: ${this.latest}\n`
            + `You are running: ${this.current}\n`
            + `\n`
            + (this.isPackaged
                ? "Breakmine will download and build the new version for you.\n"
                + "This takes a few minutes and needs Node and npm; the game\n"
                + "will close by itself when the update is installed.\n"
                : "Click 'Update now' to download the new version and reload.\n");
    }

    init() {
        super.init();

        this.buttonList.push(new GuiButton(this.minecraft, "Back", this.width / 2 - 155, this.height - 28, 150, 20, () => {
            // Do not let the user walk away from an install in progress.
            if (this.updating) return;
            this.minecraft.displayScreen(this.parentScreen);
        }));

        this.updateButton = new GuiButton(this.minecraft, "Update now", this.width / 2 + 5, this.height - 28, 150, 20, () => {
            this.startUpdate();
        });
        this.buttonList.push(this.updateButton);

        this.unsubscribe = window.modsBridge?.onUpdateStatus?.((status) => {
            this.onUpdateStatus(status);
        }) || null;
    }

    onUpdateStatus(status) {
        if (!status || !status.message) return;

        // The installer is chatty; keep the tail so the box cannot overflow.
        this.statusLines.push(status.message);
        if (this.statusLines.length > 12) this.statusLines.shift();

        if (status.phase === 'error') {
            this.updating = false;
            this.templateText = `The update failed.\n\n${status.message}`;
        } else if (status.phase === 'done') {
            this.templateText = `${status.message}\n\n`
                + this.statusLines.slice(-6).join('\n');
        }
    }

    async startUpdate() {
        if (this.updating) return;

        if (!this.isPackaged) {
            location.reload();
            return;
        }

        this.updating = true;
        if (this.updateButton) this.updateButton.setEnabled(false);
        this.templateText = "Starting the update...\n\nThe installer output will appear here.";

        const result = await window.modsBridge.selfUpdate({ ref: 'main' });
        if (result && !result.started) {
            this.updating = false;
            if (this.updateButton) this.updateButton.setEnabled(true);
            this.templateText = `Could not start the update.\n\n${result.reason}`;
        }
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawBackground(stack, this.textureBackground, this.width, this.height);

        this.drawCenteredString(stack, "Version Update", this.width / 2, 20, 0x80FFFFFF);

        let fontRenderer = this.minecraft.fontRenderer || this.minecraft.getFontRenderer?.();
        if (fontRenderer) {
            let lines = (this.templateText || '').split('\n');
            // Live installer output, while an update is running.
            if (this.updating && this.statusLines.length) {
                lines = lines.concat(['']).concat(this.statusLines);
            }

            let lineHeight = 10;
            let paddingLeftRight = 5;
            let paddingTopBottom = 5;

            let boxLeft = 10;
            let boxTop = 40;
            let boxRight = this.width - 10;
            let boxBottom = this.height - 38;

            this.drawRect(stack, boxLeft, boxTop, boxRight, boxBottom, 0x202020, 0.6);

            let textX = boxLeft + paddingLeftRight;
            let startY = boxTop + paddingTopBottom;

            // Only draw lines that fit, so the status tail stays visible.
            let maxLines = Math.max(
                0,
                Math.floor((boxBottom - paddingTopBottom - startY) / lineHeight)
            );
            for (let i = Math.max(0, lines.length - maxLines); i < lines.length; i++) {
                this.drawString(stack, lines[i], textX, startY + (i * lineHeight), 0xFFFFFFFF);
            }
        }

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }
}