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

        this.cameraYaw = 0;
        this.cameraPitch = 0;
        this.prevCameraYaw = 0;
        this.prevCameraPitch = 0;

        this.width = 0.6;
        this.height = 1.8;

        // The ragdoll this player is currently limp as, or null.
        this.ragdollBody = null;

        // The Boat Core contraption this player is steering, or null.
        this.boatContraption = null;

        // Shown above the hotbar while the helm is held, like the CCTV overlay.
        this.boatStatusText = "Controlling Boat, shift to exit";

        // Walking input while steering: the keys drive the boat, not the player.
        this.steerForward = 0.0;
        this.steerStrafe = 0.0;

        // Last input relayed to the client that simulates the boat, so only
        // changes and a heartbeat go over the network.
        this.lastBoatInput = null;
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

    
    turn(motionX, motionY, sensitivityPercent = this.minecraft.settings.getMouseSensitivity()) {
        let sensitivity = sensitivityPercent / 500;
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
        if (this.minecraft.loadingScreen !== null) {
            return;
        }
        super.onUpdate();
    }

    followRagdollBody() {
        const box = this.ragdollBody && this.ragdollBody.boundingBox;
        if (!box) {
            return;
        }

        this.motionX = 0;
        this.motionY = 0;
        this.motionZ = 0;
        this.fallDistance = 0;
        this.onGround = true;

        this.setPosition(
            (box.minX + box.maxX) * 0.5,
            box.minY,
            (box.minZ + box.maxZ) * 0.5
        );
    }

    onLivingUpdate() {
        // Limp: no walking, gravity or fall damage. The camera and the player
        // follow the ragdoll instead, so the view lies on the floor and tumbles
        // with the body.
        if (this.ragdollBody !== null) {
            this.rotationYawHead = this.rotationYaw;
            this.followRagdollBody();
            return;
        }

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
            this.updateBoatControl();

            if (this.boatContraption !== null) {
                // At the helm the keys steer the contraption, so the player
                // stays put on deck and the input is passed on instead.
                this.steerForward = this.moveForward;
                this.steerStrafe = this.moveStrafing;
                this.moveForward = 0;
                this.moveStrafing = 0;
                this.jumping = false;
                this.sendBoatInput();
            } else {
                this.steerForward = 0;
                this.steerStrafe = 0;
                this.lastBoatInput = null;
            }
        }

        if (!prevJumping && this.jumping) {
            if (this.flyToggleTimer === 0) {
                this.flyToggleTimer = 7;
            } else {
                if (this.creative || this.spectator) {
                    this.flying = this.spectator || !this.flying;
                    this.flyToggleTimer = 0;
                    this.updateFOVModifier();
                }
            }
        }

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

        if (this === this.minecraft.player) {
            const turntableSpin = this.getTurntableSpin();
            if (turntableSpin !== 0) {
                this.rotationYaw -= turntableSpin;
            }
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

    // A helm lasts until the pilot lets go: right clicking the core again,
    // sneaking, dying, or the boat going away. Standing on the hull is not
    // required, so the core can be worked from the dock or the shore.
    updateBoatControl() {
        const boat = this.boatContraption;

        if (boat === null) {
            this.setBoatStatusText(false);
            return;
        }

        if (this.isDead || boat.pilot !== this || !boat.isSteerableAt(this)) {
            this.leaveBoat();
            return;
        }

        this.setBoatStatusText(true);
    }

    // The helm hint sits where the CCTV one does, just above the hotbar. It is
    // only cleared if it is still ours, so an unrelated status stays put.
    setBoatStatusText(visible) {
        const overlay = this.minecraft ? this.minecraft.ingameOverlay : null;

        if (!overlay || typeof overlay.setStatusText !== "function") {
            return;
        }

        if (visible) {
            overlay.setStatusText(this.boatStatusText);
        } else if (typeof overlay.getStatusText === "function"
            && overlay.getStatusText() === this.boatStatusText) {
            overlay.clearStatusText();
        }
    }

    // Take the helm of a boat contraption: from then on the movement keys steer
    // it instead of the player.
    boardBoat(contraption) {
        if (!contraption || typeof contraption.isSteerableAt !== "function"
            || !contraption.isSteerableAt(this)) {
            return false;
        }

        this.leaveBoat();

        this.boatContraption = contraption;
        contraption.pilot = this;

        this.setBoatStatusText(true);

        return true;
    }

    leaveBoat() {
        const boat = this.boatContraption;

        if (boat !== null) {
            if (boat.pilot === this) {
                boat.pilot = null;
            }

            // The client that simulates the boat stops it when the keys stop
            // arriving, but say so at once instead of letting it coast.
            if (boat.remote) {
                this.sendBoatControl(boat, 0.0, 0.0, this.rotationYaw);
            }

            this.boatContraption = null;
        }

        this.lastBoatInput = null;
        this.setBoatStatusText(false);
    }

    // A body another client simulates cannot be pushed from here, so the keys
    // are relayed to the client that owns the simulation. Sent on change and as
    // a heartbeat, since the owner forgets input it stops hearing.
    sendBoatInput() {
        const boat = this.boatContraption;

        if (boat === null || !boat.remote) {
            return;
        }

        const forward = this.steerForward || 0.0;
        const strafe = this.steerStrafe || 0.0;
        const yaw = Math.round(this.rotationYaw * 10) / 10;
        const signature = forward + "|" + strafe + "|" + yaw;

        if (signature === this.lastBoatInput && this.ticksExisted % 4 !== 0) {
            return;
        }

        this.lastBoatInput = signature;
        this.sendBoatControl(boat, forward, strafe, yaw);
    }

    sendBoatControl(boat, forward, strafe, yaw) {
        const manager = typeof boat.getNetworkManager === "function"
            ? boat.getNetworkManager()
            : null;

        if (manager === null) {
            return;
        }

        try {
            manager.sendJson({
                type: "contraption:control",
                id: boat.syncId,
                forward: forward,
                strafe: strafe,
                yaw: yaw
            });
        } catch (error) {
            // A dropped packet only means the boat coasts for a moment.
        }
    }

    isInWater() {
        return this.world.getBlockAt(this.getBlockPosX(), this.getBlockPosY(), this.getBlockPosZ()) === BlockRegistry.WATER.getId();
    }

    isOnLadder() {
        const ladderDetectionPadding = 0.05;
        const minX = MathHelper.floor(this.boundingBox.minX - ladderDetectionPadding);
        const maxX = MathHelper.floor(this.boundingBox.maxX + ladderDetectionPadding);
        const minY = MathHelper.floor(this.boundingBox.minY);
        const maxY = MathHelper.floor(this.boundingBox.maxY - 1e-6);
        const minZ = MathHelper.floor(this.boundingBox.minZ - ladderDetectionPadding);
        const maxZ = MathHelper.floor(this.boundingBox.maxZ + ladderDetectionPadding);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const block = Block.getById(this.world.getBlockAt(x, y, z));
                    if (block?.isClimbable?.()) {
                        return true;
                    }
                }
            }
        }
        return false;
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
        let friction = 0.02;

        this.moveRelative(forward, vertical, strafe, friction);
        this.collision = this.moveCollide(-this.motionX, this.motionY, -this.motionZ);

        this.motionX *= 0.5;
        this.motionY *= 0.5;
        this.motionZ *= 0.5;
        this.motionY -= 0.02;

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

        this.fallDistance = 0;
        this.wasOnGround = false;
    }

    travel(forward, vertical, strafe) {
        let isSlow = this.onGround && this.isSneaking();

        let prevX = this.x;
        let prevZ = this.z;

        if (this === this.world.minecraft.player) {
            const isOnLadder = !this.spectator && this.isOnLadder();
            let prevSlipperiness = this.getBlockSlipperiness() * 0.91;

            let value = 0.16277136 / (prevSlipperiness * prevSlipperiness * prevSlipperiness);
            let friction;

            if (this.onGround) {
                friction = this.getAIMoveSpeed() * value;
            } else {
                friction = this.jumpMovementFactor;
            }

            this.moveRelative(forward, vertical, strafe, friction);
            if (isOnLadder) {
                this.motionY = this.jumping ? 0.15 : this.isSneaking() ? -0.15 : 0;
            }

            let slipperiness = this.getBlockSlipperiness() * 0.91;

            if (this.spectator) {
                this.boundingBox.move(-this.motionX, this.motionY, -this.motionZ);
                this.x = (this.boundingBox.minX + this.boundingBox.maxX) / 2.0;
                this.y = this.boundingBox.minY;
                this.z = (this.boundingBox.minZ + this.boundingBox.maxZ) / 2.0;
                this.onGround = false;
                this.collision = false;
            } else {
                this.collision = this.moveCollide(-this.motionX, this.motionY, -this.motionZ);
            }

            if (!this.flying && !isOnLadder) {
                this.motionY -= 0.08;
            }

            this.motionX *= slipperiness;
            this.motionY *= 0.98;
            this.motionZ *= slipperiness;

            if (isOnLadder) {
                this.fallDistance = 0;
            }
            if (!this.creative && !this.spectator && !this.isDead) {
                if (isOnLadder) {
                    this.wasOnGround = this.onGround;
                } else if (!this.onGround) {
                    if (this.motionY < 0) {
                        this.fallDistance -= this.motionY;
                    }
                } else if (this.wasOnGround !== this.onGround && !this.wasOnGround) {
                    if (this.fallDistance > 3) {
                        let damage = this.fallDistance - 3;
                        this.damageEntitySimple(Math.abs(damage));

                        this.minecraft.soundManager.playSoundMono('random.hit', 1.0, 1.0);

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

            if (!this.creative && !this.spectator && this.isInLava() && this.hurtTime === 0 && !this.isDead) {
                this.damageEntitySimple(2);
                this.minecraft.soundManager.playSoundMono('random.fire_hurt', 1.0, 1.0);
                this.typeOfDeath = 'tried to swim in lava';
            }

            if (this.health <= 0 && !this.isDead) {
                this.health = 0;
                this.isDead = true;
                this.die();
            }
        }

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

                    if (!block.isLiquid()) {
                        this.minecraft.soundManager.playSound(sound.getStepSound(), this.x, this.y, this.z, 0.15, sound.getPitch());
                    }
                }
            }
        }
    }

    getBlockSlipperiness() {
        if (!this.onGround) {
            return 1.0;
        }

        let blockX = MathHelper.floor(this.x);
        let blockY = MathHelper.floor(this.y - 0.2);
        let blockZ = MathHelper.floor(this.z);
        let blockId = this.world.getBlockAt(blockX, blockY, blockZ);
        let block = Block.getById(blockId);

        if (block && block.slipperiness !== undefined) {
            return block.slipperiness;
        }

        return 0.6;
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

    clearMovementInput() {
        this.moveForward = 0;
        this.moveStrafing = 0;
        this.jumping = false;
        this.sprinting = false;
    }

    updateKeyboardInput() {
        let moveForward = 0.0;
        let moveStrafe = 0.0;

        let jumping = false;
        let sneaking = false;

        const movementLocked = this.minecraft.isMovementProhibited?.() === true;

        if (this.minecraft.hasInGameFocus() && !movementLocked) {
            if (this.minecraft.settings.tvmode) {
                let looking = Keyboard.isKeyDown("Enter");

                if (looking) {
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
                    if (Keyboard.isKeyDown("ArrowUp")) moveForward++;
                    if (Keyboard.isKeyDown("ArrowDown")) moveForward--;
                    if (Keyboard.isKeyDown("ArrowLeft")) moveStrafe++;
                    if (Keyboard.isKeyDown("ArrowRight")) moveStrafe--;
                }

                if (Keyboard.isKeyDown(this.minecraft.settings.keyJump)) jumping = true;
                if (Keyboard.isKeyDown(this.minecraft.settings.keyCrouching)) sneaking = true;
            } else {
                if (Keyboard.isKeyDown("KeyR")) {
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keyForward)) {
                    moveForward++;
                }
                if (Keyboard.isKeyDown(this.minecraft.settings.keyBack)) {
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
        // A limp player looks out from just above their body. That is standing
        // height while the body is still upright after the ragdoll toggle, and
        // sinks to the floor as the body falls over.
        const box = this.ragdollBody && this.ragdollBody.boundingBox;
        if (box) {
            return Math.max(0.2, Math.min(1.62, box.maxY - this.y + 0.12));
        }

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
            // A limp body is not a death: stop following it before the corpse with
            // the items takes its place, otherwise respawning would snap back.
            if (typeof this.minecraft.endPlayerRagdoll === 'function') {
                this.minecraft.endPlayerRagdoll();
            }

            // The body stays behind as a ragdoll holding everything the player
            // was carrying, and respawning does not keep a second copy.
            if (typeof this.minecraft.spawnPlayerCorpse === 'function') {
                this.minecraft.spawnPlayerCorpse(this);
            }

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
        this.health = 20;
        this.isDead = false;
        this.ragdollBody = null;
        this.sendHealthUpdate();

        this.fallDistance = 0;
        this.wasOnGround = false;

        let spawnX = 0;
        let spawnY = 64;
        let spawnZ = 0;

        if (this.world.spawn && this.world.spawn.x !== undefined) {
            spawnX = this.world.spawn.x;
            spawnY = this.world.spawn.y;
            spawnZ = this.world.spawn.z;
        } else if (this.world.spawnX !== undefined) {
            spawnX = this.world.spawnX;
            spawnY = this.world.spawnY;
            spawnZ = this.world.spawnZ;
        }

        // Respawning is a teleport: snap the previous position as well, or the
        // camera interpolates the whole distance from where the player died.
        this.setPositionAndRotation(spawnX, spawnY, spawnZ, this.rotationYaw, this.rotationPitch);

        this.motionX = 0;
        this.motionY = 0;
        this.motionZ = 0;
    }

    
    getLook(partialTicks) {
        return this.getVectorForRotation(this.rotationPitch, this.rotationYaw);
    }

    
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
        let reachPoint = null;
        if (blockHit) {
            reachPoint = blockHit.fieldCell
                ? blockHit.vector
                : new Vector3(blockHit.x, blockHit.y, blockHit.z);
        }
        let currentReach = reachPoint ? from.distanceTo(reachPoint) : blockReachDistance;


        return blockHit;
    }

    
    getTurntableSpin() {
        const world = this.world;
        if (!world || typeof world.getBlockAt !== 'function') {
            return 0;
        }

        const x = Math.floor(this.x);
        const y = Math.floor(this.y - 0.1);
        const z = Math.floor(this.z);

        const block = Block.getById(world.getBlockAt(x, y, z));
        if (!block || typeof block.getTurntableSpin !== 'function') {
            return 0;
        }

        return block.getTurntableSpin(world, x, y, z);
    }

    isSprinting() {
        return this.sprinting;
    }
}