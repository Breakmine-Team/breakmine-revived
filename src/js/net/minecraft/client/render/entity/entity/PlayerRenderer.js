import ModelPlayer from "../../model/model/ModelPlayer.js";
import { createCapeGeometry } from "../../CapeGeometry.js";
import EntityRenderer from "../EntityRenderer.js";
import Block from "../../../world/block/Block.js";
import Tessellator from "../../Tessellator.js";
import * as AuthLib from "../../../network/AuthLib.js";
import * as THREE from "../../../../../../../../libraries/three.module.js";

const skinLoadVersions = new Map();

export default class PlayerRenderer extends EntityRenderer {

    static instances = new Set();

    constructor(worldRenderer) {
        super(new ModelPlayer());

        PlayerRenderer.instances.add(this);
        this.worldRenderer = worldRenderer;

        this.defaultTexture = worldRenderer.minecraft.getThreeTexture('char.png');
        this.defaultTexture.magFilter = THREE.NearestFilter;
        this.defaultTexture.minFilter = THREE.NearestFilter;
        this.textureCharacter = this.defaultTexture;

        this.skinTextures = new Map();
        this.pendingSkinLoads = new Map();
        this.lastEntity = null;

        this.capeMesh = null;
        this.capeAngle = 0;

        this.handModel = null;
        this.firstPersonGroup = new THREE.Object3D();
        this.worldRenderer.overlay.add(this.firstPersonGroup);

        this.nametagGroup = new THREE.Object3D();
        this.nametagSprite = null;
        this.nametagTexture = null;
        this.worldRenderer.overlay.add(this.nametagGroup);

        this.shadowGroup = new THREE.Object3D();
        this.shadowSprite = null;
        this.worldRenderer.scene.add(this.shadowGroup);
    }

    static invalidateSkinCache(username) {
        const nextVersion = (skinLoadVersions.get(username) || 0) + 1;
        skinLoadVersions.set(username, nextVersion);

        for (const renderer of PlayerRenderer.instances) {
            if (renderer.skinTextures) {
                renderer.skinTextures.delete(username);
            }
            if (renderer.pendingSkinLoads) {
                renderer.pendingSkinLoads.delete(username);
            }
            if (renderer.lastEntity) {
                renderer.rebuild(renderer.lastEntity);
            } else {
                renderer.group.buildMeta = undefined;
            }
        }
    }

    getTextureForEntity(entity) {
        const username = entity && entity.username ? entity.username : null;
        const sessionUsername = this.worldRenderer?.minecraft?.getSession?.()?.getProfile?.()?.getUsername?.();
        const effectiveUsername = username || sessionUsername || null;

        if (!effectiveUsername) {
            return this.defaultTexture;
        }

        if (this.skinTextures.has(effectiveUsername)) {
            return this.skinTextures.get(effectiveUsername);
        }

        if (!this.pendingSkinLoads.has(effectiveUsername)) {
            this.pendingSkinLoads.set(effectiveUsername, this.loadSkinTexture(effectiveUsername, entity));
        }

        return this.defaultTexture;
    }

    async loadSkinTexture(username, entity) {
        const skinVersion = skinLoadVersions.get(username) || 0;
        const skinUrl = `${AuthLib.getSkinUrl(username)}?t=${Date.now()}`;

        try {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                if ((skinLoadVersions.get(username) || 0) !== skinVersion) {
                    return;
                }

                const texture = new THREE.CanvasTexture(image);
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                texture.generateMipmaps = false;

                this.skinTextures.set(username, texture);
                this.pendingSkinLoads.delete(username);

                this.group.buildMeta = undefined;
                if (this.lastEntity) {
                    this.rebuild(this.lastEntity);
                }
            };
            image.onerror = () => {
                if ((skinLoadVersions.get(username) || 0) !== skinVersion) {
                    return;
                }

                this.pendingSkinLoads.delete(username);
                this.skinTextures.set(username, this.defaultTexture);
            };
            image.src = skinUrl;
        } catch (error) {
            this.pendingSkinLoads.delete(username);
            this.skinTextures.set(username, this.defaultTexture);
            console.warn(`Failed to load skin for ${username}:`, error);
        }

        return null;
    }

    rebuild(entity) {
        let isSelf = entity === this.worldRenderer.minecraft.player;
        let firstPerson = this.worldRenderer.minecraft.settings.thirdPersonView === 0;
        let itemStack = firstPerson && isSelf ? this.worldRenderer.itemToRender : entity.inventory.getItemInSelectedSlot();
        let itemId = itemStack.getType();
        let hasItem = !itemStack.isEmpty();

        if (firstPerson && hasItem && isSelf) {
            super.rebuild(entity);

            this.firstPersonGroup.clear();
            let itemGroup = new THREE.Object3D();
            this.firstPersonGroup.add(itemGroup);

            let block = Block.getById(itemId);
            if (block !== null) {
                this.worldRenderer.blockRenderer.renderBlockInFirstPerson(itemGroup, block, entity.getEntityBrightness());

                if (itemGroup.children.length > 0) {
                    let mesh = itemGroup.children[0];
                    mesh.material = mesh.material.clone();
                    if (mesh.geometry?.getAttribute('aTileRect')) {
                        Tessellator.applyTileWrap(mesh.material);
                    }
                    mesh.material.depthTest = false;
                }
            }
        } else {
            this.tessellator.bindTexture(this.getTextureForEntity(entity));
            super.rebuild(entity);

            if (hasItem) {
                let block = Block.getById(itemId);
                if (block !== null) {
                    let group = this.model.rightArm.bone;
                    this.worldRenderer.blockRenderer.renderBlockInHandThirdPerson(group, block, entity.getEntityBrightness());

                    if (group.children.length > 0) {
                        let itemMesh = group.children[group.children.length - 1];
                        itemMesh.material.depthTest = false;
                        itemMesh.material.depthWrite = false;
                        itemMesh.renderOrder = 1;
                    }
                }
            }

            this.firstPersonGroup.clear();
            this.handModel = this.model.rightArm.clone();
            this.firstPersonGroup.add(this.handModel.bone);

            let mesh = this.handModel.bone.children[0];
            mesh.material = this.tessellator.unlitMaterial.clone();
            mesh.material.depthTest = false;
        }

        const capeService = this.worldRenderer.minecraft.modLoader?.getService('cape_plus');
        if (capeService) {
            this.capeMesh = null;
            capeService.onRendererRebuilt?.(this, entity);
        } else {
            this.buildCape(entity);
        }
    }

    
    buildCape(entity) {
        this.capeMesh = null;
        this.capeAngle = 0;

        const texture = this.worldRenderer.minecraft.capeManager?.getTexture(entity?.username);
        if (!texture || !this.model?.body?.bone) return;

        const userData = texture.userData || {};
        const geometry = createCapeGeometry(userData.capeWidth || 64, userData.capeHeight || 32);

        const rawBrightness = entity?.getEntityBrightness?.();
        const brightness = Number.isFinite(rawBrightness) ? Math.max(0, Math.min(1, rawBrightness)) : 1;
        const vertexCount = geometry.getAttribute('position').count;
        const colors = new Float32Array(vertexCount * 3).fill(brightness);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            vertexColors: true,
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
            depthWrite: true
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0, 2.1);
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        this.model.body.bone.add(mesh);
        this.capeMesh = mesh;
    }

    
    updateCape(entity) {
        if (!this.capeMesh) return;

        const dx = entity.x - entity.prevX;
        const dz = entity.z - entity.prevZ;
        const dy = entity.y - entity.prevY;

        const horizontal = Math.min(0.1, Math.hypot(dx, dz));
        let target = 0.06 + horizontal * 4.0;

        if (dy < 0) {
            target += Math.min(0.8, -dy * 3.0);
        } else {
            target -= Math.min(0.2, dy * 2.0);
        }

        target += Math.sin(entity.ticksExisted * 0.35) * 0.015;
        target = Math.max(0.02, Math.min(1.1, target));

        this.capeAngle += (target - this.capeAngle) * 0.2;
        this.capeMesh.rotation.x = this.capeAngle;
    }

    render(entity, partialTicks) {
        this.lastEntity = entity;

        let swingProgress = entity.swingProgress - entity.prevSwingProgress;
        if (swingProgress < 0.0) {
            swingProgress++;
        }
        this.model.swingProgress = entity.prevSwingProgress + swingProgress * partialTicks;
        this.model.hasItemInHand = !entity.inventory.getItemInSelectedSlot().isEmpty();
        this.model.isSneaking = entity.isSneaking();

        if (entity !== this.worldRenderer.minecraft.player) {
            this.firstPersonGroup.visible = false;
        }

        super.render(entity, partialTicks);

        this.updateCape(entity);

        const capeService = this.worldRenderer.minecraft.modLoader?.getService('cape_plus');
        capeService?.render?.(this, entity, partialTicks);

        this.renderShadow(entity, partialTicks);

        let isThirdPerson = this.worldRenderer.minecraft.settings.thirdPersonView !== 0;
        if ((entity !== this.worldRenderer.minecraft.player || isThirdPerson) && entity.username && !entity.isSneaking()) {
            this.renderNametag(entity, partialTicks);
        } else {
            this.nametagGroup.visible = false;
        }
    }

    renderShadow(entity, partialTicks) {
        if (!this.worldRenderer.shadowsEnabled) {
            this.shadowGroup.visible = false;
            return;
        }

        if (!entity.onGround) {
            this.shadowGroup.visible = false;
            return;
        }

        if (!this.shadowMesh) {
            const texture = this.worldRenderer.minecraft.getThreeTexture('terrain/pack/minecraft/textures/misc/shadow.png');
            if (!texture) {
                this.shadowGroup.visible = false;
                return;
            }

            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: 0.5,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            const geometry = new THREE.PlaneGeometry(1, 1);
            this.shadowMesh = new THREE.Mesh(geometry, material);
            this.shadowMesh.rotation.x = -Math.PI / 2;
            this.shadowGroup.add(this.shadowMesh);
        }

        let interpolatedX = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        let interpolatedY = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        let interpolatedZ = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;

        this.shadowGroup.position.set(interpolatedX, interpolatedY + 0.01, interpolatedZ);

        this.shadowGroup.visible = true;
    }

    updateFirstPerson(player) {
        this.prepareModel(player);

        this.firstPersonGroup.visible = true;
    }

    renderRightHand(player, partialTicks) {
        this.updateFirstPerson(player);

        this.model.swingProgress = 0;
        this.model.hasItemInHand = false;
        this.model.isSneaking = false;
        this.model.setRotationAngles(player, 0, 0, 0, 0, 0, 0);
        this.handModel.copyTransformOf(this.model.rightArm);

        this.handModel.render();
    }

    fillMeta(entity, meta) {
        super.fillMeta(entity, meta);

        let firstPerson = this.worldRenderer.minecraft.settings.thirdPersonView === 0;

        meta.firstPerson = firstPerson;
        meta.itemInHand = firstPerson ? this.worldRenderer.itemToRender : entity.inventory.getItemInSelectedSlot();

        const capeService = this.worldRenderer.minecraft.modLoader?.getService('cape_plus');
        if (capeService?.getVersion) {
            meta.cape = capeService.getVersion(entity);
        }
    }

    renderNametag(entity, partialTicks) {
        if (!this.nametagTexture || this.nametagUsername !== entity.username) {
            this.nametagUsername = entity.username;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const fontRenderer = this.worldRenderer.minecraft.fontRenderer;

            let textWidth = 0;
            for (let i = 0; i < entity.username.length; i++) {
                textWidth += fontRenderer.charWidths[entity.username.charCodeAt(i)] || 6;
            }

            let padX = 4;
            let padY = 2;
            canvas.width = textWidth + padX * 2;
            canvas.height = 8 + padY * 2;

            ctx.imageSmoothingEnabled = false;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            fontRenderer.drawStringRaw(ctx, entity.username, padX, padY, 0xFFFFFF, false, "8", false);

            if (this.nametagTexture) {
                this.nametagTexture.dispose();
            }
            this.nametagTexture = new THREE.CanvasTexture(canvas);
            this.nametagTexture.magFilter = THREE.NearestFilter;
            this.nametagTexture.minFilter = THREE.NearestFilter;
        }

        if (!this.nametagSprite) {
            const material = new THREE.SpriteMaterial({
                map: this.nametagTexture,
                transparent: true,
                depthTest: false
            });
            this.nametagSprite = new THREE.Sprite(material);
            this.nametagGroup.add(this.nametagSprite);
        }

        this.nametagSprite.material.map = this.nametagTexture;

        let interpolatedX = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        let interpolatedY = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        let interpolatedZ = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;

        this.nametagGroup.position.set(interpolatedX, interpolatedY + 2.0, interpolatedZ);

        const worldScale = 0.016;
        this.nametagSprite.scale.set(
            this.nametagTexture.image.width * worldScale,
            this.nametagTexture.image.height * worldScale,
            1
        );

        this.nametagGroup.visible = true;
        this.nametagSprite.visible = true;
        this.nametagGroup.lookAt(this.worldRenderer.camera.position);
    }

}
