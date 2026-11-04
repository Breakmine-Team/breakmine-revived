import * as THREE from '../../../../../../../../libraries/three.module.js';
import EntityRenderer from '../EntityRenderer.js';
import ModelUndeadBiped from '../../model/model/ModelUndeadBiped.js';
import { MOB_ENTITY_TYPES } from '../../../entity/MobEntity.js';
import { createSpriteItemMesh } from '../../SpriteItemGeometry.js';
import { createTridentModel, attachHeldItemModel, applyHeldItemDisplay } from '../../HeldItemModel.js';
import BlockRenderType from '../../../../util/BlockRenderType.js';
export default class MobRenderer extends EntityRenderer {
    constructor(worldRenderer, type) {
        const definition = MOB_ENTITY_TYPES[type];
        if (!definition) throw new Error(`No renderer definition for ${type}`);
        super(new ModelUndeadBiped(definition.family, definition.skinLayout));
        this.worldRenderer = worldRenderer;
        this.dynamicLighting = true;
        // Entity skins are opaque cutout textures, not translucent world
        // surfaces. Tessellator's default is the chunk transparent-pass
        // material; keeping mobs on it makes limbs blend/sort against water.
        this.tessellator.material.transparent = false;
        this.tessellator.material.alphaTest = 0.1;
        this.tessellator.material.depthTest = true;
        this.tessellator.material.depthWrite = true;
        this.texture = worldRenderer.minecraft.getThreeTexture(definition.texture);
        if (this.texture) {
            this.texture.magFilter = THREE.NearestFilter;
            this.texture.minFilter = THREE.NearestFilter;
        }
        this.overlayTexture = definition.overlayTexture
            ? worldRenderer.minecraft.getThreeTexture(definition.overlayTexture)
            : null;
        if (this.overlayTexture) {
            this.overlayTexture.magFilter = THREE.NearestFilter;
            this.overlayTexture.minFilter = THREE.NearestFilter;
        }
        this.overlayMaterials = [];
        this.heldWeaponMesh = null;
        this.heldBowFrame = null;
        this.heldWeaponMeshes = [];
        this.heldWeaponTextures = new Map();
        this.handPivotOffset = new THREE.Vector3();
        this.inverseArmRotation = new THREE.Quaternion();
    }

    rebuild(entity) {
        for (const material of this.overlayMaterials) material.dispose();
        this.overlayMaterials.length = 0;
        for (const mesh of this.heldWeaponMeshes) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.heldWeaponMeshes.length = 0;
        this.heldWeaponMesh = null;
        this.heldBowFrame = null;
        super.rebuild(entity);

        const weapon = entity.heldWeaponTexture;
        this.heldItemDisplay = null;
        if (weapon) {
            const arm = this.model.model.rightArm.bone;
            // Use precisely the player's BlockRenderer attachment/model path.
            // Minimal/headless renderers can still use the same shared hand layer.
            const blockRenderer = this.worldRenderer.blockRenderer;
            if (blockRenderer) this.heldItemDisplay = blockRenderer.renderBlockInHandThirdPerson(arm, {
                tex: weapon, isTool: true, getRenderType: () => BlockRenderType.ITEM
            }, 1);
            if (!this.heldItemDisplay) {
                const texture = this.getHeldWeaponTexture(weapon);
                const model = weapon === 'trident' ? createTridentModel(texture) : createSpriteItemMesh(texture);
                if (model) this.heldItemDisplay = attachHeldItemModel(arm, model, weapon);
            }
            if (this.heldItemDisplay) {
                this.heldItemDisplay.traverse(mesh => {
                    if (!mesh.isMesh) return;
                    mesh.name = 'mobHeldWeapon';
                    mesh.userData.mobHeldWeapon = true;
                    mesh.userData.dynamicHeldItemLight = true;
                    this.heldWeaponMeshes.push(mesh);
                    this.heldWeaponMesh ??= mesh;
                });
            }
        }
        if (!this.overlayTexture) return;

        // The JAR's Drowned/Stray overlay PNGs use the base model UV layout.
        // Draw an alpha-cutout copy immediately after each base mesh so the
        // secondary skin details survive the legacy shared undead geometry.
        const baseMeshes = [];
        this.group.traverse(child => {
            if (child.isMesh && !child.userData.mobHeldWeapon) baseMeshes.push(child);
        });
        for (const mesh of baseMeshes) {
            const overlay = mesh.clone();
            overlay.material = mesh.material.clone();
            overlay.material.map = this.overlayTexture;
            overlay.material.transparent = true;
            overlay.material.alphaTest = 0.1;
            overlay.material.depthWrite = false;
            overlay.material.polygonOffset = true;
            overlay.material.polygonOffsetFactor = -1;
            overlay.material.polygonOffsetUnits = -1;
            overlay.renderOrder = mesh.renderOrder + 1;
            overlay.userData.mobOverlay = true;
            this.overlayMaterials.push(overlay.material);
            mesh.parent.add(overlay);
        }
    }

    prepareModel(entity) {
        this.model.setTexture(this.texture);
        if (this.texture) this.tessellator.bindTexture(this.texture);
        super.prepareModel(entity);
    }

    getHeldWeaponTexture(name) {
        if (!this.heldWeaponTextures.has(name)) {
            const path = name === 'trident'
                ? 'terrain/pack/minecraft/textures/entity/trident_model.png'
                : `terrain/pack/minecraft/textures/items/${name}.png`;
            const texture = this.worldRenderer.minecraft.getThreeTexture(path) ?? null;
            if (texture) {
                texture.magFilter = texture.minFilter = THREE.NearestFilter;
                texture.generateMipmaps = false;
                // Extruded sprites use image-top UVs; cuboid skins use bottom UVs.
                texture.flipY = name === 'trident';
                texture.needsUpdate = true;
            }
            this.heldWeaponTextures.set(name, texture);
        }
        return this.heldWeaponTextures.get(name);
    }

    render(entity, partialTicks) {
        const skeletonModel = this.model.model;
        if (skeletonModel.rightArm) {
            const swingProgress = entity.getSwingAnimation?.(partialTicks) ??
                (entity.prevSwingProgress + (entity.swingProgress - entity.prevSwingProgress) * partialTicks);
            skeletonModel.swingProgress = swingProgress || 0;
            skeletonModel.isAggressive = Boolean(entity.attackTarget);
            skeletonModel.isThrowingTrident = entity.entityType === 'minecraft:drowned' &&
                entity.heldWeaponTexture === 'trident' && Boolean(entity.attackTarget);
            skeletonModel.aiming = entity.mobFamily === 'skeleton' &&
                entity.heldWeaponTexture === 'bow' && Boolean(entity.attackTarget);
            skeletonModel.swimAmount = entity.getSwimAmount?.(partialTicks) ?? 0;
            skeletonModel.drowned = entity.entityType === 'minecraft:drowned';
            if ('hasItemInHand' in skeletonModel) skeletonModel.hasItemInHand = Boolean(entity.heldWeaponTexture);
        }
        super.render(entity, partialTicks);
        if (this.heldWeaponMesh) {
            applyHeldItemDisplay(this.heldItemDisplay, entity.heldWeaponTexture, skeletonModel.isThrowingTrident);
            // SkeletonModel.translateToHand shifts the narrow arm's pivot X
            // by +1 before arm rotation. Compensate in arm-local coordinates
            // without moving the visible arm or rotating that correction.
            const arm = skeletonModel.rightArm.bone;
            this.inverseArmRotation.copy(arm.quaternion).invert();
            this.handPivotOffset.set(entity.mobFamily === 'skeleton' ? 1 : 0, 0, 0)
                .applyQuaternion(this.inverseArmRotation);
            this.heldItemDisplay.parent.parent.position.copy(this.handPivotOffset);
            const textureName = entity.heldWeaponTexture === 'bow' && entity.rangedChargeTicks > 0
                ? entity.rangedChargeTicks < 5 ? 'bow_pulling_0'
                    : entity.rangedChargeTicks < 10 ? 'bow_pulling_1' : 'bow_pulling_2'
                : entity.heldWeaponTexture;
            const texture = this.getHeldWeaponTexture(textureName);
            if (entity.heldWeaponTexture === 'bow' && this.heldBowFrame !== textureName) {
                // Pulling models have different alpha outlines. Updating only
                // the texture leaves the old extrusion/edge mesh behind.
                const frame = createSpriteItemMesh(texture);
                if (frame) {
                    this.heldWeaponMesh.geometry.dispose();
                    this.heldWeaponMesh.geometry = frame.geometry;
                    frame.material.dispose();
                    this.heldBowFrame = textureName;
                }
            }
            for (const mesh of this.heldWeaponMeshes) mesh.material.map = texture;
        }
    }

    getModelScale(entity) { return entity.height / 32; }

    fillMeta(entity, meta) {
        super.fillMeta(entity, meta);
        meta.shadowSize = entity.width * 0.5;
        meta.weapon = entity.heldWeaponTexture;
    }
}
