import ModelPlayer from './ModelPlayer.js';
import ModelRenderer from '../renderer/ModelRenderer.js';
import ModelBase from '../ModelBase.js';
import { animateHumanoidSwimming } from './HumanoidSwimming.js';

class ModelZombieBiped extends ModelPlayer {
    constructor(skinLayout = 'modern') {
        super(64);
        if (skinLayout === 'legacy') {
            // Zombie/Husk JAR skins use one arm and one leg UV set, mirrored
            // for the other side. The modern player left-limb UV rectangles
            // are fully transparent in these textures.
            this.leftArm = new ModelRenderer('left_arm', 64, 64)
                .setTextureOffset(40, 16)
                .setRotationPoint(5, 2, 0)
                .addBox(-1, -2, -2, 4, 12, 4, 0, true);
            this.leftLeg = new ModelRenderer('left_leg', 64, 64)
                .setTextureOffset(0, 16)
                .setRotationPoint(2, 12, 0)
                .addBox(-2, 0, -2, 4, 12, 4, 0, true);
        }
        this.isAggressive = false;
        this.isThrowingTrident = false;
        this.swimAmount = 0;
    }

    setRotationAngles(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks) {
        super.setRotationAngles(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch, partialTicks);
        if (this.isThrowingTrident) {
            this.rightArm.rotateAngleX = this.rightArm.rotateAngleX * .5 - Math.PI;
            this.rightArm.rotateAngleY = 0;
            this.applyDrownedSwim(this.swimAmount, timeAlive);
            return;
        }
        if (!this.isAggressive) {
            this.applyDrownedSwim(this.swimAmount, timeAlive);
            return;
        }

        // ZombieModel.setupAttackAnimation delegates to
        // AnimationUtils.animateZombieArms in the reference client.
        const swing = this.swingProgress;
        const swingSin = Math.sin(swing * Math.PI);
        const easedSwingSin = Math.sin((1 - (1 - swing) ** 2) * Math.PI);
        const base = -Math.PI / 2.25;
        const armPitch = base - swingSin * 1.2 - easedSwingSin * 0.4;
        const armYaw = 0.1 - swingSin * 0.6;
        this.rightArm.rotateAngleX = armPitch;
        this.rightArm.rotateAngleY = -armYaw;
        this.rightArm.rotateAngleZ = 0;
        this.leftArm.rotateAngleX = armPitch;
        this.leftArm.rotateAngleY = armYaw;
        this.leftArm.rotateAngleZ = 0;
        this.applyDrownedSwim(this.swimAmount, timeAlive);
    }

    setupSwimAnimation(limbSwing, amount, timeAlive) {
        if (!this.drowned) return super.setupSwimAnimation(limbSwing, amount);
    }

    applyDrownedSwim(amount, timeAlive) {
        if (!this.drowned) return;
        if (!(amount > 0)) return;
        // DrownedModel overrides the player's breaststroke with an age-based
        // crawl. Reset by the walking pose each frame, never accumulated.
        const wave = Math.sin(.1 * timeAlive);
        for (const [arm, sign] of [[this.rightArm, 1], [this.leftArm, -1]]) {
            let delta = (-2.5132742 - arm.rotateAngleX) % (2 * Math.PI);
            if (delta < -Math.PI) delta += 2 * Math.PI;
            if (delta >= Math.PI) delta -= 2 * Math.PI;
            arm.rotateAngleX += amount * delta + sign * amount * .35 * wave;
            arm.rotateAngleZ += amount * (-sign * .15 - arm.rotateAngleZ);
        }
        this.leftLeg.rotateAngleX -= amount * .55 * wave;
        this.rightLeg.rotateAngleX += amount * .55 * wave;
        this.head.rotateAngleX = 0;
    }
}

class ModelSkeletonBiped extends ModelBase {
    constructor() {
        super();
        const part = (name, u, v, point, box, mirror = false) => new ModelRenderer(name, 64, 32)
            .setTextureOffset(u, v).setRotationPoint(...point).addBox(...box, 0, mirror);
        this.head = part('head', 0, 0, [0, 0, 0], [-4, -8, -4, 8, 8, 8]);
        this.body = part('body', 16, 16, [0, 0, 0], [-4, 0, -2, 8, 12, 4]);
        this.rightArm = part('right_arm', 40, 16, [-5, 2, 0], [-1, -2, -1, 2, 12, 2]);
        this.leftArm = part('left_arm', 40, 16, [5, 2, 0], [-1, -2, -1, 2, 12, 2], true);
        this.rightLeg = part('right_leg', 0, 16, [-2, 12, 0], [-1, 0, -1, 2, 12, 2]);
        this.leftLeg = part('left_leg', 0, 16, [2, 12, 0], [-1, 0, -1, 2, 12, 2], true);
        this.aiming = false;
        this.isAggressive = false;
        this.swingProgress = 0;
        this.swimAmount = 0;
    }

    rebuild(tessellator, group) {
        for (const part of [this.head, this.body, this.rightArm, this.leftArm, this.rightLeg, this.leftLeg])
            part.rebuild(tessellator, group);
    }

    render(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch) {
        this.head.rotateAngleY = yaw * Math.PI / 180;
        this.head.rotateAngleX = pitch * Math.PI / 180;
        if (this.aiming) {
            // HumanoidModel's bow arm poses: both hands raise toward the
            // sightline, with the off hand crossing inward to meet the bow.
            this.rightArm.rotateAngleX = -Math.PI / 2 + this.head.rotateAngleX;
            this.leftArm.rotateAngleX = -Math.PI / 2 + this.head.rotateAngleX;
            this.rightArm.rotateAngleY = -0.1 + this.head.rotateAngleY;
            this.leftArm.rotateAngleY = .5 + this.head.rotateAngleY;
            this.rightArm.rotateAngleZ = 0;
            this.leftArm.rotateAngleZ = 0;
        } else {
            this.rightArm.rotateAngleX = Math.cos(limbSwing * 0.6662 + Math.PI) * limbSwingStrength;
            this.leftArm.rotateAngleX = Math.cos(limbSwing * 0.6662) * limbSwingStrength;
            this.rightArm.rotateAngleY = 0;
            this.leftArm.rotateAngleY = 0;
            this.rightArm.rotateAngleZ = Math.cos(timeAlive * 0.09) * 0.05 + 0.05;
            this.leftArm.rotateAngleZ = -(Math.cos(timeAlive * 0.09) * 0.05 + 0.05);
            if (this.isAggressive) {
                // SkeletonModel uses the same two-arm sweep when aggressive
                // without a bow (e.g. Wither Skeleton melee pose).
                const swing = this.swingProgress;
                const swingSin = Math.sin(swing * Math.PI);
                const easedSwingSin = Math.sin((1 - (1 - swing) ** 2) * Math.PI);
                this.rightArm.rotateAngleX = -Math.PI / 2 - swingSin * 1.2 - easedSwingSin * 0.4;
                this.leftArm.rotateAngleX = this.rightArm.rotateAngleX;
                this.rightArm.rotateAngleY = -0.1 - swingSin * 0.6;
                this.leftArm.rotateAngleY = 0.1 + swingSin * 0.6;
                this.rightArm.rotateAngleZ = this.leftArm.rotateAngleZ = 0;
            }
        }
        this.rightLeg.rotateAngleX = Math.cos(limbSwing * 0.6662) * 1.4 * limbSwingStrength;
        this.leftLeg.rotateAngleX = Math.cos(limbSwing * 0.6662 + Math.PI) * 1.4 * limbSwingStrength;
        animateHumanoidSwimming(this, limbSwing, this.swimAmount);
        for (const part of [this.head, this.body, this.rightArm, this.leftArm, this.rightLeg, this.leftLeg]) part.render();
        super.render(stack, limbSwing, limbSwingStrength, timeAlive, yaw, pitch);
    }
}

export default class ModelUndeadBiped {
    constructor(family, skinLayout = 'modern') {
        this.model = family === 'skeleton' ? new ModelSkeletonBiped() : new ModelZombieBiped(skinLayout);
        this.texture = null;
    }

    rebuild(tessellator, group) { this.model.rebuild(tessellator, group); }
    render(...args) { this.model.render(...args); }

    setTexture(texture) {
        this.texture = texture;
        this.model.texture = texture;
    }
}
