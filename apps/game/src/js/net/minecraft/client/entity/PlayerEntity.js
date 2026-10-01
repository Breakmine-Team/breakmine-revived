import EntityLiving from "./EntityLiving.js";
import Block from "../world/block/Block.js";
import MathHelper from "../../util/MathHelper.js";
import Keyboard from "../../util/Keyboard.js";
import Vector3 from "../../util/Vector3.js";
import {BlockRegistry} from "../world/block/BlockRegistry.js";
import InventoryPlayer from "../inventory/inventory/InventoryPlayer.js";
import GuiDeath from "../gui/screens/GuiDeath.js";
import BlockPosition from "../../util/BlockPosition.js";

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
        this.health = 20;
        this.isDead = false;

        this.typeOfDeath = 'hit the ground too hard';

        // Fall damage tracking
        this.fallDistance = 0;
        this.wasOnGround = false;

        this.collision = false;

        this.jumpMovementFactor = 0.02;
        this.speedInAir = 0.02;
        this.flySpeed = 0.05;
        this.stepHeight = 0.5;

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
    }

    handleInventoryChanged() {
        if (!this.minecraft || !this.minecraft.isInGame()) {
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
            type: 'inventory',
            username: this.username,
            inventory: this.inventory.toNetworkState()
        });
    }

    sendHealthUpdate() {
        if (!this.minecraft || !this.minecraft.isInGame()) {
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
        this.rotationYaw = this.rotationYaw + motionX * sensitivity;
        this.rotationPitch = this.rotationPitch - motionY * sensitivity;

        if (this.rotationPitch < -90.0) {
            this.rotationPitch = -90.0;
        }

        if (this.rotationPitch > 90.0) {
            this.rotationPitch = 90.0;
        }
    }

    onUpdate() {
        // Freeze the player while the world is still loading so it can't fall
        // through unloaded terrain before the world is ready.
        if (this.minecraft.loadingScreen !== null) {
            return;
        }
        super.onUpdate();
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

        if (this.sprinting && (this.moveForward <= 0 || this.collision || this.isSneaking())) {
            this.sprinting = false;

            this.updateFOVModifier();
        }

        super.onLivingUpdate();

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
        return this.world.getBlockAt(this.getBlockPosX(), this.getBlockPosY(), this.getBlockPosZ()) === BlockRegistry.WATER.getId();
    }

    isInLava() {
        return this.world.getBlockAt(this.getBlockPosX(), this.getBlockPosY(), this.getBlockPosZ()) === BlockRegistry.LAVA.getId();
    }

    isHeadInLava() {
        let cameraPosition = this.world.minecraft.worldRenderer.camera.position;
        return this.world.getBlockAt(
            Math.floor(cameraPosition.x),
            Math.floor(cameraPosition.y + 0.12),
            Math.floor(cameraPosition.z)
        ) === BlockRegistry.LAVA.getId()
    }

    isHeadInWater() {
        let cameraPosition = this.world.minecraft.worldRenderer.camera.position;
        return this.world.getBlockAt(
            Math.floor(cameraPosition.x),
            Math.floor(cameraPosition.y + 0.12),
            Math.floor(cameraPosition.z)
        ) === BlockRegistry.WATER.getId()
    }

    jump() {
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
        let slipperiness = 0.8;
        let friction = 0.02;

        this.moveRelative(forward, vertical, strafe, friction);
        this.collision = this.moveCollide(-this.motionX, this.motionY, -this.motionZ);

        this.motionX *= slipperiness;
        this.motionY *= 0.8;
        this.motionZ *= slipperiness;
        this.motionY -= 0.02;

        // Reset fall distance while in lava
        this.fallDistance = 0;
        this.wasOnGround = false;
    }

    travelInWater(forward, vertical, strafe) {
        let slipperiness = 0.8;
        let friction = 0.02;

        this.moveRelative(forward, vertical, strafe, friction);
        this.collision = this.moveCollide(-this.motionX, this.motionY, -this.motionZ);

        this.motionX *= slipperiness;
        this.motionY *= 0.8;
        this.motionZ *= slipperiness;
        this.motionY -= 0.02;

        // Reset fall distance while in water
        this.fallDistance = 0;
        this.wasOnGround = false;
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
                    if (this.fallDistance > 3) {
                        let damage = this.fallDistance - 3;
                        this.damageEntitySimple(Math.abs(damage));

                        // Play hurt sound
                        this.minecraft.soundManager.playSoundMono('random.hit', 1.0, 1.0);

                        // Play fall sound based on distance
                        if (this.fallDistance > 5) {
                            this.minecraft.soundManager.playSoundMono('random.fallbig', 1.0, 1.0);
                        } else {
                            this.minecraft.soundManager.playSoundMono('random.fallsmall', 1.0, 1.0);
                        }

                        this.typeOfDeath = 'hit the ground too hard';
                    }
                    this.fallDistance = 0;
                }
                this.wasOnGround = this.onGround;
            }

            // Lava damage
            if (!this.creative && !this.spectator && this.isInLava() && this.hurtTime === 0 && !this.isDead) {
                this.damageEntitySimple(2);
                this.minecraft.soundManager.playSoundMono('random.fire_hurt', 1.0, 1.0);
                this.typeOfDeath = 'tried to swim in lava';
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
        return this.sprinting ? 0.13 : 0.1;
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
                if (Keyboard.isKeyDown("Space")) jumping = true;
                if (Keyboard.isKeyDown(this.minecraft.settings.keyCrouching)) sneaking = true;
            } else {
                // Desktop mode: WASD for movement
                if (Keyboard.isKeyDown("KeyR")) {
                    // this.respawn();
                }
                if (Keyboard.isKeyDown("KeyW")) {
                    moveForward++;
                }
                if (Keyboard.isKeyDown("KeyS")) {
                    moveForward--;
                }
                if (Keyboard.isKeyDown("KeyA")) {
                    moveStrafe++;
                }
                if (Keyboard.isKeyDown("KeyD")) {
                    moveStrafe--;
                }
                if (Keyboard.isKeyDown("Space")) {
                    jumping = true;
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keySprinting)) {
                    if (this.moveForward > 0 && !this.isSneaking() && !this.sprinting && this.motionX !== 0 && this.motionZ !== 0) {
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
        return this.isSneaking() ? 1.50 : 1.62;
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
            if (!this.minecraft.isSingleplayer()) {
                try {
                    const nm = this.minecraft.playerController?.getNetworkHandler?.()?.getNetworkManager?.();
                    if (nm) nm.sendJson({ type: 'death', username: this.username, message: this.typeOfDeath });
                } catch (e) {}
            }
        }
    }

    respawn() {
        // Reset health
        this.health = 20;
        this.isDead = false;
        this.sendHealthUpdate();

        // Reset fall distance
        this.fallDistance = 0;
        this.wasOnGround = false;

        // Reset position to spawn
        if (this.world.spawn && this.world.spawn.x !== undefined) {
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