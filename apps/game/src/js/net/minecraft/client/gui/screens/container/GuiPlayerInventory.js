import GuiContainerSurvival from "./GuiContainerSurvival.js";
import GuiPlayerTexture from "./GuiPlayerTexture.js";
import ModelPlayer from "../../../render/model/model/ModelPlayer.js";
import Tessellator from "../../../render/Tessellator.js";
import MathHelper from "../../../../util/MathHelper.js";
import Block from "../../../world/block/Block.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import * as THREE from "../../../../../../../../libraries/three.module.js";

export default class GuiPlayerInventory extends GuiContainerSurvival {

    static rect = { x: 273, y: 169, w: 60, h: 85 };
    static RENDER_SCALE = 6;

    constructor(player) {
        super(player);

        this.model = new ModelPlayer();
        this.modelGroup = new THREE.Object3D();
        this.modelReady = false;

        this.clock = new THREE.Clock();
        this.animTime = 0;

        this.renderCanvas = null;
        this.glRenderer = null;
        this.scene = null;
        this.camera = null;

        this.itemGroup = null;
        this.lastHeldItemId = -1;
    }

    init() {
        const r = GuiPlayerInventory.rect;
        const rs = GuiPlayerInventory.RENDER_SCALE;
        const cw = r.w * rs;
        const ch = r.h * rs;

        this.renderCanvas = document.createElement('canvas');
        this.renderCanvas.width = cw;
        this.renderCanvas.height = ch;

        this.previewTexture = null;
        this.skinImage = null;
        this.playerMeshes = [];

        try {
            this.skinImage = this.getPlayerSkinImage();
            const tex = GuiPlayerTexture.createSharpTexture(this.minecraft.resources, this.skinImage);
            this.previewTexture = tex;
            if (tex) {
                const skinHeight = this.skinImage?.naturalHeight || this.skinImage?.height || 32;
                this.model = new ModelPlayer(skinHeight >= 64 ? 64 : 32);
                const t = new Tessellator();
                t.setColor(1, 1, 1);
                t.bindTexture(tex);
                this.model.rebuild(t, this.modelGroup);
                this.modelGroup.traverse(child => {
                    if (child.isMesh) {
                        this.playerMeshes.push(child);
                    }
                });
                this.itemGroup = new THREE.Object3D();
                this.model.rightArm.bone.add(this.itemGroup);
                this.modelGroup.position.set(0, 8, 0);

                this.glRenderer = new THREE.WebGLRenderer({
                    canvas: this.renderCanvas,
                    alpha: true,
                    antialias: true
                });
                this.glRenderer.setClearColor(0x000000, 0);
                this.glRenderer.setPixelRatio(1);
                this.glRenderer.setSize(cw, ch);

                const aspect = cw / ch;
                this.scene = new THREE.Scene();
                this.camera = new THREE.PerspectiveCamera(18, aspect, 1, 250);
                this.camera.position.set(0, 0, 135);
                this.camera.lookAt(0, 0, 0);

                this.scene.add(this.modelGroup);
                this.modelReady = true;
            }
        } catch (e) {
            console.warn('GuiPlayerInventory init error:', e);
        }

        super.init();
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        super.drawScreen(stack, mouseX, mouseY, partialTicks);

        if (this.modelReady) {
            this.renderPlayerPreview(stack, mouseX, mouseY, partialTicks);
        }
    }

    getPlayerSkinImage() {
        const player = this.minecraft?.player;
        const renderer = player?.renderer;
        if (!renderer || typeof renderer.getTextureForEntity !== 'function') {
            return null;
        }
        const texture = renderer.getTextureForEntity(player);
        return texture && texture.image ? texture.image : null;
    }

    updatePlayerSkinPreview() {
        const skinImage = this.getPlayerSkinImage();
        if (skinImage === this.skinImage) return;
        this.skinImage = skinImage;

        const tex = GuiPlayerTexture.createSharpTexture(this.minecraft.resources, skinImage);
        if (!tex) return;
        if (this.previewTexture) this.previewTexture.dispose();
        this.previewTexture = tex;

        const skinHeight = skinImage?.naturalHeight || skinImage?.height || 32;
        const atlasHeight = skinHeight >= 64 ? 64 : 32;
        if (this.model.textureHeight !== atlasHeight) {
            this.modelGroup.clear();
            this.model = new ModelPlayer(atlasHeight);
            const tessellator = new Tessellator();
            tessellator.setColor(1, 1, 1);
            tessellator.bindTexture(tex);
            this.model.rebuild(tessellator, this.modelGroup);
            this.playerMeshes = [];
            this.modelGroup.traverse(child => {
                if (child.isMesh) this.playerMeshes.push(child);
            });
            this.itemGroup = new THREE.Object3D();
            this.model.rightArm.bone.add(this.itemGroup);
            this.lastHeldItemId = -1;
            return;
        }

        for (const mesh of this.playerMeshes) {
            if (mesh.material) {
                mesh.material.map = tex;
                mesh.material.needsUpdate = true;
            }
        }
    }

    renderPlayerPreview(stack, mouseX, mouseY, partialTicks) {
        const r = GuiPlayerInventory.rect;
        if (!r || !this.glRenderer) return;

        this.updatePlayerSkinPreview();

        this.animTime = this.clock.getElapsedTime() * 20;

        const player = this.minecraft.player;
        if (!player || !this.itemGroup) return;

        const itemStack = player.inventory.getItemInSelectedSlot();
        const itemId = itemStack.getType();
        const hasItem = !itemStack.isEmpty();

        if (hasItem && (itemId !== this.lastHeldItemId || this.itemGroup.children.length === 0)) {
            while (this.itemGroup.children.length > 0) {
                this.itemGroup.remove(this.itemGroup.children[0]);
            }
            const block = Block.getById(itemId);
            if (block) {
                try {
                    const blockRenderer = this.minecraft.worldRenderer.blockRenderer;
                    blockRenderer.renderBlockInHandThirdPerson(this.itemGroup, block, player.getEntityBrightness());
                    const isBlock = block.getRenderType() === BlockRenderType.BLOCK;
                    for (let child of this.itemGroup.children) {
                        if (child.isMesh) {
                            child.material = child.material.clone();
                            child.material.depthTest = false;
                            child.material.depthWrite = false;
                            child.material.side = isBlock ? THREE.DoubleSide : THREE.FrontSide;
                            child.renderOrder = 1;
                        }
                    }
                    this.lastHeldItemId = itemId;
                } catch (e) {
                    console.warn('GuiPlayerInventory item render error:', e);
                }
            }
        } else if (!hasItem && this.lastHeldItemId !== -1) {
            this.lastHeldItemId = -1;
            while (this.itemGroup.children.length > 0) {
                this.itemGroup.remove(this.itemGroup.children[0]);
            }
        }

        this.model.hasItemInHand = hasItem;
        this.model.swingProgress = player.getSwingProgress(partialTicks || 0);

        const relX = r.x - 252;
        const relY = r.y - 167;

        const modelCX = this.x + relX + r.w * 0.5;
        const modelCY = this.y + relY + r.h * 0.55;

        const dx = mouseX - modelCX;
        const dy = mouseY - modelCY;

        const totalYaw = Math.max(-60, Math.min(60, -dx * 0.2));
        const pitch = Math.max(-25, Math.min(25, dy * 0.2));

        const headLimit = 20;
        const headYaw = Math.max(-headLimit, Math.min(headLimit, totalYaw));
        const bodyYaw = totalYaw - headYaw;

        this.modelGroup.scale.set(-1, -1, 1);
        this.modelGroup.rotation.y = MathHelper.toRadians(-bodyYaw + 180);

        this.model.setRotationAngles(
            this.modelGroup,
            0,
            0,
            this.animTime,
            headYaw,
            pitch,
            0
        );

        this.model.render(
            this.modelGroup,
            0,
            0,
            this.animTime,
            headYaw,
            pitch,
            0
        );

        this.modelGroup.updateMatrixWorld(true);

        this.glRenderer.render(this.scene, this.camera);

        stack.save();
        stack.translate(Math.floor(this.x + relX), Math.floor(this.y + relY));
        stack.drawImage(this.renderCanvas, 0, 0, r.w, r.h);
        stack.restore();
    }

    onClose() {
        super.onClose();
        if (this.glRenderer) {
            this.glRenderer.dispose();
        }
    }

}
