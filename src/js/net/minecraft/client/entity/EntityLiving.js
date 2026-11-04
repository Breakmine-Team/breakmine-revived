import Entity from "./Entity.js";
import MathHelper from "../../util/MathHelper.js";
import Block from "../world/block/Block.js";
import SwingState from "./SwingState.js";
import { nativeItemStats, acceptedDamage } from '../../../../../../packages/vanilla-gameplay/combat.mjs';
import { isFluidType } from '../../../../../../packages/vanilla-worldgen/fluid-state.mjs';
import { applyFluidCurrent, entityFluidDepth } from '../../../../../../packages/vanilla-gameplay/movement.mjs';

export default class EntityLiving extends Entity {

    constructor(minecraft, world, id) {
        super(minecraft, world, id);

        // Living movement passes (-motionX, motionY, -motionZ) to moveCollide.
        // Projectile/server velocities remain ordinary world-space vectors.
        this.horizontalMotionSign = -1;

        this.jumpTicks = 0;

        this.jumping = false;

        this.moveForward = 0.0;
        this.moveStrafing = 0.0;

        this.swingProgress = 0;
        this.prevSwingProgress = 0;
        this.swingProgressInt = 0;
        this.isSwingInProgress = false;
        this.swingDurationTicks = 6;
        this.currentSwing = null;
        this.swingState = new SwingState();

        this.renderYawOffset = 0;
        this.rotationYawHead = 0;

        this.prevRotationYawHead = 0;
        this.prevRenderYawOffset = 0;

        this.limbSwingProgress = 0;
        this.limbSwingStrength = 0;
        this.prevLimbSwingStrength = 0;

        this.health = 20.0;

        this.hurtTime = 0;
        this.invulnerableTime = 0;
        this.attackStrengthTicker = 20;
        this.lastAttackItemId = undefined;
        this.statusEffects = new Map();
    }

    onUpdate() {
        super.onUpdate();
        applyFluidCurrent(this);
        if (this.fireTicks > 0) {
            const x = Math.floor(this.x), y = Math.floor(this.y + this.height * 0.5), z = Math.floor(this.z);
            const fluid = this.world?.getFluidState?.(x, y, z);
            const inLava = isFluidType(fluid, 'lava');
            if (this.fireImmune || this.isInWater?.()) {
                this.fireTicks = 0;
            } else {
                // Entity#baseTick in the reference client applies one on-fire damage every
                // 20 remaining-fire ticks, except while inside lava.
                if (this.fireTicks % 20 === 0 && !inLava) this.damageEntity(1, null, 'on fire');
                this.fireTicks--;
            }
        }
        if (this.xpPickupCooldown > 0) this.xpPickupCooldown--;
        if (this.hurtTime > 0) {
            this.hurtTime--;
        }
        if (this.invulnerableTime > 0) this.invulnerableTime--;
        for (const [effect, state] of this.statusEffects) {
            state.duration--;
            if (state.duration <= 0) this.statusEffects.delete(effect);
            else if (effect === 'wither' && state.duration % 40 === 0) this.damageEntity(1, null, 'wither');
            else if (effect === 'hunger' && state.duration % 20 === 0) this.foodData?.addExhaustion?.(0.1 * (state.amplifier + 1));
        }
        this.attackStrengthTicker++;
        const heldItem = this.inventory?.getItemInSelectedSlot?.();
        const heldItemId = heldItem && !heldItem.isEmpty() ? heldItem.getType() : null;
        if (this.lastAttackItemId === undefined) {
            this.lastAttackItemId = heldItemId;
        } else if (this.lastAttackItemId !== heldItemId) {
            this.attackStrengthTicker = 0;
            this.lastAttackItemId = heldItemId;
        }
        this.onLivingUpdate();
        this.updateBodyRotation();

        // Normalize rotation differences using modulo instead of while loops to prevent infinite loops
        let yawDiff = this.rotationYaw - this.prevRotationYaw;
        if (yawDiff < -180.0) {
            this.prevRotationYaw -= 360.0 * Math.ceil(Math.abs(yawDiff) / 360.0);
        } else if (yawDiff >= 180.0) {
            this.prevRotationYaw += 360.0 * Math.ceil(yawDiff / 360.0);
        }

        let renderYawDiff = this.renderYawOffset - this.prevRenderYawOffset;
        if (renderYawDiff < -180.0) {
            this.prevRenderYawOffset -= 360.0 * Math.ceil(Math.abs(renderYawDiff) / 360.0);
        } else if (renderYawDiff >= 180.0) {
            this.prevRenderYawOffset += 360.0 * Math.ceil(renderYawDiff / 360.0);
        }

        let pitchDiff = this.rotationPitch - this.prevRotationPitch;
        if (pitchDiff < -180.0) {
            this.prevRotationPitch -= 360.0 * Math.ceil(Math.abs(pitchDiff) / 360.0);
        } else if (pitchDiff >= 180.0) {
            this.prevRotationPitch += 360.0 * Math.ceil(pitchDiff / 360.0);
        }

        let headYawDiff = this.rotationYawHead - this.prevRotationYawHead;
        if (headYawDiff < -180.0) {
            this.prevRotationYawHead -= 360.0 * Math.ceil(Math.abs(headYawDiff) / 360.0);
        } else if (headYawDiff >= 180.0) {
            this.prevRotationYawHead += 360.0 * Math.ceil(headYawDiff / 360.0);
        }
    }

    onLivingUpdate() {
        if (this.jumpTicks > 0) {
            --this.jumpTicks;
        }

        if (this.rotationPositionIncrements > 0) {
            // Interpolate the position and rotation
            let x = this.x + (this.targetX - this.x) / this.rotationPositionIncrements;
            let y = this.y + (this.targetY - this.y) / this.rotationPositionIncrements;
            let z = this.z + (this.targetZ - this.z) / this.rotationPositionIncrements;

            // Update yaw and pitch
            let yaw = MathHelper.wrapAngleTo180(this.targetYaw - this.rotationYaw);
            this.rotationYaw = this.rotationYaw + yaw / this.rotationPositionIncrements;
            this.rotationPitch = (this.rotationPitch + (this.targetPitch - this.rotationPitch) / this.rotationPositionIncrements);

            // Decrement position increments
            this.rotationPositionIncrements--;

            // Update position
            this.setPosition(x, y, z);
            this.setRotation(this.rotationYaw, this.rotationPitch);
        }

        // TODO Find the right spot to update this
        this.rotationYawHead = this.rotationYaw;

        // Stop if too slow
        if (Math.abs(this.motionX) < 0.003) {
            this.motionX = 0.0;
        }
        if (Math.abs(this.motionY) < 0.003) {
            this.motionY = 0.0;
        }
        if (Math.abs(this.motionZ) < 0.003) {
            this.motionZ = 0.0;
        }

        // Jump
        if (this.jumping) {
            if (this.isInWater() && (!this.onGround || entityFluidDepth(this, 'water') > .4) ||
                this.isInLava?.() && (!this.onGround || entityFluidDepth(this, 'lava') > .4)) {
                this.motionY += 0.04;
            } else if (this.onGround && this.jumpTicks === 0) {
                this.jump();
                this.jumpTicks = 10;
            }
        } else {
            this.jumpTicks = 0;
        }

        this.moveForward *= 0.98;
        this.moveStrafing *= 0.98;

        this.moveEntityWithHeading(this.moveForward, this.moveStrafing);
    }

    moveEntityWithHeading(moveForward, moveStrafing) {
        // Movement effects modify the speed attribute, not the input vector.
        // Applying slowness here as well squared the mob's slowdown.
        if (this.flying) {
            this.travelFlying(moveForward, 0, moveStrafing);
        } else {
            if (this.isInWater()) {
                // Is inside of water
                this.travelInWater(moveForward, 0, moveStrafing);
            } else if (this.isInLava?.()) {
                this.travelInLava(moveForward, 0, moveStrafing);
            } else {
                // Is on land
                this.travel(moveForward, 0, moveStrafing);
            }
        }

        this.prevLimbSwingStrength = this.limbSwingStrength;

        let motionX = this.x - this.prevX;
        let motionZ = this.z - this.prevZ;

        let distance = Math.sqrt(motionX * motionX + motionZ * motionZ) * 4.0;
        if (distance > 1.0) {
            distance = 1.0;
        }
        this.limbSwingStrength += (distance - this.limbSwingStrength) * 0.4;
        this.limbSwingProgress += this.limbSwingStrength;
    }

    onEntityUpdate() {
        this.prevRenderYawOffset = this.renderYawOffset;
        this.prevRotationYawHead = this.rotationYawHead;
        this.prevRenderArmYaw = this.renderArmYaw;
        this.prevRenderArmPitch = this.renderArmPitch;
        this.renderArmPitch = (this.renderArmPitch + (this.rotationPitch - this.renderArmPitch) * 0.5);
        this.renderArmYaw = (this.renderArmYaw + (this.rotationYaw - this.renderArmYaw) * 0.5);

        this.updateArmSwingProgress();

        super.onEntityUpdate();
    }

    updateBodyRotation() {
        let motionX = this.x - this.prevX;
        let motionZ = this.z - this.prevZ;

        let bodyRotation = this.renderYawOffset;

        let distanceTravelled = motionX * motionX + motionZ * motionZ;
        if (distanceTravelled > 0.0025000002) {
            bodyRotation = Math.atan2(motionZ, motionX) * 180.0 / Math.PI - 90.0;
        }

        if (this.swingProgress > 0.0) {
            bodyRotation = this.rotationYaw;
        }

        let bodyRotationDifference = MathHelper.wrapAngleTo180(bodyRotation - this.renderYawOffset);
        this.renderYawOffset += bodyRotationDifference * 0.3;

        let yaw = MathHelper.wrapAngleTo180(this.rotationYaw - this.renderYawOffset);
        if (yaw < -75.0) {
            yaw = -75.0;
        }
        if (yaw >= 75.0) {
            yaw = 75.0;
        }
        this.renderYawOffset = this.rotationYaw - yaw;

        if (yaw * yaw > 2500.0) {
            this.renderYawOffset += yaw * 0.2;
        }
    }

    setTargetPositionAndRotation(x, y, z, yaw, pitch, increments) {
        this.targetX = x;
        this.targetY = y;
        this.targetZ = z;
        this.targetYaw = yaw;
        this.targetPitch = pitch;
        this.rotationPositionIncrements = increments;
    }

    getAttackAnimation() {
        const heldItem = this.inventory?.getItemInSelectedSlot?.();
        const block = heldItem && !heldItem.isEmpty() ? Block.getById(heldItem.getType()) : null;
        return block?.attackAnimation || {
            type: block?.swingAnimationType || 'whack',
            duration: block?.swingDurationTicks || 6
        };
    }

    swingArm(animation = this.getAttackAnimation()) {
        const normalizedAnimation = {
            type: String(animation?.type || animation?.swingAnimationType || 'whack').toLowerCase(),
            duration: Math.max(0, animation?.duration ?? animation?.swingDurationTicks ?? 6)
        };
        const durationTicks = normalizedAnimation.duration;
        const started = this.swingState.startIfAble('main_hand', normalizedAnimation, durationTicks);
        this.syncSwingState();
        return started;
    }

    updateArmSwingProgress() {
        this.swingState.tick();
        this.syncSwingState();
    }

    syncSwingState() {
        this.prevSwingProgress = this.swingState.oldAnimation;
        this.swingProgress = this.swingState.animation;
        this.swingProgressInt = this.swingState.ticks;
        this.isSwingInProgress = this.swingState.isSwinging();
        this.swingDurationTicks = this.swingState.currentSwing?.durationTicks ?? 6;
        this.currentSwing = this.swingState.currentSwing;
    }

    getSwingProgress(partialTicks) {
        return this.swingState.getAnimation(partialTicks);
    }

    getCurrentItemAttackStrengthDelay() {
        const selectedItem = this.inventory?.getItemInSelectedSlot?.();
        const block = selectedItem && !selectedItem.isEmpty()
            ? Block.getById(selectedItem.getType())
            : null;
        const attackSpeed = nativeItemStats(block).attackSpeed;
        return 20 / attackSpeed;
    }

    getAttackStrengthScale(partialTicks = 0) {
        const delay = this.getCurrentItemAttackStrengthDelay();
        return Math.max(0, Math.min(1, (this.attackStrengthTicker + partialTicks) / delay));
    }

    resetAttackStrengthTicker() {
        this.attackStrengthTicker = 0;
    }

    computeAngleWithBound(value, subtract, limit) {
        let wrapped = MathHelper.wrapAngleTo180(value - subtract);
        if (wrapped < -limit) {
            wrapped = -limit;
        }
        if (wrapped >= limit) {
            wrapped = limit;
        }
        return value - wrapped;
    }

    setRotationYawHead(yaw) {
        this.targetYaw = yaw; // TODO should be rotationYawHead
        // this.rotationYawHead = yaw;
    }

    damageEntitySimple(amount) {
        return this.damageEntity(amount, null, this.typeOfDeath);
    }

    damageEntity(amount, attackerName, cause = null, attackerEntity = null, options = {}) {
        amount = acceptedDamage(this, amount, options);
        if (!amount) return 0;
        if (typeof this.reduceIncomingDamage === 'function') amount = this.reduceIncomingDamage(amount, cause, options);
        if (amount <= 0) return 0;
        const resistance = this.statusEffects?.get('resistance');
        if (resistance && !options.bypassInvulnerability) {
            amount *= Math.max(0, 1 - 0.2 * (resistance.amplifier + 1));
            if (amount <= 0) return 0;
        }
        this.lastAttackerName = attackerName ?? null;
        this.lastAttackerEntity = attackerEntity ?? null;
        this.onAcceptedDamage(attackerName, attackerEntity);
        this.health -= amount;
        this.hurtTime = 10;
        if (this.renderer) {
            this.renderer.hurtTimestamp = performance.now();
        }
        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
            this.typeOfDeath = attackerName ? `was slain by ${attackerName}` : cause ?? 'died';
            if (typeof this.die === 'function') {
                this.die();
            }
        }
        if (this === this.minecraft.player && typeof this.sendHealthUpdate === 'function') {
            this.sendHealthUpdate();
        }
        return amount;
    }

    onAcceptedDamage() {}

    addStatusEffect(effect, duration, amplifier = 0) {
        if (typeof effect !== 'string' || !Number.isFinite(duration) || duration <= 0) return false;
        if (!this.canReceiveStatusEffect(effect)) return false;
        const current = this.statusEffects.get(effect);
        if (!current || amplifier > current.amplifier || (amplifier === current.amplifier && duration > current.duration)) {
            this.statusEffects.set(effect, { duration: Math.floor(duration), amplifier: Math.max(0, Math.floor(amplifier)) });
        }
        return true;
    }

    canReceiveStatusEffect() { return true; }

}
