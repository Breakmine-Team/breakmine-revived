import EntityLiving from "./EntityLiving.js";
import Block from "../world/block/Block.js";
import MathHelper from "../../util/MathHelper.js";
import Keyboard from "../../util/Keyboard.js";
import Vector3 from "../../util/Vector3.js";
import {BlockRegistry} from "../world/block/BlockRegistry.js";
import InventoryPlayer from "../inventory/inventory/InventoryPlayer.js";
import GuiDeath from "../gui/screens/GuiDeath.js";
import BlockPosition from "../../util/BlockPosition.js";
import FoodData from '../../../../../../packages/vanilla-gameplay/food.mjs';
import { addExperiencePoints } from '../../../../../../packages/vanilla-gameplay/experience.mjs';
import { isFluidType } from '../../../../../../packages/vanilla-worldgen/fluid-state.mjs';
import { entityFluidDepth, pointInFluid, travelInWater, travelInLava, waterVision } from '../../../../../../packages/vanilla-gameplay/movement.mjs';
import { damageAfterArmor } from '../../../../../../packages/vanilla-gameplay/combat.mjs';
import { equipmentStats } from '../inventory/Equipment.js';

const armorBypass = new Set([
    'on fire', 'in wall', 'cramming', 'drown', 'drowning', 'drowned', 'fly into wall',
    'generic', 'wither', 'dragon breath', 'starve', 'starvation', 'starved to death', 'fall', 'hit the ground too hard',
    'ender pearl', 'freeze', 'stalagmite', 'magic', 'indirect magic', 'out of world',
    'fell out of the world', 'void', 'generic kill', 'sonic boom', 'outside border'
]);

export default class PlayerEntity extends EntityLiving {

    static name = "PlayerEntity";

    constructor(minecraft, world, id) {
        super(minecraft, world, id);

        this.inventory = new InventoryPlayer();
        this.inventory.setInventoryChangeListener(() => this.handleInventoryChanged());
        this.username = "Player";
        this.uuid = null;

        this.creative = true;
        this.spectator = false;
        this.spectatorTarget = null;
        this.spectatorTargetIndex = -1;
        this.health = 20;
        this.armor = 0;
        this.airSupply = 300;
        this.maxAirSupply = 300;
        this.foodData = new FoodData();
        this.experienceProgress = 0;
        this.experienceLevel = 0;
        this.totalExperience = 0;
        this.xpPickupCooldown = 0;
        this.isDead = false;

        this.typeOfDeath = 'hit the ground too hard';

        // Fall damage tracking
        this.fallDistance = 0;
        this.wasOnGround = false;

        this.collision = false;

        this.jumpMovementFactor = 0.02;
        this.speedInAir = 0.02;
        this.flySpeed = 0.05;
        this.stepHeight = 0.6;

        this.flyToggleTimer = 0;
        this.sprintToggleTimer = 0;

        this.sprinting = false;
        this.flying = false;

        this.prevFovModifier = 0;
        this.fovModifier = 0;
        this.timeFovChanged = 0;

        this.renderArmPitch = 0;
        this.renderArmYaw = 0;

        this.prevRenderArmPitch = 0;
        this.prevRenderArmYaw = 0;

        // For first person bobbing
        this.cameraYaw = 0;
        this.cameraPitch = 0;
        this.prevCameraYaw = 0;
        this.prevCameraPitch = 0;

        this.width = 0.6;
        this.height = 1.8;
        this.swimAmount = 0;
        this.prevSwimAmount = 0;
        this.swimming = false;
        this.waterVisionTime = 0;
        this.cameraEyeHeight = this.prevCameraEyeHeight = 1.62;
    }

    handleInventoryChanged() {
        this.updateEquipmentAttributes();
        if (!this.minecraft || !this.minecraft.isInGame()) {
            return;
        }

        const networkController = this.minecraft.playerController;
        const networkHandler = networkController?.getNetworkHandler?.();
        const networkManager = networkHandler?.getNetworkManager?.();
        if (!networkManager || typeof networkManager.sendJson !== 'function') {
            return;
        }

        networkManager.sendJson({
            type: 'inventory',
            username: this.username,
            inventory: this.inventory.toNetworkState()
        });
    }

    addExperiencePoints(amount) {
        return addExperiencePoints(this, amount);
    }

    sendHealthUpdate() {
        if (!this.minecraft || !this.minecraft.isInGame() || this.world?.vanillaPreview) {
            return;
        }

        if (this.minecraft.isSingleplayer()) {
            return;
        }

        const networkController = this.minecraft.playerController;
        const networkHandler = networkController?.getNetworkHandler?.();
        const networkManager = networkHandler?.getNetworkManager?.();
        if (!networkManager || typeof networkManager.sendJson !== 'function') {
            return;
        }

        networkManager.sendJson({
            type: 'health',
            username: this.username,
            health: this.health
        });
    }

    respawn() {
        let spawn = this.world.getSpawn();
        this.setPosition(spawn.x, spawn.y, spawn.z);
    }

    turn(motionX, motionY) {
        let sensitivity = this.minecraft.settings.sensitivity / 500;
        const oldYaw = this.rotationYaw;
        const oldPitch = this.rotationPitch;
        this.rotationYaw = this.rotationYaw + motionX * sensitivity;
        this.rotationPitch = this.rotationPitch - motionY * sensitivity;

        if (this.rotationPitch < -90.0) {
            this.rotationPitch = -90.0;
        }

        if (this.rotationPitch > 90.0) {
            this.rotationPitch = 90.0;
        }
        // Entity.turn in the JAR shifts both interpolation endpoints for mouse
        // input. Otherwise the camera repeatedly eases from the last tick's
        // angle, producing a 20 Hz sawtooth even when rendering at high FPS.
        this.prevRotationYaw += this.rotationYaw - oldYaw;
        this.prevRotationPitch += this.rotationPitch - oldPitch;
    }

    onUpdate() {
        // Freeze the player while the world is still loading so it can't fall
        // through unloaded terrain before the world is ready.
        if (this.minecraft.loadingScreen !== null) {
            return;
        }
        this.updateEquipmentAttributes();
        super.onUpdate();
        if (this.spectator) {
            const target = this.spectatorTarget;
            if (!target || target.isDead || target.health <= 0 || !this.world.entities.includes(target)) {
                this.spectatorTarget = null;
            } else {
                const eyeY = target.y + Math.max(0.1, (target.height ?? 1.8) * 0.85);
                this.setPosition(target.x, eyeY - this.getEyeHeight(), target.z);
                this.rotationYaw = target.rotationYaw ?? this.rotationYaw;
                this.rotationPitch = target.rotationPitch ?? this.rotationPitch;
                this.motionX = this.motionY = this.motionZ = 0;
                this.onGround = false;
            }
        } else {
            this.spectatorTarget = null;
        }
        if (this.world?.vanillithPlayable && this.y < this.world.minY - 64 && !this.isDead) {
            // Entity.checkBelowWorld / LivingEntity.onBelowWorld in the JAR:
            // below minY - 64, apply four points of out-of-world damage.
            this.typeOfDeath = 'fell out of the world';
            this.damageEntity(4, null, this.typeOfDeath, null, { bypassInvulnerability: true });
        }
        if (this.creative || this.spectator) {
            this.airSupply = this.maxAirSupply;
        } else if (this.isHeadInWater()) {
            this.airSupply--;
            if (this.airSupply <= -20) {
                this.airSupply = 0;
                this.typeOfDeath = 'drowned';
                this.damageEntity(2, null, this.typeOfDeath);
            }
        } else {
            this.airSupply = Math.min(this.maxAirSupply, this.airSupply + 4);
        }
        if (!this.creative && !this.spectator && !this.isDead) {
            if (this.isInLava()) {
                this.igniteForSeconds(15);
                this.typeOfDeath = 'tried to swim in lava';
                if (this.damageEntity(4, null, this.typeOfDeath)) {
                    this.minecraft.soundManager.playSoundMono('random.fire_hurt', 1.0, 1.0);
                }
            }
            const foot = this.world.getNativeBlockStateAt?.(Math.floor(this.x), Math.floor(this.y - .2), Math.floor(this.z));
            if (this.onGround && !this.isSneaking() && foot?.name === 'minecraft:magma_block') {
                this.typeOfDeath = 'discovered the floor was lava';
                this.damageEntity(1, null, this.typeOfDeath);
            }
            // Block contact is checked against the player's occupied cells; cactus
            // has an inset collision box so touching its side enters its cell.
            if (this.world.getNativeBlockStateAt) {
                const box = this.boundingBox;
                for (let x = Math.floor(box.minX + 1e-6); x <= Math.floor(box.maxX - 1e-6); x++) {
                    for (let y = Math.floor(box.minY + 1e-6); y <= Math.floor(box.maxY - 1e-6); y++) {
                        for (let z = Math.floor(box.minZ + 1e-6); z <= Math.floor(box.maxZ - 1e-6); z++) {
                            const name = this.world.getNativeBlockStateAt(x, y, z)?.name;
                            if (name === 'minecraft:cactus') {
                                this.typeOfDeath = 'was pricked to death';
                                this.damageEntity(1, null, this.typeOfDeath);
                            } else if ((name === 'minecraft:fire' || name === 'minecraft:soul_fire') && !this.fireImmune && !this.isInWater()) {
                                this.igniteForSeconds(8);
                                this.typeOfDeath = 'went up in flames';
                                this.damageEntity(name === 'minecraft:soul_fire' ? 2 : 1, null, this.typeOfDeath);
                            }
                        }
                    }
                }
            }
        }
        if (this === this.minecraft.player && (this.world.vanillithPlayable || this.world.mobCombatEnabled || (!this.world.vanillaPreview && this.minecraft.isSingleplayer())) && !this.creative && !this.spectator) {
            const distance = Math.hypot(this.x - this.prevX, this.z - this.prevZ);
            if (this.isInWater()) this.foodData.addExhaustion(distance * 0.01);
            else if (this.onGround && this.sprinting) this.foodData.addExhaustion(distance * 0.1);
            this.foodData.tick(this);
        }
    }

    damageEntity(amount, attackerName, cause = null, attackerEntity = null, options = {}) {
        if ((this.creative || this.spectator) && !options.bypassInvulnerability) return 0;
        return super.damageEntity(amount, attackerName, cause, attackerEntity, options);
    }

    updateEquipmentAttributes() {
        let armor = 0, toughness = 0, knockbackResistance = 0;
        for (const stack of this.inventory?.equipment ?? []) {
            const stats = equipmentStats(stack);
            if (!stats) continue;
            armor += stats.armor ?? 0;
            toughness += stats.armorToughness ?? 0;
            knockbackResistance += stats.knockbackResistance ?? 0;
        }
        this.armor = armor;
        this.armorToughness = toughness;
        this.knockbackResistance = knockbackResistance;
    }

    reduceIncomingDamage(amount, cause, options) {
        const damageName = String(cause ?? '').toLowerCase().replace(/^minecraft:/, '').replaceAll('_', ' ');
        if (options.bypassInvulnerability || armorBypass.has(damageName)) return amount;
        this.updateEquipmentAttributes();
        const reduced = damageAfterArmor(amount, this.armor, this.armorToughness);
        const wear = Math.max(1, Math.floor(amount / 4));
        let changed = false;
        for (const stack of this.inventory.equipment) {
            const stats = equipmentStats(stack);
            if (!stats?.damageOnHurt || !stats.durability) continue;
            const item = Block.getById(stack.getType());
            if ((damageName === 'lava' || damageName === 'tried to swim in lava' || damageName === 'in fire' || damageName === 'went up in flames') && item?.nativeItemId?.includes('netherite_')) continue;
            stack.damageItem(wear);
            changed = true;
        }
        if (changed) this.inventory.notifyInventoryChanged();
        return reduced;
    }

    cycleSpectatorTarget(direction = 1) {
        if (!this.spectator || !this.world?.entities) return null;
        const candidates = this.world.entities
            .filter(entity => entity !== this && !entity.isDead && entity.health > 0 && entity.spectator !== true)
            .sort((a, b) => Math.hypot(a.x - this.x, a.y - this.y, a.z - this.z) - Math.hypot(b.x - this.x, b.y - this.y, b.z - this.z));
        if (!candidates.length) {
            this.spectatorTarget = null;
            return null;
        }
        let index = candidates.indexOf(this.spectatorTarget);
        if (index < 0) index = direction < 0 ? 0 : -1;
        this.spectatorTargetIndex = (index + (direction < 0 ? -1 : 1) + candidates.length) % candidates.length;
        this.spectatorTarget = candidates[this.spectatorTargetIndex];
        this.flying = true;
        return this.spectatorTarget;
    }

    onLivingUpdate() {
        this.prevCameraYaw = this.cameraYaw;
        this.prevCameraPitch = this.cameraPitch;

        if (this.sprintToggleTimer > 0) {
            --this.sprintToggleTimer;
        }
        if (this.flyToggleTimer > 0) {
            --this.flyToggleTimer;
        }

        let prevMoveForward = this.moveForward;
        let prevJumping = this.jumping;

        if (this === this.minecraft.player) {
            this.updateKeyboardInput();
        }

        // Toggle jumping
        if (!prevJumping && this.jumping) {
            if (this.flyToggleTimer === 0) {
                this.flyToggleTimer = 7;
            } else {
                // Only allow flying in creative or spectator mode
                if (this.creative || this.spectator) {
                    this.flying = this.spectator || !this.flying;
                    this.flyToggleTimer = 0;
                    this.updateFOVModifier();
                }
            }
        }

        // Toggle sprint
        if (prevMoveForward === 0 && this.moveForward > 0) {
            if (this.sprintToggleTimer === 0) {
                this.sprintToggleTimer = 7;
            } else {
                this.sprinting = true;
                this.sprintToggleTimer = 0;

                this.updateFOVModifier();
            }
        }

        if (this.sprinting && (this.moveForward <= 0 || this.collision || this.isSneaking() || !this.creative && this.foodData.foodLevel <= 6)) {
            this.sprinting = false;

            this.updateFOVModifier();
        }

        this.updateSwimming();
        this.updatePlayerPose();
        if (this.isSneaking() && !this.flying && this.isInWater()) this.motionY -= .04;
        super.onLivingUpdate();

        // LivingEntity#updateSwimAmount in the JAR eases the swimming pose by
        // 0.09 per tick. Vanilla only enters the swimming pose while sprinting
        // through water and not grounded; keep the render state interpolated.
        this.prevSwimAmount = this.swimAmount;
        this.updateSwimming();
        this.updatePlayerPose();
        const visuallySwimming = this.swimming || this.height === .6;
        this.swimAmount = Math.max(0, Math.min(1, this.swimAmount + (visuallySwimming ? 0.09 : -0.09)));
        this.waterVisionTime = Math.max(0, Math.min(600, (this.waterVisionTime ?? 0) + (this.isHeadInWater() ? (this.spectator ? 10 : 1) : -10)));
        this.prevCameraEyeHeight = this.cameraEyeHeight ?? this.getEyeHeight();
        this.cameraEyeHeight = this.prevCameraEyeHeight + (this.getEyeHeight() - this.prevCameraEyeHeight) * .5;

        this.jumpMovementFactor = this.speedInAir;

        if (this.sprinting) {
            this.jumpMovementFactor = this.jumpMovementFactor + this.speedInAir * 0.3;
        }

        let speedXZ = Math.sqrt(this.motionX * this.motionX + this.motionZ * this.motionZ);
        let speedY = (Math.atan(-this.motionY * 0.2) * 15.0);

        if (speedXZ > 0.1) {
            speedXZ = 0.1;
        }
        if (!this.onGround || this.health <= 0.0) {
            speedXZ = 0.0;
        }
        if (this.onGround || this.health <= 0.0) {
            speedY = 0.0;
        }
        this.cameraYaw += (speedXZ - this.cameraYaw) * 0.4;
        this.cameraPitch += (speedY - this.cameraPitch) * 0.8;
    }

    isInWater() {
        return entityFluidDepth(this, 'water', BlockRegistry.WATER?.getId?.()) > 0;
    }

    isInLava() {
        return entityFluidDepth(this, 'lava', BlockRegistry.LAVA?.getId?.()) > 0;
    }

    getSwimAmount(partialTicks = 1) {
        return this.prevSwimAmount + (this.swimAmount - this.prevSwimAmount) * partialTicks;
    }

    isFluidAt(x, y, z, name, fallbackBlock) {
        const fluid = this.world?.getFluidState?.(x, y, z);
        if (fluid != null) return isFluidType(fluid, name);
        return this.world?.getBlockAt?.(x, y, z) === fallbackBlock?.getId?.();
    }

    isHeadInLava() {
        return pointInFluid(this.world, this.x, this.y + this.getEyeHeight() - .11111111, this.z, 'lava', BlockRegistry.LAVA?.getId?.());
    }

    isHeadInWater() {
        return pointInFluid(this.world, this.x, this.y + this.getEyeHeight() - .11111111, this.z, 'water', BlockRegistry.WATER?.getId?.());
    }

    getWaterVision() { return this.isHeadInWater() ? waterVision(this.waterVisionTime ?? 0) : 0; }

    updateSwimming() {
        this.swimming = !this.flying && !this.spectator && this.sprinting &&
            (this.swimming ? this.isInWater() : this.isHeadInWater() && this.isInWater());
    }

    updatePlayerPose() {
        if (!this.boundingBox || !this.world?.getCollisionBoxes) return;
        let height = this.swimming ? .6 : this.isSneaking() && !this.flying ? 1.5 : 1.8;
        const fits = value => {
            const box = this.boundingBox.clone();
            box.maxY = box.minY + value;
            return this.world.getCollisionBoxes(box).length === 0;
        };
        if (height > this.height && !fits(height)) height = fits(1.5) ? 1.5 : .6;
        if (height !== this.height) {
            this.height = height;
            this.boundingBox.maxY = this.boundingBox.minY + height;
            this.fluidContact = null;
        }
    }

    jump() {
        if (!this.creative && !this.spectator && this.minecraft.isSingleplayer()) this.foodData.addExhaustion(this.sprinting ? 0.2 : 0.05);
        this.motionY = 0.42;

        if (this.sprinting) {
            let radiansYaw = MathHelper.toRadians(this.rotationYaw + 180);
            this.motionX -= Math.sin(radiansYaw) * 0.2;
            this.motionZ += Math.cos(radiansYaw) * 0.2;
        }
    }

    travelFlying(forward, vertical, strafe) {
        // Fly move up and down
        if (this.isSneaking()) {
            this.moveStrafing = strafe / 0.3;
            this.moveForward = forward / 0.3;
            this.motionY -= this.flySpeed * 3.0;
        }

        if (this.jumping) {
            this.motionY += this.flySpeed * 3.0;
        }

        let prevMotionY = this.motionY;
        let prevJumpMovementFactor = this.jumpMovementFactor;
        this.jumpMovementFactor = this.flySpeed * (this.sprinting ? 2 : 1);

        this.travel(forward, vertical, strafe);

        this.motionY = prevMotionY * 0.6;
        this.jumpMovementFactor = prevJumpMovementFactor;

        if (this.onGround && !this.spectator) {
            this.flying = false;
        }
    }

    travelInLava(forward, vertical, strafe) {
        travelInLava(this, forward, vertical, strafe);
    }

    travelInWater(forward, vertical, strafe) {
        if (this.swimming) {
            const lookY = -Math.sin(this.rotationPitch * Math.PI / 180);
            if (lookY <= 0 || this.jumping || this.isFluidAt(Math.floor(this.x), Math.floor(this.y + .9), Math.floor(this.z), 'water', BlockRegistry.WATER))
                this.motionY += (lookY - this.motionY) * (lookY < -.2 ? .085 : .06);
        }
        travelInWater(this, forward, vertical, strafe);
    }

    travel(forward, vertical, strafe) {
        let isSlow = this.onGround && this.isSneaking();

        let prevX = this.x;
        let prevZ = this.z;

        if (this === this.world.minecraft.player) {
            let prevSlipperiness = this.getBlockSlipperiness() * 0.91;

            let value = 0.16277136 / (prevSlipperiness * prevSlipperiness * prevSlipperiness);
            let friction;

            if (this.onGround) {
                friction = this.getAIMoveSpeed() * value;
            } else {
                friction = this.jumpMovementFactor;
            }

            this.moveRelative(forward, vertical, strafe, friction);

            // Get new speed
            let slipperiness = this.getBlockSlipperiness() * 0.91;

            // Move
            if (this.spectator) {
                // Spectator noclip: same movement, no collision
                this.boundingBox.move(-this.motionX, this.motionY, -this.motionZ);
                this.x = (this.boundingBox.minX + this.boundingBox.maxX) / 2.0;
                this.y = this.boundingBox.minY;
                this.z = (this.boundingBox.minZ + this.boundingBox.maxZ) / 2.0;
                this.onGround = false;
                this.collision = false;
            } else {
                this.collision = this.moveCollide(-this.motionX, this.motionY, -this.motionZ);
            }

            // Gravity
            if (!this.flying) {
                this.motionY -= 0.08;
            }

            // Decrease motion
            this.motionX *= slipperiness;
            this.motionY *= 0.98;
            this.motionZ *= slipperiness;

            // Fall damage tracking
            if (!this.creative && !this.spectator && !this.isDead) {
                if (!this.onGround) {
                    // Accumulate fall distance while in air
                    if (this.motionY < 0) {
                        this.fallDistance -= this.motionY;
                    }
                } else if (this.wasOnGround !== this.onGround && !this.wasOnGround) {
                    // Just landed
                    const damage = Math.max(0, Math.floor(this.fallDistance + 1e-6 - 3));
                    if (damage > 0) {
                        this.typeOfDeath = 'hit the ground too hard';
                        this.damageEntity(damage, null, this.typeOfDeath);

                        // Play hurt sound
                        this.minecraft.soundManager.playSoundMono('random.hit', 1.0, 1.0);

                        // Play fall sound based on distance
                        if (this.fallDistance > 5) {
                            this.minecraft.soundManager.playSoundMono('random.fallbig', 1.0, 1.0);
                        } else {
                            this.minecraft.soundManager.playSoundMono('random.fallsmall', 1.0, 1.0);
                        }

                    }
                    this.fallDistance = 0;
                }
                this.wasOnGround = this.onGround;
            }

            // General health check - die if health reaches 0
            if (this.health <= 0 && !this.isDead) {
                this.health = 0;
                this.isDead = true;
                this.die();
            }
        }

        // Step sound
        if (!isSlow) {
            let blockX = MathHelper.floor(this.x);
            let blockY = MathHelper.floor(this.y - 0.2);
            let blockZ = MathHelper.floor(this.z);
            let typeId = this.world.getBlockAt(blockX, blockY, blockZ);

            let distanceX = this.x - prevX;
            let distanceZ = this.z - prevZ;

            this.distanceWalked += Math.sqrt(distanceX * distanceX + distanceZ * distanceZ) * 0.6;
            if (this.distanceWalked > this.nextStepDistance && typeId !== 0) {
                this.nextStepDistance = this.distanceWalked + 1;

                let block = Block.getById(typeId);
                if (block !== null) {
                    let sound = block.getSound();

                    // Play sound
                    if (!block.isLiquid()) {
                        this.minecraft.soundManager.playSound(sound.getStepSound(), this.x, this.y, this.z, 0.15, sound.getPitch());
                    }
                }
            }
        }
    }

    getBlockSlipperiness() {
        return this.onGround ? 0.6 : 1.0;
    }

    getAIMoveSpeed() {
        const slow = this.statusEffects?.get('slowness');
        const speed = this.statusEffects?.get('speed');
        return (this.sprinting ? .13 : .1) * Math.max(0, 1 - (slow ? .15 * (slow.amplifier + 1) : 0) + (speed ? .2 * (speed.amplifier + 1) : 0));
    }

    moveRelative(forward, up, strafe, friction) {
        let distance = strafe * strafe + up * up + forward * forward;

        if (distance >= 0.0001) {
            distance = Math.sqrt(distance);

            if (distance < 1.0) {
                distance = 1.0;
            }

            distance = friction / distance;
            strafe = strafe * distance;
            up = up * distance;
            forward = forward * distance;

            let yawRadians = MathHelper.toRadians(this.rotationYaw + 180);
            let sin = Math.sin(yawRadians);
            let cos = Math.cos(yawRadians);

            this.motionX += strafe * cos - forward * sin;
            this.motionY += up;
            this.motionZ += forward * cos + strafe * sin;
        }
    }

    updateKeyboardInput() {
        let moveForward = 0.0;
        let moveStrafe = 0.0;

        let jumping = false;
        let sneaking = false;

        if (this.minecraft.hasInGameFocus()) {
            // TV mode: Arrow keys for movement, Enter+Arrow for camera look
            if (this.minecraft.settings.tvmode) {
                let looking = Keyboard.isKeyDown("Enter");

                if (looking) {
                    // Camera look mode: Enter + Arrow keys rotate the camera
                    let yawDelta = 0;
                    let pitchDelta = 0;
                    if (Keyboard.isKeyDown("ArrowLeft")) yawDelta -= 4.0;
                    if (Keyboard.isKeyDown("ArrowRight")) yawDelta += 4.0;
                    if (Keyboard.isKeyDown("ArrowUp")) pitchDelta += 4.0;
                    if (Keyboard.isKeyDown("ArrowDown")) pitchDelta -= 4.0;
                    if (yawDelta !== 0 || pitchDelta !== 0) {
                        this.turn(yawDelta, pitchDelta);
                    }
                } else {
                    // Movement mode: Arrow keys for WASD-like movement
                    if (Keyboard.isKeyDown("ArrowUp")) moveForward++;
                    if (Keyboard.isKeyDown("ArrowDown")) moveForward--;
                    if (Keyboard.isKeyDown("ArrowLeft")) moveStrafe++;
                    if (Keyboard.isKeyDown("ArrowRight")) moveStrafe--;
                }

                // TV remote colored buttons (if available)
                if (Keyboard.isKeyDown(this.minecraft.settings.keyJump)) jumping = true;
                if (Keyboard.isKeyDown(this.minecraft.settings.keyCrouching)) sneaking = true;
            } else {
                // Desktop mode: WASD for movement
                if (Keyboard.isKeyDown("KeyR")) {
                    // this.respawn();
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keyForward)) {
                    moveForward++;
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keyBackward)) {
                    moveForward--;
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keyLeft)) {
                    moveStrafe++;
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keyRight)) {
                    moveStrafe--;
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keyJump)) {
                    jumping = true;
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keySprinting)) {
                    if (moveForward > 0 && !this.isSneaking() && !this.sprinting) {
                        this.sprinting = true;

                        this.updateFOVModifier();
                    }
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keyCrouching)) {
                    sneaking = true;
                }
            }

            if (sneaking) {
                moveStrafe = moveStrafe * 0.3;
                moveForward = moveForward * 0.3;
            }
        }

        this.moveForward = moveForward;
        this.moveStrafing = moveStrafe;

        this.jumping = jumping;
        this.setSneaking(sneaking);
    }

    getEyeHeight() {
        return this.height === .6 ? .4 : this.height === 1.5 ? 1.27 : 1.62;
    }

    getCameraEyeHeight(partialTicks = 1) {
        const previous = this.prevCameraEyeHeight ?? this.getEyeHeight();
        return previous + ((this.cameraEyeHeight ?? previous) - previous) * partialTicks;
    }

    updateFOVModifier() {
        let value = 1.0;

        if (this.sprinting) {
            value += 1;
        }

        if (this.flying) {
            value *= 1.1;
        }

        this.setFOVModifier((value - 1.0) * 10);
    }


    setFOVModifier(fov) {
        this.prevFovModifier = this.fovModifier;
        this.fovModifier = fov;
        this.timeFovChanged = Date.now();
    }

    getFOVModifier() {
        let timePassed = Date.now() - this.timeFovChanged;
        let distance = this.prevFovModifier - this.fovModifier;
        let duration = 100;
        let progress = distance / duration * timePassed;
        return timePassed > duration ? this.fovModifier : this.prevFovModifier - progress;
    }

    getBlockPosX() {
        return this.x - (this.x < 0 ? 1 : 0);
    }

    getBlockPosY() {
        return this.y - (this.y < 0 ? 1 : 0);
    }

    getBlockPosZ() {
        return this.z - (this.z < 0 ? 1 : 0);
    }

    getPositionEyes(partialTicks) {
        if (partialTicks === 1.0) {
            return new Vector3(this.x, this.y + this.getEyeHeight(), this.z);
        } else {
            let x = this.prevX + (this.x - this.prevX) * partialTicks;
            let y = this.prevY + (this.y - this.prevY) * partialTicks + this.getEyeHeight();
            let z = this.prevZ + (this.z - this.prevZ) * partialTicks;
            return new Vector3(x, y, z);
        }
    }

    die() {
        if (this === this.minecraft.player) {
            this.minecraft.displayScreen(new GuiDeath(this));
            if (!this.world?.vanillaPreview && !this.minecraft.isSingleplayer()) {
                try {
                    const nm = this.minecraft.playerController?.getNetworkHandler?.()?.getNetworkManager?.();
                    if (nm) nm.sendJson({ type: 'death', username: this.username, message: this.typeOfDeath });
                } catch (e) {}
            }
        }
    }

    async respawn() {
        const vanillith = !!this.world?.vanillithPlayable;
        const spawn = this.world.spawn && Number.isFinite(this.world.spawn.x)
            ? this.world.spawn : { x: 0, y: 64, z: 0 };
        if (vanillith) {
            const deathScreen = this.minecraft.currentScreen;
            const provider = this.world.getChunkProvider();
            const chunkX = Math.floor(spawn.x / 16), chunkZ = Math.floor(spawn.z / 16);
            this.minecraft.showLoadingScreen('Respawning...');
            try {
                // Vanilla's server respawn resolves the spawn column as a FULL
                // chunk before the player is placed. Wait for Vanillith's
                // equivalent published collision chunk instead of teleporting
                // into the provider's empty-chunk fallback.
                await provider.requestRadius(chunkX, chunkZ, 2);
                if (provider.error) throw provider.error;
                if (!provider.isCollisionChunkReady(chunkX, chunkZ)) {
                    throw new Error(`Spawn chunk ${chunkX},${chunkZ} is not collision-ready`);
                }
            } catch (error) {
                this.minecraft.loadingScreen = null;
                this.minecraft.displayScreen(deathScreen);
                throw error;
            }
        }

        // Reset health
        this.health = 20;
        this.foodData = new FoodData();
        this.invulnerableTime = 0;
        this.isDead = false;
        this.sendHealthUpdate();

        // Reset fall distance
        this.fallDistance = 0;
        this.wasOnGround = false;

        // Reset position to spawn
        if (vanillith) {
            this.setPositionAndRotation(spawn.x, spawn.y, spawn.z, this.rotationYaw, this.rotationPitch);
        } else if (this.world.spawn && this.world.spawn.x !== undefined) {
            // Singleplayer: use world.spawn
            this.setPosition(this.world.spawn.x, this.world.spawn.y, this.world.spawn.z);
        } else if (this.world.spawnX !== undefined) {
            // Multiplayer: use world.spawnX/Y/Z
            this.setPosition(this.world.spawnX, this.world.spawnY, this.world.spawnZ);
        } else {
            // Fallback
            this.setPosition(0, 64, 0);
        }

        // Reset motion
        this.motionX = 0;
        this.motionY = 0;
        this.motionZ = 0;
        if (vanillith) {
            this.minecraft.loadingScreen = null;
            this.minecraft.displayScreen(null);
        }
    }

    /**
     * interpolated look vector
     */
    getLook(partialTicks) {
        // TODO interpolation
        return this.getVectorForRotation(this.rotationPitch, this.rotationYaw);
    }

    /**
     * Creates a Vec3 using the pitch and yaw of the entities rotation.
     */
    getVectorForRotation(pitch, yaw) {
        let z = Math.cos(-yaw * 0.017453292 - Math.PI);
        let x = Math.sin(-yaw * 0.017453292 - Math.PI);
        let xz = -Math.cos(-pitch * 0.017453292);
        let y = Math.sin(-pitch * 0.017453292);
        return new Vector3(x * xz, y, z * xz);
    }

    

    rayTrace(blockReachDistance, partialTicks) {
        let from = this.getPositionEyes(partialTicks);
        let direction = this.getLook(partialTicks);
        let to = from.addVector(direction.x * blockReachDistance, direction.y * blockReachDistance, direction.z * blockReachDistance);

        let blockHit = this.world.rayTraceBlocks(from, to);
        let currentReach = blockHit ? from.distanceTo(new Vector3(blockHit.x, blockHit.y, blockHit.z)) : blockReachDistance;

        //let entityHit = this.world.rayTraceEntities(from, to, currentReach);

        //if (entityHit) {
        //    return { type: 'entity', entity: entityHit };
        //}
        return blockHit;
    }

    isSprinting() {
        return this.sprinting;
    }
}
