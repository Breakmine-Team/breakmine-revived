import * as THREE from "../../../../../../../libraries/three.module.js";
import ModelPlayer from "../../render/model/model/ModelPlayer.js";
import Tessellator from "../../render/Tessellator.js";
import GuiPlayerTexture from "../screens/container/GuiPlayerTexture.js";
import MathHelper from "../../../util/MathHelper.js";
import * as AuthLib from "../../network/AuthLib.js";
import { createCapeGeometry } from "../../render/CapeGeometry.js";

export default class GuiPlayerPreview {

    static WIDTH = 60;
    static HEIGHT = 85;
    static RENDER_SCALE = 6;

    static MODEL_BASE_Y = 8;

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.model = new ModelPlayer();
        this.modelGroup = new THREE.Object3D();
        this.modelReady = false;

        this.clock = new THREE.Clock();
        this.animTime = 0;
        this.animationMode = "normal";

        this.renderCanvas = null;
        this.glRenderer = null;
        this.scene = null;
        this.camera = null;

        this.previewTexture = null;
        this.skinImage = null;
        this.skinUsername = null;
        this.playerMeshes = [];
        this.lastWalkBob = 0;

        this.modelOffsetY = 0;

        this.capeMesh = null;
        this.capeTexture = null;
        this.capeUsername = null;
        this.baseYaw = 0;
    }

    init() {
        this.dispose();

        const rs = GuiPlayerPreview.RENDER_SCALE;
        const cw = GuiPlayerPreview.WIDTH * rs;
        const ch = GuiPlayerPreview.HEIGHT * rs;

        this.renderCanvas = document.createElement('canvas');
        this.renderCanvas.width = cw;
        this.renderCanvas.height = ch;

        try {
            this.skinImage = this.minecraft.resources['char.png'] || null;
            const texture = GuiPlayerTexture.createSharpTexture(this.minecraft.resources, this.skinImage);
            if (!texture) return;
            this.previewTexture = texture;

            this.tessellator = new Tessellator();
            this.tessellator.setColor(1, 1, 1);
            this.tessellator.bindTexture(texture);
            this.model.rebuild(this.tessellator, this.modelGroup);
            this.modelGroup.traverse(child => {
                if (child.isMesh) {
                    child.material = this.tessellator.unlitMaterial.clone();
                    this.playerMeshes.push(child);
                }
            });
            this.modelGroup.position.set(0, GuiPlayerPreview.MODEL_BASE_Y, 0);

            this.glRenderer = new THREE.WebGLRenderer({
                canvas: this.renderCanvas,
                alpha: true,
                antialias: true
            });
            this.glRenderer.setClearColor(0x000000, 0);
            this.glRenderer.setPixelRatio(1);
            this.glRenderer.setSize(cw, ch);

            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(18, cw / ch, 1, 250);
            this.camera.position.set(0, 0, 135);
            this.camera.lookAt(0, 0, 0);

            this.scene.add(this.modelGroup);
            this.modelReady = true;

            this.modelOffsetY = this.measureSilhouetteOffset();
        } catch (e) {
            console.warn('GuiPlayerPreview init error:', e);
            this.modelReady = false;
            return;
        }

        this.loadSkin();
        this.loadCape();
    }

    
    measureSilhouetteOffset() {
        try {
            this.modelGroup.position.set(0, GuiPlayerPreview.MODEL_BASE_Y, 0);
            this.modelGroup.scale.set(-1, -1, 1);
            this.modelGroup.rotation.y = MathHelper.toRadians(180);
            this.model.render(this.modelGroup, 0, 0, 0, 0, 0, 0);

            this.glRenderer.render(this.scene, this.camera);

            const gl = this.glRenderer.getContext();
            const width = this.renderCanvas.width;
            const height = this.renderCanvas.height;
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            let weight = 0;
            let weightedY = 0;
            for (let y = 0; y < height; y++) {
                const row = y * width * 4;
                let rowAlpha = 0;
                for (let x = 0; x < width; x++) {
                    const alpha = pixels[row + x * 4 + 3];
                    if (alpha > 8) rowAlpha += alpha;
                }
                if (rowAlpha > 0) {
                    weight += rowAlpha;
                    weightedY += rowAlpha * y;
                }
            }
            if (weight === 0) return 0;

            const centerPx = weightedY / weight - height / 2;
            const visibleHeight = 2 * Math.tan(MathHelper.toRadians(this.camera.fov / 2)) * this.camera.position.z;
            const offset = centerPx / (height / visibleHeight);

            if (!Number.isFinite(offset) || Math.abs(offset) > GuiPlayerPreview.HEIGHT) return 0;
            return offset;
        } catch (e) {
            console.warn('GuiPlayerPreview centring probe failed:', e);
            return 0;
        }
    }

    getUsername() {
        const session = this.minecraft?.getSession ? this.minecraft.getSession() : null;
        const profile = session && session.getProfile ? session.getProfile() : null;
        const username = (profile && profile.getUsername ? profile.getUsername() : null)
            || this.minecraft?.settings?.username;

        return typeof username === 'string' && username.length > 0 ? username : null;
    }

    loadSkin() {
        if (!this.minecraft?.settings?.loggedIn) return;

        const username = this.getUsername();
        if (!username) return;

        this.skinUsername = username;

        try {
            const image = new Image();
            image.onload = () => {
                if (this.skinUsername === username) {
                    this.applySkinImage(image);
                }
            };
            image.onerror = () => {
            };
            AuthLib.getSkinImageUrl(username).then((url) => {
                if (this.skinUsername === username) image.src = url;
            }).catch(() => {
            });
        } catch (e) {
            console.warn('GuiPlayerPreview skin load error:', e);
        }
    }

    applySkinImage(image) {
        if (!this.modelReady || !image || image === this.skinImage) return;

        let texture;
        try {
            texture = GuiPlayerTexture.createSharpTexture(this.minecraft.resources, image);
        } catch (e) {
            console.warn('GuiPlayerPreview skin texture error:', e);
            return;
        }
        if (!texture) return;

        if (this.previewTexture) this.previewTexture.dispose();
        this.previewTexture = texture;
        this.skinImage = image;

        for (const mesh of this.playerMeshes) {
            if (mesh.material) {
                mesh.material.map = texture;
                mesh.material.needsUpdate = true;
            }
        }
    }

    loadCape() {
        this.clearCape();

        if (!this.minecraft?.settings?.loggedIn) return;

        const capeManager = this.minecraft.capeManager;
        if (capeManager?.getChoice?.() === '') return;

        const username = this.getUsername();
        if (!username) return;

        const selected = capeManager?.getSelectedTexture?.() || null;

        this.capeUsername = username;

        try {
            const image = new Image();
            image.onload = () => {
                if (this.capeUsername === username) {
                    this.applyCapeImage(image);
                }
            };
            image.onerror = () => {
            };
            const source = selected
                ? Promise.resolve(selected)
                : AuthLib.getCapeImageUrl(username);
            source.then((url) => {
                if (this.capeUsername === username) image.src = url;
            }).catch(() => {
            });
        } catch (e) {
            console.warn('GuiPlayerPreview cape load error:', e);
        }
    }

    
    reloadCape() {
        this.loadCape();
    }

    applyCapeImage(image) {
        if (!this.modelReady || !image || !this.model?.body?.bone) return;

        this.clearCape();

        const texture = new THREE.Texture(image);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        this.capeTexture = texture;

        const geometry = createCapeGeometry(image.width, image.height);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0, 2.1);
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        this.model.body.bone.add(mesh);
        this.capeMesh = mesh;
    }

    clearCape() {
        if (this.capeMesh) {
            if (this.capeMesh.parent) this.capeMesh.parent.remove(this.capeMesh);
            if (this.capeMesh.geometry) this.capeMesh.geometry.dispose();
            if (this.capeMesh.material) this.capeMesh.material.dispose();
            this.capeMesh = null;
        }

        if (this.capeTexture) {
            this.capeTexture.dispose();
            this.capeTexture = null;
        }

        this.capeUsername = null;
    }

    setAnimationMode(mode) {
        if (mode === "normal" || mode === "walk" || mode === "run") {
            this.animationMode = mode;
        }
        return this;
    }

    
    setBaseYaw(degrees) {
        this.baseYaw = Math.max(-60, Math.min(60, Number(degrees) || 0));
        return this;
    }

    
    getHeadTopY(y, height) {
        if (!this.modelReady || !this.camera) return y + 8;

        const visibleHeight = 2 * Math.tan(MathHelper.toRadians(this.camera.fov / 2)) * this.camera.position.z;
        const pixelsPerModelUnit = height / visibleHeight;
        const headTop = 16 - this.modelOffsetY + this.lastWalkBob;

        return y + height / 2 - headTop * pixelsPerModelUnit;
    }

    
    draw(stack, x, y, mouseX, mouseY, partialTicks = 0, scale = 1) {
        if (!this.modelReady || !this.glRenderer) return;

        const elapsed = this.clock.getElapsedTime();
        this.animTime = elapsed * 20;

        let limbSwing = 0;
        let limbSwingStrength = 0;
        if (this.animationMode === "walk") {
            limbSwing = elapsed * 7.0;
            limbSwingStrength = 0.8;
        } else if (this.animationMode === "run") {
            limbSwing = elapsed * 12.0;
            limbSwingStrength = 1.3;
        }

        const walkBob = limbSwingStrength > 0
            ? Math.abs(Math.sin(limbSwing * 0.6662)) * (this.animationMode === "run" ? 0.18 : 0.1)
            : 0;
        this.lastWalkBob = walkBob;

        const width = GuiPlayerPreview.WIDTH * scale;
        const height = GuiPlayerPreview.HEIGHT * scale;

        const modelCenterX = x + width * 0.5;
        const modelCenterY = y + height * 0.55;

        const dx = mouseX - modelCenterX;
        const dy = mouseY - modelCenterY;

        const totalYaw = Math.max(-60, Math.min(60, this.baseYaw - dx * 0.2));
        const pitch = Math.max(-25, Math.min(25, dy * 0.2));

        const headLimit = 20;
        const headYaw = Math.max(-headLimit, Math.min(headLimit, totalYaw));
        const bodyYaw = totalYaw - headYaw;

        this.modelGroup.position.set(0, GuiPlayerPreview.MODEL_BASE_Y - this.modelOffsetY + walkBob, 0);
        this.modelGroup.scale.set(-1, -1, 1);
        this.modelGroup.rotation.y = MathHelper.toRadians(-bodyYaw + 180);

        this.model.render(this.modelGroup, limbSwing, limbSwingStrength, this.animTime, headYaw, pitch, 0);

        if (this.capeMesh) {
            this.capeMesh.rotation.x = this.animationMode === "run" ? 0.45
                : this.animationMode === "walk" ? 0.25 : 0.06;
        }

        this.modelGroup.updateMatrixWorld(true);

        this.glRenderer.render(this.scene, this.camera);

        stack.save();
        stack.translate(Math.floor(x), Math.floor(y));
        stack.drawImage(this.renderCanvas, 0, 0, width, height);
        stack.restore();
    }

    dispose() {
        if (this.previewTexture) {
            this.previewTexture.dispose();
            this.previewTexture = null;
        }

        if (this.glRenderer) {
            this.glRenderer.dispose();
            if (this.glRenderer.forceContextLoss) this.glRenderer.forceContextLoss();
            this.glRenderer = null;
        }

        this.clearCape();
        this.modelGroup.clear();
        this.playerMeshes = [];
        this.scene = null;
        this.camera = null;
        this.renderCanvas = null;
        this.skinImage = null;
        this.skinUsername = null;
        this.lastWalkBob = 0;
        this.modelOffsetY = 0;
        this.modelReady = false;
    }

}
