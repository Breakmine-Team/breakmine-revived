import ItemGeneric from "./ItemGeneric.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BlockPosition from "../../../../util/BlockPosition.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class ItemSeeds extends ItemGeneric {

    constructor(id, textureName, description) {
        super(id, 0, description);
        this.tex = textureName;
        this.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        if (!world || x === undefined || y === undefined || z === undefined || !itemstack || !hitFace) {
            return;
        }

        // Seeds only go on top of farmland.
        if (hitFace !== EnumBlockFace.TOP || y < 1) {
            return;
        }
        if (world.getBlockAt(x, y - 1, z) !== BlockRegistry.FARMLAND.id ||
            world.getBlockAt(x, y, z) !== 0) {
            return;
        }

        world.setBlockAt(x, y, z, BlockRegistry.WHEAT_CROP.getId(), 0);

        const minecraft = world.minecraft;
        if (minecraft?.player) {
            if (!minecraft.player.creative) {
                itemstack.shrink(1);
            }
            minecraft.player.swingArm();
        }

        this.notifyServerPlanting(world, x, y - 1, z);
    }

    notifyServerPlanting(world, x, y, z) {
        if (world.isFieldLocalWorld) return;
        const minecraft = world.minecraft;
        if (!minecraft || !minecraft.playerController ||
            typeof minecraft.playerController.sendBlockPlacementPacket !== 'function') {
            return;
        }

        // Direction 255 tells the server this is an item interaction on the
        // clicked block, so it runs the seed's authoritative planting hook.
        minecraft.playerController.sendBlockPlacementPacket(
            new BlockPosition(x, y, z),
            255,
            { id: this.id }
        );
    }

    onUseOnBlockServer(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== BlockRegistry.FARMLAND.id ||
            world.getBlockAt(x, y + 1, z) !== 0) {
            return;
        }

        world.setBlockAt(x, y + 1, z, BlockRegistry.WHEAT_CROP.getId(), 0);
        BlockRegistry.WHEAT_CROP.onBlockAdded(world, x, y + 1, z);
    }
}
