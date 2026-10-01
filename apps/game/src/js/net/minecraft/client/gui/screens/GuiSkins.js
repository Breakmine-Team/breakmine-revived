import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";

export default class GuiSkins extends GuiScreen {
    constructor(previousScreen) {
        super();
        this.previousScreen = previousScreen;
        this.tab = "Skins";
        this.mode = "idle";
        this.status = "";
        this.preview = null;
        this.dragging = false;
    }

    init() {
        super.init();
        this.skins = this.minecraft.skins;
        this.skins.disposePlayerPreview(this.preview);
        this.preview = this.skins.createPlayerPreview(100, 140);
        this.fileInput?.remove();
        this.fileInput = document.createElement("input");
        this.fileInput.type = "file";
        this.fileInput.accept = "image/png";
        this.fileInput.style.display = "none";
        this.fileInput.onchange = async () => {
            const file = this.fileInput.files?.[0];
            if (!file) return;
            try {
                if (this.tab === "Skins") await this.skins.setSkinFromFile(file);
                else await this.skins.setCapeFromFile(file);
                this.status = this.tab === "Skins" ? "Skin saved on this device." : "Cape saved on this device.";
                this.buildButtons();
            } catch (error) {
                this.status = error?.message || "Upload failed.";
            }
            this.fileInput.value = "";
        };
        document.body.appendChild(this.fileInput);
        this.buildButtons();
    }

    layout() {
        const cx = Math.floor(this.width / 2);
        const narrow = this.width < 390;
        return {
            left: narrow ? cx - 100 : cx - 164,
            top: Math.max(45, Math.floor(this.height / 2 - 66)),
            width: narrow ? 94 : 126,
            px: narrow ? cx + 8 : cx + 40,
            py: Math.max(45, Math.floor(this.height / 2 - 72)),
            pw: narrow ? 78 : 100,
            ph: narrow ? 110 : 140
        };
    }

    buildButtons() {
        this.buttonList = [];
        const l = this.layout();
        const add = (label, row, action, enabled = true) => {
            this.buttonList.push(new GuiButton(this.minecraft, label, l.left, l.top + row * 24, l.width, 20, action).setEnabled(enabled));
        };
        for (const [i, tab] of ["Skins", "Capes"].entries()) {
            this.buttonList.push(new GuiButton(this.minecraft, this.tab === tab ? `[${tab}]` : tab,
                l.left + i * (l.width / 2), 24, l.width / 2 - 2, 20, () => {
                    this.tab = tab;
                    this.status = "";
                    this.buildButtons();
                }));
        }
        if (this.tab === "Skins") {
            add(this.minecraft.settings.loggedIn ? "Account Skin" : "Default Skin", 0, () => {
                this.skins.useAccountSkin();
                this.status = this.minecraft.settings.loggedIn ? "Account skin selected." : "Default skin selected.";
            });
            add("Upload Skin", 1, () => this.fileInput?.click());
            for (let i = 0; i < 3; i++) add(`Recent ${i + 1}`, i + 2, () => {
                this.skins.selectRecentSkin(i);
                this.status = `Recent skin ${i + 1} selected.`;
            }, Boolean(this.skins.recentSkins[i]));
        } else {
            add("Default Cape", 0, () => {
                try {
                    this.skins.useDefaultCape();
                    this.status = "Default cape selected.";
                } catch (error) {
                    this.status = error.message;
                }
            });
            add("Upload Cape", 1, () => this.fileInput?.click());
            const recent = this.skins.getRecentCapes();
            for (let i = 0; i < 3; i++) add(`Recent ${i + 1}`, i + 2, () => {
                this.skins.selectRecentCape(i);
                this.status = `Recent cape ${i + 1} selected.`;
            }, Boolean(recent[i]));
            add("No Cape", 5, () => {
                this.skins.clearCape();
                this.status = "Cape removed.";
            });
        }
        ["idle", "walk", "sprint"].forEach((mode, i) => {
            this.buttonList.push(new GuiButton(this.minecraft, this.mode === mode ? `[${mode[0].toUpperCase()}]` : mode[0].toUpperCase(),
                l.px - 26, l.py + 36 + i * 24, 20, 20, () => {
                this.mode = mode;
                this.buildButtons();
            }).setTooltip(mode[0].toUpperCase() + mode.slice(1)));
        });
        this.buttonList.push(new GuiButton(this.minecraft, "Done", l.left, this.height - 25, l.width, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
    }

    overPreview(x, y) {
        const l = this.layout();
        return x >= l.px && x < l.px + l.pw && y >= l.py && y < l.py + l.ph;
    }

    mouseClicked(x, y, button) {
        if (button === 0 && this.overPreview(x, y)) {
            this.dragging = true;
            this.lastMouseX = x;
            return;
        }
        super.mouseClicked(x, y, button);
    }

    mouseDragged(x, y, button) {
        if (this.dragging) {
            this.skins.rotatePlayerPreview(this.preview, x - this.lastMouseX);
            this.lastMouseX = x;
        } else super.mouseDragged(x, y, button);
    }

    mouseReleased(x, y, button) {
        this.dragging = false;
        super.mouseReleased(x, y, button);
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawCenteredString(stack, "Skins", this.width / 2, 10);
        const l = this.layout();
        this.drawRect(stack, l.px - 3, l.py - 3, l.px + l.pw + 3, l.py + l.ph + 3, "black", 0.35);
        if (this.preview) {
            this.skins.renderPlayerPreview(this.preview, mouseX - l.px, mouseY - l.py, this.overPreview(mouseX, mouseY) || this.dragging, this.mode);
            stack.save();
            stack.imageSmoothingEnabled = false;
            stack.drawImage(this.preview.canvas, l.px, l.py, l.pw, l.ph);
            stack.restore();
        }
        if (this.status) this.drawCenteredString(stack, this.status, this.width / 2, this.height - 39, 0xFFFFFF);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
        this.fileInput?.remove();
        this.fileInput = null;
        this.skins?.disposePlayerPreview(this.preview);
        this.preview = null;
    }
}
