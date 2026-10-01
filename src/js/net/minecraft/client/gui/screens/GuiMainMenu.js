import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiOptions from "./GuiOptions.js";
import * as THREE from "../../../../../../../libraries/three.module.js";
import {BackSide} from "../../../../../../../libraries/three.module.js";
import MathHelper from "../../../util/MathHelper.js";
import Minecraft from "../../Minecraft.js";
import GuiCreateWorld from "./GuiCreateWorld.js";
import GuiSelectWorld from "./GuiSelectWorld.js";
import GuiMultiplayer from "./GuiMultiplayer.js";
import GuiAccount from "./GuiAccount.js";
import GuiTexturePacks from "./GuiTexturePacks.js";
import GuiMods from "./GuiMods.js";
import { SplashTexts } from "../../../../../../resources/splashes.js";
import { Version } from "../../../../../../resources/version.js";
import GuiTooltip from "../widgets/GuiTooltip.js";
import { checkForUpdate } from "../../VersionChecker.js";
import GuiNewVersion from "./GuiNewVersion.js";

export default class GuiMainMenu extends GuiScreen {

    constructor() {
        super();

        this.panoramaTimer = 0;

        this.splashText = SplashTexts.generateSplash();

        // Filled in by the background update check; see checkForUpdateInBackground.
        this.updateInfo = null;
        this.updateCheckStarted = false;
    }

    init() {
        super.init();
        this.textureLogo = this.getTexture("gui/title/minecraft.png");

        // Coming back to the main menu rebuilds buttonList, so the update
        // button is (re)added here rather than only on first load.
        this.updateButtonAdded = false;
        if (this.updateInfo && this.updateInfo.available) {
            this.addUpdateButton();
        } else if (!this.updateInfo) {
            this.checkForUpdateInBackground();
        }

        let y = this.height / 4 + 36;

        this.buttonList.push(new GuiButton(this.minecraft, "Singleplayer", this.width / 2 - 100, y, 200, 20, async () => {
            const hasSave = await this.minecraft.hasSaveData();
            if (hasSave) {
                this.minecraft.displayScreen(new GuiSelectWorld(this));
            } else {
                this.minecraft.displayScreen(new GuiCreateWorld(this));
            }
        }));
        let btntemp = new GuiButton(this.minecraft, "Multiplayer", this.width / 2 - 100, y + 24, 200, 20, () => {
            this.minecraft.displayScreen(new GuiMultiplayer(this));
        }).setEnabled(this.minecraft.settings.loggedIn);
        this.buttonList.push(btntemp);

        this.buttonList.push(new GuiButton(this.minecraft, "Mods", this.width / 2 - 100, y + 24 * 2, 200, 20, () => {
            this.minecraft.displayScreen(new GuiMods(this.minecraft, this));
        }));

        const modButtons = this.minecraft.modLoader?.getGuiButtons('main-menu', this) || [];
        this.buttonList.push(...modButtons);

        this.buttonList.push(new GuiButton(this.minecraft, "Account", this.width / 2 - 100, y + 24 * 3, 98, 20, () => {
            this.minecraft.displayScreen(new GuiAccount(this));
        }));//.setEnabled(false).setTooltip("Coming soon!"));

        this.buttonList.push(new GuiButton(this.minecraft, "Options...", this.width / 2 - 100, y + 96 + 12, 98, 20, () => {
            this.minecraft.displayScreen(new GuiOptions(this));
        }));

        this.buttonList.push(new GuiButton(this.minecraft, "Texture Packs", this.width / 2 + 2, y + 24 * 3, 98, 20, () => {
            this.minecraft.displayScreen(new GuiTexturePacks(this));
        }));

        this.buttonList.push(new GuiButton(this.minecraft, "Quit Game", this.width / 2 + 2, y + 96 + 12, 98, 20, () => {
            this.minecraft.stop();
        }).setEnabled(false));

        if (!this.minecraft.settings.loggedIn) {
            this.buttonList.push(new GuiTooltip(this.minecraft, "You must be logged in\n§7Don't worry, it's free!", this.width / 2 - 100, y + 24, 200, 20));
        }

        this.initPanoramaRenderer();
    }

    /**
     * Ask GitHub whether `main` has moved past this build.
     *
     * Runs off the init path so the menu paints immediately; the button is
     * appended to buttonList when the answer arrives, and drawScreen picks it
     * up on the next frame.
     */
    async checkForUpdateInBackground() {
        if (this.updateCheckStarted) return;
        this.updateCheckStarted = true;

        let info;
        try {
            info = await checkForUpdate();
        } catch (err) {
            console.warn("[update] check failed:", err);
            return;
        }

        if (info.error) {
            console.warn("[update] could not check for updates:", info.error);
            return;
        }
        if (!info.available) return;

        this.updateInfo = info;
        this.addUpdateButton();
    }

    /** Top-left of the main menu, only present while an update is pending. */
    addUpdateButton() {
        if (!this.updateInfo || this.updateButtonAdded) return;
        // init() may have been re-entered while the check was in flight, which
        // would otherwise leave the button list with no way to rebuild it.
        if (!this.buttonList) return;
        this.updateButtonAdded = true;

        this.buttonList.push(new GuiButton(
            this.minecraft,
            "Update " + this.updateInfo.latestClean,
            2, 2, 130, 20,
            () => {
                this.minecraft.displayScreen(new GuiNewVersion(this.updateInfo, this));
            }
        ).setTooltip(
            "Breakmine " + this.updateInfo.latestClean + " is available\n"
            + "§7You are running " + this.updateInfo.currentClean
        ));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        let logoWidth = 274;
        let x = this.width / 2 - logoWidth / 2;
        let y = 30;

        let rotationX = Math.sin((this.panoramaTimer + partialTicks) / 400.0) * 25.0 + 20.0;
        let rotationY = -(this.panoramaTimer + partialTicks) * 0.1;

        // Draw panorama
        this.camera.aspect = this.width / this.height;
        this.camera.rotation.x = -MathHelper.toRadians(rotationX + 180);
        this.camera.rotation.y = -MathHelper.toRadians(rotationY - 180);
        this.camera.updateProjectionMatrix();
        this.minecraft.worldRenderer.webRenderer.clear();
        this.minecraft.worldRenderer.webRenderer.render(this.scene, this.camera);

        // Draw panorama overlay
        this.drawGradientRect(stack, 0, 0, this.width, this.height, 'rgba(255,255,255,0.5)', 'rgb(255,255,255,0)');
        this.drawGradientRect(stack, 0, 0, this.width, this.height, 'rgb(0,0,0,0)', 'rgb(0,0,0,0.5)');

        // Draw logo
        this.drawLogo(stack, x, y);

        // Draw version
        this.drawRightString(stack, "Updated at " + Minecraft.TIMESTAMP, this.width - 2, this.height - 20, 0xFFFFFFff);
        this.drawString(stack, "Breakmine " + Minecraft.VERSION, 2, this.height - 10, 0xFFFFFFff);

        // Draw Patchwork version
        this.drawString(stack, "Patchwork " + Version.PATCHWORK_VERSION, 2, this.height - 20, 0xFFFFFFff);

        // Draw copyright
        this.drawRightString(stack, "(C) 2026 SpinningCubes under SCLv1.", this.width - 2, this.height - 10);

        // Draw buttons
        super.drawScreen(stack, mouseX, mouseY, partialTicks);

        // Draw splash text
        this.drawSplash(stack);

        // Draw warning
        //let pageText = "In development, expect bugs and breaking changes.";
        //let centerX = Math.floor(this.width / 2);
        //this.drawString(stack, pageText, centerX - this.getStringWidth(stack, pageText) / 2, 10, 0xFF6363, false);
    }

    updateScreen() {
        this.panoramaTimer++;
    }

    drawLogo(stack, x, y) {
        this.drawSprite(stack, this.textureLogo, 0, 0, 155, 44, x, y, 155, 44);
        this.drawSprite(stack, this.textureLogo, 0, 45, 155, 44, x + 155, y, 155, 44);
    }

    drawSplash(stack) {
        let f = 1.8 - Math.abs(Math.sin((new Date().getTime() % 1000) / 1000.0 * Math.PI * 2.0) * 0.1);
        f = f * 100.0 / (this.getStringWidth(stack, this.splashText) + 32);

        stack.save();
        stack.translate((this.width / 2 + 90), 70.0, 0.0);
        stack.rotate(MathHelper.toRadians(-20));
        stack.scale(f, f, f);

        this.drawCenteredString(stack, this.splashText, 0, -8, -256);
        stack.restore();
    }

    keyTyped(key) {
        // In TV mode, allow navigation keys through to parent
        if (this.minecraft && this.minecraft.settings.tvmode) {
            super.keyTyped(key);
        }
        // Cancel other key inputs
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    initPanoramaRenderer() {
        this.scene = new THREE.Scene();

        // Create cube
        let geometry = new THREE.BoxBufferGeometry(1, 1, 1);
        let materials = [
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture("gui/title/background/panorama_1.png")
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture("gui/title/background/panorama_3.png")
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture("gui/title/background/panorama_4.png")
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture("gui/title/background/panorama_5.png")
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture("gui/title/background/panorama_0.png")
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture("gui/title/background/panorama_2.png")
            })
        ];

        materials.forEach(material => {
            material.map.minFilter = THREE.LinearFilter;
            material.map.magFilter = THREE.LinearFilter;
        });

        let cube = new THREE.Mesh(geometry, materials);
        cube.scale.set(-1, -1, -1);
        this.scene.add(cube);

        this.camera = new THREE.PerspectiveCamera(120, 1, 0.1, 1);
        this.camera.rotation.order = 'ZYX';

        // Apply blur
        let style = this.minecraft.window.canvas.style;
        style.backdropFilter = "blur(0px)";
        style.webkitBackdropFilter = "blur(0px)";
        this.minecraft.window.wrapper.insertBefore(this.minecraft.window.canvasWorld, this.minecraft.window.canvas);
    }

    onClose() {
        // Remove blur
        let style = this.minecraft.window.canvas.style;
        style.backdropFilter = "";
        style.webkitBackdropFilter = "";
        if (this.minecraft.window.wrapper.contains(this.minecraft.window.canvasWorld)) {
            this.minecraft.window.wrapper.removeChild(this.minecraft.window.canvasWorld);
        }
    }
}
