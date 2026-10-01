import Entity from "./Entity.js";
import Block from "../world/block/Block.js";
import ClientPickupItemPacket from "../network/packet/play/client/ClientPickupItemPacket.js";

export default class ItemEntity extends Entity {

    static GRAVITY = 0.04;
    static DRAG = 0.98;

    constructor(minecraft, world, blockId, x, y, z) {
        super(minecraft, world, -2); 

        this.width = 0.5;
        this.height = 0.5;

        this.blockId = blockId;
        this.block = Block.getById(blockId);

        this.x = x;
        this.y = y;
        this.z = z;

        this.setPositionAndRotation(x + 0.25, y, z + 0.25, 0, 0); 
        this.setPosition(this.x, this.y, this.z);
        
        this.motionY = 0.0;
        this.fallTime = 0;

        this.tickCount = 0;

        // Only items dropped via the Q key (or flagged by the server) keep the
        // pickup delay; items from block breaking are collectible immediately.
        this.hasPickupDelay = false;

        this.initRenderer(); 
    }

    onEntityUpdate() {
        super.onEntityUpdate();

        if (this.isDead) return;

        this.tickCount += 1;

        // Only allow pickup after 3 seconds (60 ticks) when the item was
        // dropped with the Q key; everything else is instantly collectible.
        if (!this.hasPickupDelay || this.tickCount >= 60) {
            // Check distance to player (target head level)
            let player = this.minecraft.player;
            let targetY = player.y + 1.2;
            let dx = player.x - this.x;
            let dy = targetY - this.y;
            let dz = player.z - this.z;
            let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // If within 2.5 range, move towards player
            if (distance < 2.5) {
                // Normalize direction and apply speed
                let speed = 0.25;
                this.motionX += (dx / distance) * speed;
                this.motionY += (dy / distance) * speed;
                this.motionZ += (dz / distance) * speed;

                // If touching player (very close), collect item
                if (distance < 0.6) {
                    // Add to inventory (stacks with existing or first empty slot, hotbar first)
                    if (player.inventory.addItem(this.blockId, 1)) {
                        // Play pop sound
                        this.minecraft.soundManager.playSound('random.pop', this.x, this.y, this.z, 1.0, 1.0);

                        // In multiplayer, tell server to remove item for all players
                        if (!this.minecraft.isSingleplayer()) {
                            let networkHandler = this.minecraft.playerController?.getNetworkHandler?.();
                            if (networkHandler) {
                                networkHandler.sendPacket(new ClientPickupItemPacket(this.id));
                            }
                        }

                        // Despawn item
                        this.isDead = true;
                        this.world.removeEntityById(this.id);
                        return;
                    }
                }
            }
        }

        this.motionY -= ItemEntity.GRAVITY;
        this.motionX *= ItemEntity.DRAG;
        this.motionZ *= ItemEntity.DRAG;

        this.setRotation(0, this.tickCount * 2);

        this.moveCollide(this.motionX, this.motionY, this.motionZ);

        if (this.onGround) {
            this.fallTime++;

            this.motionX *= 0.7;
            this.motionZ *= 0.7;
            this.motionY = 0;

            if (this.fallTime > 20) {
                this.motionX = 0;
                this.motionZ = 0;
            }
        } else {
            this.fallTime++;
        }
    }
    
    getBlockId() {
        return this.blockId;
    }
    
    getBlock() {
        return this.block;
    }
}