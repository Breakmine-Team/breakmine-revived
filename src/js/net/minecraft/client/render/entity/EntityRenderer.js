import Tessellator from "../Tessellator.js";
import MathHelper from "../../../util/MathHelper.js";
import * as THREE from "../../../../../../../libraries/three.module.js";

export default class EntityRenderer {

    constructor(model) {
        this.model = model;
        this.tessellator = new Tessellator();
        this.group = new THREE.Object3D();
        this.hurtTimestamp = 0;
        this.modelOffset = new THREE.Vector3();
    }

    rebuild(entity) {
        // Create meta for group
        let meta = {};
        this.fillMeta(entity, meta);
        this.group.buildMeta = meta;

        // Clear meshes
        this.group.clear();

        // Apply brightness and rebuild
        let brightness = this.dynamicLighting ? 1 : this.group.buildMeta.brightness;
        this.tessellator.setColor(brightness, brightness, brightness);
        this.model.rebuild(this.tessellator, this.group);
    }

    fillMeta(entity, meta) {
        meta.brightness = entity.getEntityBrightness();
    }

    isRebuildRequired(entity) {
        if (typeof this.group.buildMeta === "undefined") {
            return true;
        }

        // Compare meta of group
        let currentMeta = {};
        this.fillMeta(entity, currentMeta);
        let previousMeta = this.group.buildMeta;
        if (this.dynamicLighting) {
            previousMeta.brightness = currentMeta.brightness;
            for (const key of Object.keys(currentMeta)) {
                if (key !== 'brightness' && currentMeta[key] !== previousMeta[key]) return true;
            }
            return false;
        }
        return JSON.stringify(currentMeta) !== JSON.stringify(previousMeta);
    }

    render(entity, partialTicks) {
        this.prepareModel(entity);

        let rotationBody = this.interpolateRotation(entity.prevRenderYawOffset, entity.renderYawOffset, partialTicks);
        let rotationHead = this.interpolateRotation(entity.prevRotationYawHead, entity.rotationYawHead, partialTicks);

        let limbSwingStrength = entity.prevLimbSwingStrength + (entity.limbSwingStrength - entity.prevLimbSwingStrength) * partialTicks;
        let limbSwing = entity.limbSwingProgress - entity.limbSwingStrength * (1.0 - partialTicks);

        let yaw = rotationHead - rotationBody;
        let pitch = entity.prevRotationPitch + (entity.rotationPitch - entity.prevRotationPitch) * partialTicks;

        // Interpolate entity position
        let interpolatedX = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        let interpolatedY = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        let interpolatedZ = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;

        // Translate using interpolated position
        this.group.position.setX(interpolatedX);
        this.group.position.setY(interpolatedY);
        this.group.position.setZ(interpolatedZ);

        // Actual size of the entity
        let scale = this.getModelScale(entity);
        this.group.scale.set(-scale, -scale, scale);

        // Rotate entity model
        this.group.rotation.set(0, MathHelper.toRadians(-rotationBody + 180), 0);
        const currentDeathTime = Number.isFinite(entity.deathTime) ? entity.deathTime : 0;
        const previousDeathTime = Number.isFinite(entity.prevDeathTime) ? entity.prevDeathTime : currentDeathTime;
        const deathTime = previousDeathTime + (currentDeathTime - previousDeathTime) * partialTicks;
        const deathProgress = Math.min(1, Math.sqrt(Math.max(0, (deathTime - 1) * 1.6 / 20)));
        this.group.rotateZ(deathProgress * Math.PI / 2);
        this.modelOffset.set(0, 24 * scale, 0);
        const swim = entity.getSwimAmount?.(partialTicks) ?? 0;
        if (swim > 0 && (typeof entity.updatePlayerPose === 'function' || entity.entityType === 'minecraft:drowned')) {
            // AvatarRenderer / DrownedRenderer rotate the complete body. Bending
            // only the torso leaves the arms, head and collision pose upright.
            const tilt = swim * (-90 - (entity.isInWater?.() ? pitch : 0)) * Math.PI / 180;
            this.group.rotateX(tilt);
            if (entity.swimming || entity.height === .6) {
                this.modelOffset.y -= 1;
                this.modelOffset.z += .3;
            }
        }
        // LivingEntityRenderer translates the 24-pixel model origin AFTER
        // body rotation. Translating in world Y first leaves swimmers floating
        // above their hitbox, and changing an Euler axis afterwards loses tilt.
        this.group.position.add(this.modelOffset.applyQuaternion(this.group.quaternion));

        // Render entity model
        let timeAlive = entity.ticksExisted + partialTicks;
        let stack = entity.renderer.group;
        this.model.render(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks);

        const light = this.dynamicLighting ? this.group.buildMeta.brightness : 1;
        if (this.hurtTimestamp > 0 && performance.now() - this.hurtTimestamp < 300) {
            this.group.traverse(child => {
                if (child.isMesh) {
                    if (child.userData.dynamicHeldItemLight) {
                        const light = entity.getEntityBrightness();
                        child.material.color.setRGB(light, light * 2 / 3, light * 2 / 3);
                        return;
                    }
                    child.material.color.setRGB(light, light * 2 / 3, light * 2 / 3);
                    child.material.vertexColors = false;
                }
            });
        } else {
            this.group.traverse(child => {
                if (child.isMesh) {
                    if (child.userData.dynamicHeldItemLight) {
                        const light = entity.getEntityBrightness();
                        child.material.color.setRGB(light, light, light);
                    } else child.material.color.setRGB(light, light, light);
                    // Built-in voxel meshes have a per-vertex color
                    // attribute; renderer extensions (cape/nametag style
                    // textured meshes) may not. Enabling vertexColors on a
                    // geometry with no color buffer makes Three render it
                    // incorrectly, often as black. Restore the material to
                    // the mode its geometry can actually support.
                    child.material.vertexColors = Boolean(child.geometry?.getAttribute?.('color'));
                }
            });
        }
    }

    interpolateRotation(prevValue, value, partialTicks) {
        let factor;
        for (factor = value - prevValue; factor < -180.0; factor += 360.0) {
        }
        while (factor >= 180.0) {
            factor -= 360.0;
        }
        return prevValue + partialTicks * factor;
    }

    getModelScale(entity) { return 7 / 120; }

    prepareModel(entity) {
        if (this.isRebuildRequired(entity)) {
            this.rebuild(entity);
        }
    }

}
