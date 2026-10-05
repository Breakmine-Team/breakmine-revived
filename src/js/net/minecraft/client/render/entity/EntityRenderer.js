import Tessellator from "../Tessellator.js";
import MathHelper from "../../../util/MathHelper.js";
import * as THREE from "../../../../../../../libraries/three.module.js";

export default class EntityRenderer {

    constructor(model) {
        this.model = model;
        this.tessellator = new Tessellator();
        this.group = new THREE.Object3D();
        this.hurtTimestamp = 0;
    }

    rebuild(entity) {
        // Create meta for group
        let meta = {};
        this.fillMeta(entity, meta);
        this.group.buildMeta = meta;

        // Clear meshes
        this.group.clear();

        // Apply brightness and rebuild
        let brightness = this.group.buildMeta.brightness;
        this.tessellator.setColor(brightness, brightness, brightness);
        this.model.rebuild(this.tessellator, this.group);
    }

    fillMeta(entity, meta) {
        meta.brightness = entity.getEntityBrightness();
        // Entity models swap between the lit and unlit materials, so a change to
        // either the shadow or the dynamic light setting has to rebuild them
        meta.lit = this.tessellator.getLit();
    }

    isRebuildRequired(entity) {
        if (typeof this.group.buildMeta === "undefined") {
            return true;
        }

        // Compare meta of group
        let currentMeta = {};
        this.fillMeta(entity, currentMeta);
        let previousMeta = this.group.buildMeta;
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
        this.group.position.setY(interpolatedY + 1.4);
        this.group.position.setZ(interpolatedZ);

        // Actual size of the entity
        let scale = 7.0 / 120.0;
        this.group.scale.set(-scale, -scale, scale);

        // Rotate entity model
        this.group.rotation.y = MathHelper.toRadians(-rotationBody + 180);

        // Render entity model
        let timeAlive = entity.ticksExisted + partialTicks;
        let stack = entity.renderer.group;
        this.model.render(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks);

        if (performance.now() - this.hurtTimestamp < 300) {
            this.group.traverse(child => {
                if (child.isMesh) {
                    child.material.color.setHex(0xffaaaa);
                    child.material.vertexColors = false;
                }
            });
        } else {
            this.group.traverse(child => {
                if (child.isMesh) {
                    child.material.color.setHex(0xffffff);
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

    prepareModel(entity) {
        if (this.isRebuildRequired(entity)) {
            this.rebuild(entity);
        }
    }

}
