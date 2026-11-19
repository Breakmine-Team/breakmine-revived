import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";
import { moveBlock } from "../../../../util/BlockMove.js";

export default class BlockPushBlock extends Block {

    static PUSH_DURATION_MS = 220;

    // Keeps the client from asking the server to push the same block every tick.
    static lastPushRequest = new Map();

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Pushblock";
        this.hardness = 0.4;

        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    pickedItem() {
        return this.id;
    }

    getTextureForFace(face) {
        return 'cobblestone_frame';
    }

    tryPush(world, x, y, z, pushX, pushZ) {
        if (pushX === 0 && pushZ === 0) return false;
        if (world.isFieldLocalWorld === true) return false;

        const minecraft = world.minecraft;

        // Online sessions let the server move the block, so every client sees it
        // in the same place.
        if (minecraft && typeof minecraft.isSingleplayer === "function" && !minecraft.isSingleplayer()) {
            const controller = minecraft.playerController;
            if (!controller || typeof controller.sendJson !== "function") return false;

            const key = `${x},${y},${z}`;
            const now = Date.now();
            if (now - (BlockPushBlock.lastPushRequest.get(key) || 0) < 150) return false;

            if (BlockPushBlock.lastPushRequest.size > 64) {
                for (const [otherKey, time] of BlockPushBlock.lastPushRequest) {
                    if (now - time > 1000) BlockPushBlock.lastPushRequest.delete(otherKey);
                }
            }
            BlockPushBlock.lastPushRequest.set(key, now);

            return controller.sendJson({
                type: "pushBlock",
                x: x,
                y: y,
                z: z,
                dx: pushX,
                dz: pushZ
            });
        }

        return moveBlock(world, x, y, z, x + pushX, y, z + pushZ,
            BlockPushBlock.PUSH_DURATION_MS);
    }

    // Walking into the block shoves it one cell in the direction of travel.
    onPushedByEntity(world, x, y, z, dirX, dirZ) {
        return this.tryPush(world, x, y, z, dirX, dirZ);
    }
}
