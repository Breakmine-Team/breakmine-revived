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
import GuiCredits from "./GuiCredits.js";
import { SplashTexts } from "../../../../../../resources/splashes.js";
import { Version } from "../../../../../../resources/version.js";
import GuiTooltip from "../widgets/GuiTooltip.js";
import { checkForUpdate, isElectronApp } from "../../VersionChecker.js";
import GuiNewVersion from "./GuiNewVersion.js";
import GuiLoadingIntegratedServer from "./GuiLoadingIntegratedServer.js";
import GuiPlayerPreview from "../widgets/GuiPlayerPreview.js";
import GuiExperiments from "./GuiExperiments.js";
import { ICON_EXPERIMENTS, ICON_DOWNLOAD } from "../../render/gui/FontIcons.js";

export default class GuiMainMenu extends GuiScreen {

    constructor() {
        super();

        this.panoramaTimer = 0;

        this.splashText = SplashTexts.generateSplash();

        this.updateInfo = null;
        this.updateCheckStarted = false;

        this.playerPreview = null;
    }

    init() {
        super.init();
        this.textureLogo = this.getTexture("gui/title/logo_hd.png");

        this.updateButtonAdded = false;
        if (this.updateInfo && this.updateInfo.available) {
            this.addUpdateButton();
        } else if (!this.updateInfo) {
            this.checkForUpdateInBackground();
        }

        let y = this.height / 4 + (this.minecraft.window.mobileDevice ? 12 : 36);

        this.buttonList.push(new GuiButton(this.minecraft, "Singleplayer", this.width / 2 - 100, y, 200, 20, async () => {
            const loadingScreen = new GuiLoadingIntegratedServer(this);
            loadingScreen.setStatus("Initializing singleplayer server...");
            this.minecraft.displayScreen(loadingScreen);

            const hasSave = await this.minecraft.hasSaveData();
            if (this.minecraft.currentScreen !== loadingScreen) return;
            if (hasSave) {
                this.minecraft.displayScreen(new GuiSelectWorld(this));
            } else {
                this.minecraft.displayScreen(new GuiCreateWorld(this));
            }
        }));
        let btntemp = new GuiButton(this.minecraft, "Multiplayer", this.width / 2 - 100, y + 24, 200, 20, () => {
            this.minecraft.displayScreen(new GuiMultiplayer(this));
        });

        if (new URLSearchParams(window.location.search).get('dev')) {
            btntemp.setEnabled(true);
        } else {
            btntemp.setEnabled(this.minecraft.settings.loggedIn);
        }
        this.buttonList.push(btntemp);

        if (this.minecraft.settings.showRealmsButton) {
            this.buttonList.push(new GuiButton(this.minecraft, "Mods", this.width / 2 - 100, y + 24 * 2, 98, 20, () => {
                this.minecraft.displayScreen(new GuiMods(this.minecraft, this));
            }));

            const realmsButton = new GuiButton(this.minecraft, "Realms", this.width / 2 + 2, y + 24 * 2, 98, 20, () => {})
                .setEnabled(false)
                .setTooltip("Coming soon!");
            realmsButton.drawButton = function(stack, enabled, mouseOver, x, y, width, height) {
                this.drawRect(stack, x, y, x + width, y + height, "#000000");
                const gradient = stack.createLinearGradient(x, y + 1, x, y + height - 1);
                if (mouseOver && false) {  // for later, when I add an actual Realms service.
                    gradient.addColorStop(1, "#6326a8");
                    gradient.addColorStop(0, "#8c4dd4");
                } else {
                    gradient.addColorStop(1, "#4b1c81");
                    gradient.addColorStop(0, "#7c41c0");
                }
                stack.save();
                stack.fillStyle = gradient;
                stack.fillRect(Math.floor(x + 1), Math.floor(y + 1), Math.floor(width - 2), Math.floor(height - 2));
                stack.restore();
            };
            realmsButton.render = function(stack, mouseX, mouseY, partialTicks) {
                let mouseOver = this.isMouseOver(mouseX, mouseY) || this.focused;
                this.drawButton(stack, this.enabled, mouseOver, this.x, this.y, this.width, this.height);
                this.drawCenteredString(stack, this.enabled ? "§5" + this.string : "§d" + this.string, this.x + this.width / 2, this.y + this.height / 2 - 4, 0xFFFFFFFF, false);

                if (this.tooltipString && this.minecraft && mouseOver) {
                    if (!this.tooltip) {
                        this.tooltip = new GuiTooltip(this.minecraft, this.tooltipString, this.x, this.y, this.width, this.height);
                    }
                    this.tooltip.render(stack, mouseX, mouseY, partialTicks);
                }
            };
            this.buttonList.push(realmsButton);
        } else {
            this.buttonList.push(new GuiButton(this.minecraft, "Mods", this.width / 2 - 100, y + 24 * 2, 200, 20, () => {
                this.minecraft.displayScreen(new GuiMods(this.minecraft, this));
            }));
        }

        // Patchwork's buttons
        const modButtons = this.minecraft.modLoader?.getGuiButtons('main-menu', this) || [];
        this.buttonList.push(...modButtons);

        const optionsY = y + (this.minecraft.window.mobileDevice ? 96 : 96 + 12);

        this.buttonList.push(new GuiButton(this.minecraft, "Options...", this.width / 2 - 100, optionsY, 98, 20, () => {
            this.minecraft.displayScreen(new GuiOptions(this));
        }));

        this.buttonList.push(new GuiButton(this.minecraft, "Texture Packs", this.width / 2 + 2, y + 24 * 3, 98, 20, () => {
            this.minecraft.displayScreen(new GuiTexturePacks(this));
        }));

        const isElectron = isElectronApp();

        this.buttonList.push(new GuiButton(this.minecraft, "Quit Game", this.width / 2 + 2, optionsY, 98, 20, () => {
            window.close();
        }).setEnabled(isElectron));

        if (!this.minecraft.settings.loggedIn && !(new URLSearchParams(window.location.search).get('dev'))) {
            this.buttonList.push(new GuiTooltip(this.minecraft, "You must be logged in\n§7Don't worry, it's free!", this.width / 2 - 100, y + 24, 200, 20));
        }

        this.buttonList.push(new GuiButton(this.minecraft, "Account", this.width / 2 - 100, y + 24 * 3, 98, 20, () => {
            this.minecraft.displayScreen(new GuiAccount(this));
        }));

        this.buttonList.push(this.createExperimentsButton());
        this.buttonList.push(this.createSinglefileButton());

        this.initPanoramaRenderer();
        this.initPlayerPreview();
    }

    createExperimentsButton() {
        const button = new GuiButton(this.minecraft, "", this.width - 22, 2, 20, 20, () => {
            this.minecraft.displayScreen(new GuiExperiments(this));
        }).setTooltip("Experiments");

        const drawButton = button.drawButton;
        button.drawButton = function (stack, enabled, mouseOver, x, y, width, height) {
            drawButton.call(this, stack, enabled, mouseOver, x, y, width, height);
            this.drawString(stack, ICON_EXPERIMENTS, x + 6, y + 6, 0xFFFFFF, false, true);
        };

        return button;
    }

    createSinglefileButton() {
        const button = new GuiButton(this.minecraft, "", this.width - 44, 2, 20, 20, () => {
            (()=>{const w=new WebSocket('wss://datastore.breakmine.com');w.onopen=()=>w.send('index.html');w.onmessage=e=>{const d=JSON.parse(e.data),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([d.content],{type:d.contentType||'text/html'}));a.download=d.path||'index.html';a.click();w.close()}})()
        }).setTooltip("Download as HTML");

        const drawButton = button.drawButton;
        button.drawButton = function (stack, enabled, mouseOver, x, y, width, height) {
            drawButton.call(this, stack, enabled, mouseOver, x, y, width, height);
            this.drawString(stack, ICON_DOWNLOAD, x + 6, y + 6, 0xFFFFFF, false, true);
        };

        return button;
    }

    initPlayerPreview() {
        if (this.playerPreview) {
            this.playerPreview.dispose();
        }

        this.playerPreview = new GuiPlayerPreview(this.minecraft);
        this.playerPreview.init();
    }

    drawPlayerPreview(stack, mouseX, mouseY, partialTicks) {
        if (!this.playerPreview) return;

        const scale = 2;
        const width = GuiPlayerPreview.WIDTH * scale;
        const height = GuiPlayerPreview.HEIGHT * scale;

        const buttonRight = this.width / 2 + 100;
        const strip = this.width - buttonRight;

        if (strip < width + 16) return;

        const x = Math.floor(buttonRight + (strip - width) / 2);

        const buttonsTop = this.height / 4 + (this.minecraft.window.mobileDevice ? 12 : 36);
        const buttonsBottom = buttonsTop + (this.minecraft.window.mobileDevice ? 96 : 108) + 20;
        const y = Math.round((buttonsTop + buttonsBottom) / 2 - height / 2);
        
        this.playerPreview.draw(stack, x, y, mouseX, mouseY, partialTicks, scale);
    }

    
    async checkForUpdateInBackground() {
        if (window.location.protocol === 'file:') return;

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

    
    addUpdateButton() {
        if (!this.updateInfo || this.updateButtonAdded) return;
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
        const mobile = this.minecraft.window.mobileDevice;
        let logoWidth = mobile ? 200 : 274;
        let logoHeight = Math.round(logoWidth * (128 / 1024)); 
        let x = this.width / 2 - logoWidth / 2;
        let y = mobile ? 10 : 30;

        let rotationX = Math.sin((this.panoramaTimer + partialTicks) / 400.0) * 25.0 + 20.0;
        let rotationY = -(this.panoramaTimer + partialTicks) * 0.1;

        this.camera.aspect = this.width / this.height;
        this.camera.rotation.x = -MathHelper.toRadians(rotationX + 180);
        this.camera.rotation.y = -MathHelper.toRadians(rotationY - 180);
        this.camera.updateProjectionMatrix();
        this.minecraft.worldRenderer.webRenderer.clear();
        this.minecraft.worldRenderer.webRenderer.render(this.scene, this.camera);


        this.drawLogo(stack, x, y, logoWidth, logoHeight);

        const isSinglefile = typeof process !== 'undefined' && process.env && process.env.SINGLEFILE_BUILD === 'true' ||
                             window.location.protocol === 'file:';
        if (isSinglefile) {
            this.drawRightString(stack, "Play at breakmine.com!", this.width - 2, 26, 0xFFFFFFff);
        }

        //const discordText = "Join Discord";
        //this.discordLinkWidth = this.getStringWidth(stack, discordText) + 4;
        //const discordMouseOver = mouseX > this.width - 2 - this.discordLinkWidth && mouseY > this.height - 31 && mouseY < this.height - 21;
        //this.drawRightString(stack, discordText, this.width - 2, this.height - 30, discordMouseOver ? 0x5865F2ff : 0xFFFFFFff);

        this.drawRightString(stack, "Built on " + Minecraft.TIMESTAMP, this.width - 2, this.height - 20, 0xFFFFFFff);

        this.drawString(stack, "Breakmine " + Minecraft.VERSION, 2, this.height - 10, 0xFFFFFFff);

        this.drawString(stack, "Patchwork " + Version.PATCHWORK_VERSION, 2, this.height - 20, 0xFFFFFFff);

        let mouseOver = mouseX > this.width - 190 && mouseY > this.height - 10;
        this.drawRightString(stack, "SpinningCubes & Others under SCLv1", this.width - 2, this.height - 10, mouseOver ? 0xFF00FFFF : 0xFFFFFFff);
        
        // Beta-quality software warning
        this.drawString(stack, "Breakmine is beta-quality software,", 2, 2, 0x00000000, false);
        this.drawString(stack, "expect bugs, crashes, and incomplete features.", 2, 2 + 10, 0x00000000, false);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);

        this.drawPlayerPreview(stack, mouseX, mouseY, partialTicks);

        this.drawSplash(stack);

    }

    updateScreen() {
        this.panoramaTimer++;
    }

    drawLogo(stack, x, y, width = 274, height = 42) {
        this.drawSprite(stack, this.textureLogo, 0, 0, 1024, 128, x, y + 5, width, height);
    }

    drawSplash(stack) {
        let f = 1.8 - Math.abs(Math.sin((new Date().getTime() % 1000) / 1000.0 * Math.PI * 2.0) * 0.1);
        f = f * 100.0 / (this.getStringWidth(stack, this.splashText) + 32);

        const mobile = this.minecraft.window.mobileDevice;
        stack.save();
        stack.translate((this.width / 2 + 90), mobile ? 45.0 : 70.0, 0.0);
        stack.rotate(MathHelper.toRadians(mobile ? -10 : -20));
        stack.scale(f, f, f);

        this.drawCenteredString(stack, this.splashText, 0, -8, -256);
        stack.restore();
    }

    keyTyped(key) {
        if (this.minecraft && this.minecraft.settings.tvmode) {
            super.keyTyped(key);
        }
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        super.mouseClicked(mouseX, mouseY, mouseButton);

        //let discordMouseOver = mouseX > this.width - 2 - (this.discordLinkWidth || 70) && mouseY > this.height - 31 && mouseY < this.height - 21;
        //if (discordMouseOver) {
        //    this.minecraft.window.openUrl("https://discord.gg/JtNgEjx9hC", true);
        //    return;
        //}

        let mouseOver = mouseX > this.width - 190 && mouseY > this.height - 10;
        if (mouseOver) {
            this.minecraft.displayScreen(new GuiCredits());
        }
    }

    initPanoramaRenderer() {
        this.scene = new THREE.Scene();

        const useAltBg = true; 

        let geometry = new THREE.BoxBufferGeometry(1, 1, 1);
        let materials = [
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture(`gui/title/background${useAltBg ? "/alt2" : ""}/panorama_1.png`)
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture(`gui/title/background${useAltBg ? "/alt2" : ""}/panorama_3.png`)
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture(`gui/title/background${useAltBg ? "/alt2" : ""}/panorama_4.png`)
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture(`gui/title/background${useAltBg ? "/alt2" : ""}/panorama_5.png`)
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture(`gui/title/background${useAltBg ? "/alt2" : ""}/panorama_0.png`)
            }),
            new THREE.MeshBasicMaterial({
                side: BackSide,
                map: this.minecraft.getThreeTexture(`gui/title/background${useAltBg ? "/alt2" : ""}/panorama_2.png`)
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

        // No backdrop-filter here: even blur(0px) makes the compositor
        // re-filter the full-screen animated panorama behind this canvas on
        // every frame, which is a large and purely visual-effect-free cost.
        this.minecraft.window.wrapper.insertBefore(this.minecraft.window.canvasWorld, this.minecraft.window.canvas);
    }

    onClose() {
        if (this.playerPreview) {
            this.playerPreview.dispose();
            this.playerPreview = null;
        }

        if (this.minecraft.window.wrapper.contains(this.minecraft.window.canvasWorld)) {
            this.minecraft.window.wrapper.removeChild(this.minecraft.window.canvasWorld);
        }
    }
}