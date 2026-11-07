import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiPasswordField from "../widgets/GuiPasswordField.js";
import GuiTextField from "../widgets/GuiTextField.js";
import GuiWaitForCompletion from "./GuiWaitForCompletion.js";
import GuiYesNo from "./GuiYesNo.js";
import GuiPlayerPreview from "../widgets/GuiPlayerPreview.js";
import * as AuthLib from "../../network/AuthLib.js";
import PlayerRenderer from "../../render/entity/entity/PlayerRenderer.js";
import { ICON_UPLOAD } from "../../render/gui/FontIcons.js";

const ANIMATION_MODES = [
    { key: "normal", label: "N", tooltip: "Normal animation" },
    { key: "walk", label: "W", tooltip: "Walk animation" },
    { key: "run", label: "R", tooltip: "Run animation" },
];

class GuiAnimationButton extends GuiButton {

    constructor(minecraft, label, x, y, width, height, callback) {
        super(minecraft, label, x, y, width, height, callback);
        this.selected = false;
    }

    setSelected(selected) {
        this.selected = !!selected;
        return this;
    }
}

export default class GuiAccount extends GuiScreen {

    constructor(parentScreen) {
        super();
        this.parentScreen = parentScreen;
        this.previousScreen = parentScreen;
        this.errorMessage = "";
        this.animationMode = "normal";
        this.layout = null;
        this.loginLayout = null;
        this.loginUsernameValue = "";
        this.playerPreview = null;
        this.animationButtons = [];
        this.uploadSkinButton = null;
    }

    init() {
        super.init();

        this.layout = this.calculateLayout();

        if (!AuthLib.getAuthToken() && this.minecraft.settings.token) {
            AuthLib.saveAuthToken(this.minecraft.settings.token);
        }

        this.initPlayerPreview();
        this.initTopControls();

        if (this.minecraft.settings.loggedIn) {
            this.initSignOutButton();
        } else {
            this.initLoginForm();
        }

        this.updateUploadButton();
    }

    calculateLayout() {
        const margin = Math.max(12, Math.round(this.width * 0.024));
        const gap = Math.max(12, Math.round(this.width * 0.028));
        const available = this.width - margin * 2 - gap;

        let rightWidth = this.width < 560
            ? Math.round(available / 2)
            : Math.round(available * 0.42);
        rightWidth = Math.max(120, Math.min(rightWidth, available - 160));
        const leftWidth = available - rightWidth;

        const leftX = margin;
        const rightX = leftX + leftWidth + gap;
        const panelTop = Math.max(46, Math.min(60, Math.round(this.height * 0.12)));
        const controlsY = Math.max(8, panelTop - 26);
        const rightBottom = this.height - 20;
        const signOutY = rightBottom - 20;

        return {
            margin,
            gap,
            leftX,
            leftWidth,
            leftBottom: signOutY - 10,
            rightX,
            rightWidth,
            rightBottom,
            panelTop,
            controlsY,
            signOutY,
        };
    }

    initPlayerPreview() {
        if (this.playerPreview) {
            this.playerPreview.dispose();
        }

        this.playerPreview = new GuiPlayerPreview(this.minecraft);
        this.playerPreview.setAnimationMode(this.animationMode);
        this.playerPreview.init();
    }

    initTopControls() {
        const layout = this.layout;
        const size = 20;
        const gap = 4;

        this.uploadSkinButton = new GuiButton(this.minecraft, ICON_UPLOAD, layout.rightX, layout.controlsY, size, size, () => {
            this.handleUploadSkin();
        });
        this.buttonList.push(this.uploadSkinButton);

        const totalWidth = ANIMATION_MODES.length * size + (ANIMATION_MODES.length - 1) * gap;
        const startX = layout.rightX + layout.rightWidth - totalWidth;
        this.animationButtons = [];

        for (let i = 0; i < ANIMATION_MODES.length; i++) {
            const mode = ANIMATION_MODES[i];
            const button = new GuiAnimationButton(
                this.minecraft,
                mode.label,
                startX + i * (size + gap),
                layout.controlsY,
                size,
                size,
                () => this.selectAnimationMode(mode.key)
            ).setTooltip(mode.tooltip);

            button.mode = mode.key;
            button.plainLabel = mode.label;
            this.animationButtons.push(button);
            this.buttonList.push(button);
        }

        this.updateAnimationButtons();
    }

    initSignOutButton() {
        const layout = this.layout;
        const gap = 4;
        const signOutWidth = Math.floor((layout.leftWidth - gap) / 2);
        const backWidth = layout.leftWidth - gap - signOutWidth;

        this.buttonList.push(new GuiButton(this.minecraft, "Sign Out", layout.leftX, layout.signOutY, signOutWidth, 20, () => {
            this.confirmSignOut();
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Back", layout.leftX + signOutWidth + gap, layout.signOutY, backWidth, 20, () => {
            this.minecraft.displayScreen(this.parentScreen);
        }));
    }

    confirmSignOut() {
        this.minecraft.displayScreen(new GuiYesNo(
            this,
            "Are you sure you want to sign out?",
            "You can sign back in at any time.",
            "Sign Out",
            "Cancel",
            () => this.handleLogout()
        ));
    }

    initLoginForm() {
        const layout = this.layout;
        const formWidth = Math.max(140, Math.min(260, layout.leftWidth - 40));
        const formX = layout.leftX + Math.floor((layout.leftWidth - formWidth) / 2);
        const panelHeight = layout.leftBottom - layout.panelTop;
        const contentHeight = 194;
        const top = layout.panelTop + Math.max(24, Math.floor((panelHeight - contentHeight) / 2));

        this.loginLayout = {
            x: formX,
            width: formWidth,
            top,
            usernameLabelY: top + 44,
            usernameY: top + 54,
            passwordLabelY: top + 86,
            passwordY: top + 96,
            actionY: top + 130,
            backY: top + 156,
            statusY: top + 186,
        };

        this.fieldUsername = new GuiTextField(formX, top + 54, formWidth, 20);
        this.fieldPassword = new GuiPasswordField(formX, top + 96, formWidth, 20);
        this.fieldUsername.maxLength = 20;
        this.fieldUsername.text = this.loginUsernameValue;
        this.fieldUsername.cursorPosition = this.fieldUsername.text.length;

        this.actionButton = new GuiButton(this.minecraft, "Login or Register", formX, top + 130, formWidth, 20, () => {
            this.handleLogin();
        });

        const backButton = new GuiButton(this.minecraft, "Back", formX, top + 156, formWidth, 20, () => {
            this.minecraft.displayScreen(this.parentScreen);
        });

        this.buttonList.push(this.fieldUsername);
        this.buttonList.push(this.fieldPassword);
        this.buttonList.push(this.actionButton);
        this.buttonList.push(backButton);
    }

    updateUploadButton() {
        if (!this.uploadSkinButton) return;

        const loggedIn = Boolean(this.minecraft?.settings?.loggedIn);
        this.uploadSkinButton.enabled = loggedIn;
        this.uploadSkinButton.setTooltip(loggedIn ? "Upload skin" : "Sign in to upload a skin");
    }

    updateAnimationButtons() {
        for (const button of this.animationButtons) {
            const selected = button.mode === this.animationMode;
            button.setSelected(selected);
            button.string = selected ? button.plainLabel : `§7${button.plainLabel}`;
        }

        if (this.playerPreview) {
            this.playerPreview.setAnimationMode(this.animationMode);
        }
    }

    selectAnimationMode(mode) {
        this.animationMode = mode;
        this.updateAnimationButtons();
    }

    getCurrentUsername() {
        const session = this.minecraft && this.minecraft.getSession ? this.minecraft.getSession() : null;
        const profile = session && session.getProfile ? session.getProfile() : null;
        if (profile && profile.username) {
            return profile.username;
        }
        return this.minecraft && this.minecraft.settings ? this.minecraft.settings.username : "";
    }

    handleUploadSkin() {
        if (!this.minecraft.settings.loggedIn) return;

        const username = this.getCurrentUsername();
        if (!username || !AuthLib.getAuthToken()) {
            this.errorMessage = "Your session expired. Please sign in again.";
            return;
        }

        this.minecraft.displayScreen(new GuiWaitForCompletion(this, "Uploading skin...", async () => {
            try {
                await AuthLib.uploadSkinForUser(username);
                PlayerRenderer.invalidateSkinCache(username);
                this.errorMessage = "Skin uploaded";
            } catch (error) {
                if (!String(error.message).includes("cancelled by user")) {
                    this.errorMessage = this.formatError(error);
                }
            }
        }));
    }

    async handleLogin() {
        const username = this.fieldUsername.text.trim();
        const password = this.fieldPassword.text.trim();
        this.errorMessage = "";

        if (!username || !password) {
            this.errorMessage = "Username and password cannot be empty.";
            return;
        }

        if (username.includes(" ")) {
            this.errorMessage = "Username cannot have spaces";
            return;
        }

        this.loginUsernameValue = username;

        this.minecraft.displayScreen(new GuiWaitForCompletion(this, `Signing in as ${username}...`, async () => {
            try {
                const exists = await AuthLib.userExists(username);
                let result;

                if (exists) {
                    result = await AuthLib.login(username, password);
                } else {
                    await AuthLib.register(username, password);
                    result = await AuthLib.login(username, password);
                }

                this.minecraft.newSessionFromUsername(username);
                this.minecraft.updateAccessToken(result.token);
                this.minecraft.settings.token = AuthLib.getAuthToken();
                this.minecraft.settings.username = username;
                this.minecraft.settings.loggedIn = true;
                this.minecraft.settings.save();
                this.errorMessage = `Signed in as ${username}`;
            } catch (error) {
                this.errorMessage = `Authentication failed: ${this.formatError(error)}`;
                console.error("Authentication Error:", error);
            }
        }));
    }

    handleLogout() {
        this.errorMessage = "Signed out";
        this.loginUsernameValue = "";
        this.animationMode = "normal";

        AuthLib.clearAuthToken();
        if (this.minecraft?.setSession) {
            this.minecraft.setSession(null, true);
        }

        if (this.minecraft?.settings) {
            this.minecraft.settings.loggedIn = false;
            this.minecraft.settings.token = "";
            this.minecraft.settings.save();
        }
    }

    formatError(error) {
        const message = error && error.message ? error.message : "Unknown error";
        if (message.includes("Details:")) {
            return message.split("Details: ")[1];
        }
        return message;
    }

    drawPanel(stack, x, top, width, bottom) {
        this.drawRect(stack, x, top, x + width, bottom, "rgba(0, 0, 0, 0.45)");
    }

    drawPanelEdges(stack, x, top, width, bottom) {
        this.drawEdgeFades(stack, x, x + width, top, bottom);
    }

    drawLoginPanel(stack) {
        const layout = this.layout;
        const form = this.loginLayout;
        const centerX = layout.leftX + layout.leftWidth / 2;

        this.drawCenteredString(stack, "Sign In", centerX, form.top, 0xFFFFFFFF);
        this.drawCenteredString(stack, "Use your Breakmine account.", centerX, form.top + 18, 0xFF9A9A9A);

        this.drawString(stack, "Username", form.x, form.usernameLabelY, 0xFFAAAAAA);
        this.drawString(stack, "Password", form.x, form.passwordLabelY, 0xFFAAAAAA);
    }

    drawAchievementsPanel(stack) {
        const layout = this.layout;
        const centerX = layout.leftX + layout.leftWidth / 2;
        const username = this.getCurrentUsername() || "Player";

        this.drawCenteredString(stack, "Achievements", centerX, layout.panelTop + 18, 0xFFFFFFFF);
        this.drawCenteredString(stack, `Signed in as ${username}`, centerX, layout.panelTop + 36, 0xFF9A9A9A);

        const dividerY = layout.panelTop + 54;
        this.drawRect(stack, layout.leftX + 18, dividerY, layout.leftX + layout.leftWidth - 18, dividerY + 1, "#3b3b3b", 0.9);

        const messageY = layout.panelTop + Math.floor((layout.leftBottom - layout.panelTop) * 0.47);
        this.drawCenteredString(stack, "Coming Soon", centerX, messageY, 0xFFFFFFFF);
        this.drawCenteredString(stack, "Achievements will appear here.", centerX, messageY + 16, 0xFF898989);
    }

    drawPlayerPreview(stack, mouseX, mouseY, partialTicks) {
        if (!this.playerPreview) return;

        const layout = this.layout;
        const horizontalPadding = layout.rightWidth < 220 ? 12 : 24;
        const availableWidth = layout.rightWidth - horizontalPadding;
        const availableHeight = layout.rightBottom - layout.panelTop - 32;
        const scale = Math.max(1, Math.min(
            6,
            Math.floor(availableWidth / GuiPlayerPreview.WIDTH),
            Math.floor(availableHeight / GuiPlayerPreview.HEIGHT)
        ));
        const previewWidth = GuiPlayerPreview.WIDTH * scale;
        const previewHeight = GuiPlayerPreview.HEIGHT * scale;
        const x = layout.rightX + Math.floor((layout.rightWidth - previewWidth) / 2);
        const y = layout.panelTop + Math.floor((layout.rightBottom - layout.panelTop - previewHeight) / 2) + 4;

        if (!this.playerPreview.modelReady) {
            this.drawCenteredString(stack, "Preview unavailable", layout.rightX + layout.rightWidth / 2, y + previewHeight / 2, 0xFF888888);
            return;
        }

        this.playerPreview.draw(stack, x, y, mouseX, mouseY, partialTicks, scale);

        if (this.minecraft.settings.loggedIn) {
            const username = this.getCurrentUsername();
            if (username) {
                this.drawNametag(stack, username, x, y, previewWidth, previewHeight);
            }
        }
    }

    drawNametag(stack, username, x, y, previewWidth, previewHeight) {
        const fontRenderer = this.minecraft.fontRenderer;
        const textWidth = fontRenderer.getStringWidth(stack, username);
        const tagWidth = textWidth + 8;
        const tagHeight = 12;
        const tagX = Math.round(x + previewWidth / 2 - tagWidth / 2);
        const headTopY = this.playerPreview.getHeadTopY(y, previewHeight);
        const tagY = Math.max(this.layout.panelTop + 3, Math.round(headTopY - tagHeight - 5));

        this.drawRect(stack, tagX, tagY, tagX + tagWidth, tagY + tagHeight, "rgba(0, 0, 0, 0.4)");
        fontRenderer.drawStringRaw(stack, username, tagX + 4, tagY + 2, 0xFFFFFF, false, "8", false);
    }

    drawStatus(stack) {
        if (!this.errorMessage) return;

        let color = 0xFFFF5555;
        if (this.errorMessage.includes("uploaded") || this.errorMessage.includes("Signed in") || this.errorMessage.includes("Signed out")) {
            color = 0xFF55FF55;
        } else if (this.errorMessage.includes("Uploading") || this.errorMessage.includes("Signing in")) {
            color = 0xFFFFFF55;
        }

        const maxWidth = Math.max(100, this.layout.leftWidth - 36);
        const lines = this.minecraft.fontRenderer.listFormattedStringToWidth(this.errorMessage, maxWidth);
        const lineHeight = 10;
        const centerX = this.layout.leftX + this.layout.leftWidth / 2;

        let y;
        if (this.minecraft.settings.loggedIn) {
            y = this.layout.leftBottom - 12 - lines.length * lineHeight;
        } else {
            y = Math.min(this.loginLayout.statusY, this.layout.leftBottom - 12 - lines.length * lineHeight);
        }

        for (let i = 0; i < lines.length; i++) {
            this.drawCenteredString(stack, lines[i], centerX, y + i * lineHeight, color);
        }
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);

        const layout = this.layout;
        this.drawCenteredString(stack, "Account", layout.leftX + layout.leftWidth / 2, 20);

        this.drawPanel(stack, layout.leftX, layout.panelTop, layout.leftWidth, layout.leftBottom);
        this.drawPanel(stack, layout.rightX, layout.panelTop, layout.rightWidth, layout.rightBottom);

        if (this.minecraft.settings.loggedIn) {
            this.drawAchievementsPanel(stack);
        } else {
            this.drawLoginPanel(stack);
        }

        this.drawPlayerPreview(stack, mouseX, mouseY, partialTicks);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
        this.drawStatus(stack);

        this.drawPanelEdges(stack, layout.leftX, layout.panelTop, layout.leftWidth, layout.leftBottom);
        this.drawPanelEdges(stack, layout.rightX, layout.panelTop, layout.rightWidth, layout.rightBottom);
    }

    onClose() {
        if (this.playerPreview) {
            this.playerPreview.dispose();
            this.playerPreview = null;
        }

        this.minecraft.settings.save();
    }
}
