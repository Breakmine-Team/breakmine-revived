import EntityLiving from './EntityLiving.js';
import Block from '../world/block/Block.js'
import MathHelper from '../../util/MathHelper.js'
import Vector3 from '../../util/Vector3.js'
import { BlockRegistry } from '../world/block/BlockRegistry.js'
import BoundingBox from '../../util/BoundingBox.js'
import explodeCraterAt from '../world/block/functions/Explosion.js';

/**
 * Simple implementation of a Creeper entity.
 */
export default class CreeperEntity extends EntityLiving {
    static name = 'CreeperEntity';

    constructor(minecraft, world, id, x, y, z) {
        super(minecraft, world, id);

        this.x = x;
        this.y = y;
        this.z = z;

        this.width = 0.6;
        this.height = 1.8;

        // Update bounding box
        let width = this.width / 2;
        this.boundingBox = new BoundingBox(
            x - width,
            y,
            z - width,
            x + width,
            y + this.height,
            z + width
        );

        this.collision = false

        this.jumpMovementFactor = 0.02
        this.speedInAir = 0.02
        this.flySpeed = 0.05
        this.stepHeight = 0.5

        this.fallDistance = 0

        this.flyToggleTimer = 0
        this.sprintToggleTimer = 0

        this.fuseTime = 30
        this.currentFuse = 0
        this.explosionRadius = 3

        this.sprinting = false
        this.flying = false

        this.prevFovModifier = 0
        this.fovModifier = 0
        this.timeFovChanged = 0

        this.renderArmPitch = 0
        this.renderArmYaw = 0

        this.rebuildTimes = 0;

        this.prevRenderArmPitch = 0
        this.prevRenderArmYaw = 0

        // For first person bobbing
        this.cameraYaw = 0
        this.cameraPitch = 0
        this.prevCameraYaw = 0
        this.prevCameraPitch = 0

        this.health = 20.0;

        // AI State Variables
        this.aiTimer = 0;
        this.moveForward = 0.0;
        this.moveStrafing = 0.0;
        this.jumping = false;
    }

    isInWater() {
        return this.world.getBlockAt(this.getBlockPosX(), this.getBlockPosY(), this.getBlockPosZ()) === BlockRegistry.WATER.getId()
    }

    isHeadInWater() {
        let cameraPosition = this.world.minecraft.worldRenderer.camera.position
        return (
            this.world.getBlockAt(Math.floor(cameraPosition.x), Math.floor(cameraPosition.y + 0.12), Math.floor(cameraPosition.z)) ===
            BlockRegistry.WATER.getId()
        )
    }

    explode() {
        console.log("Creeper exploded at: " + this.x + ", " + this.y + ", " + this.z);
        
        explodeCraterAt(this.world, Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), 5, 3);
        
        this.kill();
    }

    /**
     * Aggressive AI logic: track player or wander
     */
    updateAI() {
        const player = this.minecraft.player;
        
        // Don't attack creative players
        if (player && !player.creative) {
            let dx = player.x - this.x;
            let dy = player.y - this.y;
            let dz = player.z - this.z;
            let distanceSq = dx * dx + dy * dy + dz * dz;

            // Tracking Range (approx 16 blocks)
            if (distanceSq < 256) {
                // Face the player
                this.rotationYaw = MathHelper.toDegrees(Math.atan2(-dx, dz));
                this.moveForward = 0.5;

                // Explosion Range (approx 3 blocks)
                if (distanceSq < 9) {
                    this.setCreeperState(1); // Start swelling
                    this.currentFuse++;
                    if (this.currentFuse >= this.fuseTime) {
                        this.explode();
                    }
                } else {
                    this.setCreeperState(-1); // Stop swelling
                    if (this.currentFuse > 0) this.currentFuse--;
                }
                
                // Jump if blocked while chasing
                if (this.onGround && this.collision) {
                    this.jumping = true;
                }
                
                return; // Skip random wander logic
            }
        }

        if (this.aiTimer > 0) {
            this.aiTimer--;
        }

        if (this.aiTimer <= 0) {
            this.aiTimer = 40 + Math.floor(Math.random() * 40);
            if (Math.random() < 0.5) {
                this.moveForward = 0.5;
                this.rotationYaw = Math.random() * 360;
            } else {
                this.moveForward = 0.0;
            }
        }
        
        // Reset fuse if player is lost
        this.setCreeperState(-1);
        if (this.currentFuse > 0) this.currentFuse--;
    }

    onLivingUpdate() {
        this.prevCameraYaw = this.cameraYaw
        this.prevCameraPitch = this.cameraPitch

        // Run the AI Logic before physics update
        this.updateAI();

        if (this.sprintToggleTimer > 0) {
            --this.sprintToggleTimer
        }
        if (this.flyToggleTimer > 0) {
            --this.flyToggleTimer
        }

        if (!this.onGround && this.motionY < 0) {
            this.fallDistance -= this.motionY
        }

        let prevMoveForward = this.moveForward
        let prevJumping = this.jumping

        // Toggle jumping
        if (this.creative && !prevJumping && this.jumping) {
            if (this.flyToggleTimer === 0) {
                this.flyToggleTimer = 7
            } else {
                this.flying = !this.flying
                this.flyToggleTimer = 0
            }
        }

        // Toggle sprint
        if (prevMoveForward === 0 && this.moveForward > 0) {
            if (this.sprintToggleTimer === 0) {
                this.sprintToggleTimer = 7
            } else {
                this.sprinting = true
                this.sprintToggleTimer = 0
            }
        }

        if (this.sprinting && (this.moveForward <= 0 || this.collision || this.isSneaking())) {
            this.sprinting = false
        }

        super.onLivingUpdate()

        this.jumpMovementFactor = this.speedInAir

        if (this.sprinting) {
            this.jumpMovementFactor = this.jumpMovementFactor + this.speedInAir * 0.3
        }

        let speedXZ = Math.sqrt(this.motionX * this.motionX + this.motionZ * this.motionZ)
        let speedY = Math.atan(-this.motionY * 0.2) * 15.0

        if (speedXZ > 0.1) {
            speedXZ = 0.1
        }
        if (!this.onGround || this.health <= 0.0) {
            speedXZ = 0.0
        }
        if (this.onGround || this.health <= 0.0) {
            speedY = 0.0
        }
        this.cameraYaw += (speedXZ - this.cameraYaw) * 0.4
        this.cameraPitch += (speedY - this.cameraPitch) * 0.8 
    }

    jump() {
        this.motionY = 0.42

        if (this.sprinting) {
            let radiansYaw = MathHelper.toRadians(this.rotationYaw + 180)
            this.motionX -= Math.sin(radiansYaw) * 0.2
            this.motionZ += Math.cos(radiansYaw) * 0.2
        }
    }

    getEyeHeight() {
        return 1.6;
    }

    travel(forward, vertical, strafe) {
        let isSlow = this.onGround && this.isSneaking()
        let prevOnGround = this.onGround

        let prevX = this.x
        let prevZ = this.z

        let prevSlipperiness = this.getBlockSlipperiness() * 0.91

        let value = 0.16277136 / (prevSlipperiness * prevSlipperiness * prevSlipperiness)
        let friction

        if (this.onGround) {
            friction = this.getAIMoveSpeed() * value
        } else {
            friction = this.jumpMovementFactor
        }

        this.moveRelative(forward, vertical, strafe, friction)

        // Get new speed
        let slipperiness = this.getBlockSlipperiness() * 0.91

        // Move
        this.collision = this.moveCollide(-this.motionX, this.motionY, -this.motionZ)

        // Gravity
        if (!this.flying) {
            this.motionY -= 0.08
        }

        // Decrease motion
        this.motionX *= slipperiness
        this.motionY *= 0.98
        this.motionZ *= slipperiness

        const landingBlockX = MathHelper.floor(this.x);
        const landingBlockY = MathHelper.floor(this.y);
        const landingBlockZ = MathHelper.floor(this.z);
        const landingBlockId = this.world.getBlockAt(landingBlockX, landingBlockY, landingBlockZ);
        const landingBlock = Block.getById(landingBlockId);

        const isLandingInLiquid = landingBlock?.isLiquid() ?? false;


        // Fall Damage Logic
        if (this.onGround && !prevOnGround && !this.flying && !this.creative && !isLandingInLiquid) {
            if (this.fallDistance > 3) {
                let damage = this.fallDistance - 3
                this.health -= damage
                this.typeOfDeath = 'hit the ground too hard'
            }
            this.fallDistance = 0
        } else if (this.onGround) {
            this.fallDistance = 0
        } else if (isLandingInLiquid) {
            this.fallDistance = 0
        }

        // Reset fall distance on flying
        if (this.flying) {
            this.fallDistance = 0
        }

        // Step sound
        if (!isSlow) {
            let blockX = MathHelper.floor(this.x)
            let blockY = MathHelper.floor(this.y - 0.2)
            let blockZ = MathHelper.floor(this.z)
            let typeId = this.world.getBlockAt(blockX, blockY, blockZ)

            let distanceX = this.x - prevX
            let distanceZ = this.z - prevZ

            this.distanceWalked += Math.sqrt(distanceX * distanceX + distanceZ * distanceZ) * 0.6
            if (this.distanceWalked > this.nextStepDistance && typeId !== 0) {
                this.nextStepDistance = this.distanceWalked + 1

                let block = Block.getById(typeId)
                if (block !== null) {
                    let sound = block.getSound()

                    // Play sound
                    if (!block.isLiquid()) {
                        this.minecraft.soundManager.playSound(sound.getStepSound(), this.x, this.y, this.z, 0.25, sound.getPitch())
                    }
                }
            }
        } 
        if (this.minecraft.worldData.playerPos !== null && this.minecraft.worldData.playerPos !== undefined) {this.minecraft.worldData.playerPos = `${this.x},${this.y},${this.z}`};
        if (this.health <= 0) {
            this.kill();
        }
    }

    updateFOVModifier() {
        //
    }

    isSprinting() {
        return this.sprinting
    }

    getBlockPosX() {
        return this.x - (this.x < 0 ? 1 : 0)
    }

    getBlockPosY() {
        return this.y - (this.y < 0 ? 1 : 0)
    }

    getBlockPosZ() {
        return this.z - (this.z < 0 ? 1 : 0)
    }

    getPositionEyes(partialTicks) {
        if (partialTicks === 1.0) {
            return new Vector3(this.x, this.y + this.getEyeHeight(), this.z)
        } else {
            let x = this.prevX + (this.x - this.prevX) * partialTicks
            let y = this.prevY + (this.y - this.prevY) * partialTicks + this.getEyeHeight()
            let z = this.prevZ + (this.z - this.prevZ) * partialTicks
            return new Vector3(x, y, z)
        }
    }

    /**
         * interpolated look vector
         */
    getLook(partialTicks) {
        // TODO interpolation
        return this.getVectorForRotation(this.rotationPitch, this.rotationYaw)
    }

    /**
         * Creates a Vec3 using the pitch and yaw of the entities rotation.
         */
    getVectorForRotation(pitch, yaw) {
        let z = Math.cos(-yaw * 0.017453292 - Math.PI)
        let x = Math.sin(-yaw * 0.017453292 - Math.PI)
        let xz = -Math.cos(-pitch * 0.017453292)
        let y = Math.sin(-pitch * 0.017453292)
        return new Vector3(x * xz, y, z * xz)
    }

    getBlockSlipperiness() {
        return this.onGround ? 0.6 : 1.0
    }

    getAIMoveSpeed() {
        return this.sprinting ? 0.13 : 0.1
    }

    moveRelative(forward, up, strafe, friction) {
        let distance = strafe * strafe + up * up + forward * forward

        if (distance >= 0.0001) {
            distance = Math.sqrt(distance)

            if (distance < 1.0) {
                distance = 1.0
            }

            distance = friction / distance
            strafe = strafe * distance
            up = up * distance
            forward = forward * distance

            let yawRadians = MathHelper.toRadians(this.rotationYaw + 180)
            let sin = Math.sin(yawRadians)
            let cos = Math.cos(yawRadians)

            this.motionX += strafe * cos - forward * sin
            this.motionY += up
            this.motionZ += forward * cos + strafe * sin
        }
    }


    travelInWater() {
        //
    }

    setCreeperState(state) {
        // state 1 = swelling/igniting, state -1 = idle
        this.setFlag(16, state === 1); 
    }

    isPowered() {
        return this.getFlag(17);
    }
}