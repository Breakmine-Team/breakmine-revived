import ItemTool from "./ItemTool.js";
import BlockPosition from "../../../../util/BlockPosition.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class ItemHoe extends ItemTool {

    constructor(id, textureName, name, material) {
        super(id, textureName, name, material, 'hoe');
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        if (!world || x === undefined || y === undefined || z === undefined || !hitFace) {
            return;
        }

        // The click position is the block next to the hit face, so the block
        // the player actually clicked sits one face behind it.
        const clickedX = x - hitFace.x;
        const clickedY = y - hitFace.y;
        const clickedZ = z - hitFace.z;

        if (!this.canTill(world, clickedX, clickedY, clickedZ)) {
            return;
        }

        world.setBlockAt(clickedX, clickedY, clickedZ, BlockRegistry.FARMLAND.getId(), 0);

        const minecraft = world.minecraft;
        if (minecraft?.player) {
            minecraft.player.swingArm();
            minecraft.soundManager.playSound(
                'step.grass',
                clickedX + 0.5,
                clickedY + 1.0,
                clickedZ + 0.5,
                1.0,
                0.8
            );
        }

        this.notifyServerTilling(world, clickedX, clickedY, clickedZ);
    }

    canTill(world, x, y, z) {
        if (y < 0 || y + 1 >= 256) {
            return false;
        }

        const targetId = world.getBlockAt(x, y, z);
        if (targetId !== BlockRegistry.GRASS.id && targetId !== BlockRegistry.DIRT.id) {
            return false;
        }

        // Nothing can grow where the farmland is covered.
        return world.getBlockAt(x, y + 1, z) === 0;
    }

    notifyServerTilling(world, x, y, z) {
        if (world.isFieldLocalWorld) return;
        const minecraft = world.minecraft;
        if (!minecraft || !minecraft.playerController ||
            typeof minecraft.playerController.sendBlockPlacementPacket !== 'function') {
            return;
        }

        minecraft.playerController.sendBlockPlacementPacket(
            new BlockPosition(x, y, z),
            255,
            { id: this.id }
        );
    }

    onUseOnBlockServer(world, x, y, z) {
        if (!this.canTill(world, x, y, z)) {
            return;
        }

        world.setBlockAt(x, y, z, BlockRegistry.FARMLAND.getId(), 0);
        BlockRegistry.FARMLAND.onBlockAdded(world, x, y, z);
    }
}
