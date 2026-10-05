import ModelPlayer from "../../model/model/ModelPlayer.js";
import EntityRenderer from "../EntityRenderer.js";
import Block from "../../../world/block/Block.js";
import * as AuthLib from "../../../network/AuthLib.js";
import * as THREE from "../../../../../../../../libraries/three.module.js";

const skinLoadVersions = new Map();

export default class PlayerRenderer extends EntityRenderer {

    static instances = new Set();

    constructor(worldRenderer) {
        super(new ModelPlayer());

        PlayerRenderer.instances.add(this);
        this.worldRenderer = worldRenderer;

        // Load default character texture
        this.defaultTexture = worldRenderer.minecraft.getThreeTexture('char.png');
        this.defaultTexture.magFilter = THREE.NearestFilter;
        this.defaultTexture.minFilter = THREE.NearestFilter;
        this.textureCharacter = this.defaultTexture;

        this.skinTextures = new Map();
        this.pendingSkinLoads = new Map();
        this.lastEntity = null;

        // First person right-hand holder
        this.handModel = null;
        this.firstPersonGroup = new THREE.Object3D();
        this.worldRenderer.overlay.add(this.firstPersonGroup);

        // Nametag group (added to scene directly, not entity group, to avoid entity scale)
        this.nametagGroup = new THREE.Object3D();
        this.nametagSprite = null;
        this.nametagTexture = null;
        this.worldRenderer.overlay.add(this.nametagGroup);

        // Shadow sprite rendered below the entity
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

                // Force a rebuild so the skin applies immediately, even if the
                // entity has not been rendered yet (e.g. local player in first person)
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

            // Create new item group and add it to the hand
            this.firstPersonGroup.clear();
            let itemGroup = new THREE.Object3D();
            this.firstPersonGroup.add(itemGroup);

            // Render item in hand in first person
            let block = Block.getById(itemId);
            if (block !== null) {
                this.worldRenderer.blockRenderer.renderBlockInFirstPerson(itemGroup, block, entity.getEntityBrightness());

                // Copy material and update depth test of the item to render it always in front
                if (itemGroup.children.length > 0) {
                    let mesh = itemGroup.children[0];
                    mesh.material = mesh.material.clone();
                    mesh.material.depthTest = false;
                }
            }
        } else {
            this.tessellator.bindTexture(this.getTextureForEntity(entity));
            super.rebuild(entity);

            // Render item in hand in third person
            if (hasItem) {
                let block = Block.getById(itemId);
                if (block !== null) {
                    let group = this.model.rightArm.bone;
                    this.worldRenderer.blockRenderer.renderBlockInHandThirdPerson(group, block, entity.getEntityBrightness());

                    // Prevent legs from overwriting item in depth buffer
                    if (group.children.length > 0) {
                        let itemMesh = group.children[group.children.length - 1];
                        itemMesh.material.depthTest = false;
                        itemMesh.material.depthWrite = false;
                        itemMesh.renderOrder = 1;
                    }
                }
            }

            // Create first person right hand and attach it to the holder
            this.firstPersonGroup.clear();
            this.handModel = this.model.rightArm.clone();
            this.firstPersonGroup.add(this.handModel.bone);

            // Copy material and update depth test of the hand to render it always in front
            let mesh = this.handModel.bone.children[0];
            // The overlay scene has no lights, so the hand has to render unlit
            mesh.material = this.tessellator.unlitMaterial.clone();
            mesh.material.depthTest = false;
        }

        const capeService = this.worldRenderer.minecraft.modLoader?.getService('cape_plus');
        capeService?.onRendererRebuilt?.(this, entity);
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

        // TODO find a better way
        if (entity !== this.worldRenderer.minecraft.player) {
            this.firstPersonGroup.visible = false;
        }

        super.render(entity, partialTicks);

        const capeService = this.worldRenderer.minecraft.modLoader?.getService('cape_plus');
        capeService?.render?.(this, entity, partialTicks);

        // Render shadow below the entity
        this.renderShadow(entity, partialTicks);

        // Render nametag for other players, or for local player in third person
        let isThirdPerson = this.worldRenderer.minecraft.settings.thirdPersonView !== 0;
        if ((entity !== this.worldRenderer.minecraft.player || isThirdPerson) && entity.username && !entity.isSneaking()) {
            this.renderNametag(entity, partialTicks);
        } else {
            this.nametagGroup.visible = false;
        }
    }

    renderShadow(entity, partialTicks) {
        // Entity blob shadows follow the Shadows graphics option
        if (!this.worldRenderer.shadowsEnabled) {
            this.shadowGroup.visible = false;
            return;
        }

        // Only render shadow when entity is on the ground
        if (!entity.onGround) {
            this.shadowGroup.visible = false;
            return;
        }

        // Create shadow mesh on first render
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

            // Shadow dimensions matching source image proportions at original resolution
            const geometry = new THREE.PlaneGeometry(1, 1);
            this.shadowMesh = new THREE.Mesh(geometry, material);
            // Lay flat on the ground (rotate from XY plane to XZ plane)
            this.shadowMesh.rotation.x = -Math.PI / 2;
            this.shadowGroup.add(this.shadowMesh);
        }

        // Interpolate entity position
        let interpolatedX = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        let interpolatedY = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        let interpolatedZ = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;

        // Position shadow at entity's feet, slightly above ground to avoid z-fighting
        this.shadowGroup.position.set(interpolatedX, interpolatedY + 0.01, interpolatedZ);

        this.shadowGroup.visible = true;
    }

    updateFirstPerson(player) {
        // Make sure the model is created
        this.prepareModel(player);

        // Make the group visible
        this.firstPersonGroup.visible = true;
    }

    renderRightHand(player, partialTicks) {
        this.updateFirstPerson(player);

        // Set transform of renderer
        this.model.swingProgress = 0;
        this.model.hasItemInHand = false;
        this.model.isSneaking = false;
        this.model.setRotationAngles(player, 0, 0, 0, 0, 0, 0);
        this.handModel.copyTransformOf(this.model.rightArm);

        // Render hand model
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
        // Create or update nametag texture
        if (!this.nametagTexture || this.nametagUsername !== entity.username) {
            this.nametagUsername = entity.username;

            // Create canvas for nametag
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const fontRenderer = this.worldRenderer.minecraft.fontRenderer;

            // Measure text - calculate width manually
            let textWidth = 0;
            for (let i = 0; i < entity.username.length; i++) {
                textWidth += fontRenderer.charWidths[entity.username.charCodeAt(i)] || 6;
            }

            let padX = 4;
            let padY = 2;
            canvas.width = textWidth + padX * 2;
            canvas.height = 8 + padY * 2;

            // Disable smoothing for pixel-perfect text
            ctx.imageSmoothingEnabled = false;

            // Draw semi-transparent black background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Render text using font renderer's internal method
            fontRenderer.drawStringRaw(ctx, entity.username, padX, padY, 0xFFFFFF, false, "8", false);

            // Create texture from canvas
            if (this.nametagTexture) {
                this.nametagTexture.dispose();
            }
            this.nametagTexture = new THREE.CanvasTexture(canvas);
            this.nametagTexture.magFilter = THREE.NearestFilter;
            this.nametagTexture.minFilter = THREE.NearestFilter;
        }

        // Create or update sprite
        if (!this.nametagSprite) {
            const material = new THREE.SpriteMaterial({
                map: this.nametagTexture,
                transparent: true,
                depthTest: false
            });
            this.nametagSprite = new THREE.Sprite(material);
            this.nametagGroup.add(this.nametagSprite);
        }

        // Update sprite texture
        this.nametagSprite.material.map = this.nametagTexture;

        // Interpolate entity position for smooth rendering
        let interpolatedX = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        let interpolatedY = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        let interpolatedZ = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;

        // Position nametag above player head in world space
        this.nametagGroup.position.set(interpolatedX, interpolatedY + 2.0, interpolatedZ);

        // Scale sprite in world units
        const worldScale = 0.016;
        this.nametagSprite.scale.set(
            this.nametagTexture.image.width * worldScale,
            this.nametagTexture.image.height * worldScale,
            1
        );

        // Make nametag visible and face camera
        this.nametagGroup.visible = true;
        this.nametagSprite.visible = true;
        this.nametagGroup.lookAt(this.worldRenderer.camera.position);
    }

}
