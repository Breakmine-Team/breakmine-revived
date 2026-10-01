import ItemGeneric from "./ItemGeneric.js";
import { BlockRegistry } from "../BlockRegistry.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockPosition from "../../../../util/BlockPosition.js";

export default class ItemBucketWater extends ItemGeneric {

    constructor(id, textureSlotId, description) {
        super(id, textureSlotId, description);
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        if (!world || x === undefined || y === undefined || z === undefined || !itemstack) {
            return;
        }

        const targetTypeId = world.getBlockAt(x, y, z);
        const targetBlock = Block.getById(targetTypeId);
        const canPlace = targetTypeId === 0 || (targetBlock && targetBlock.isReplaceable(world, x, y, z) && targetTypeId !== BlockRegistry.WATER.getId() && targetTypeId !== BlockRegistry.LAVA.getId());

        if (!canPlace) {
            return;
        }

        world.setBlockAt(x, y, z, BlockRegistry.WATER.getId());
        itemstack.typeId = BlockRegistry.ITEM_BUCKET_EMPTY.getId();
        if (!world.minecraft.player.creative) itemstack.count = Math.max(1, itemstack.count || 1);
        this.notifyServerPlacement(world, x, y, z, hitFace, BlockRegistry.WATER.getId());
    }

    notifyServerPlacement(world, x, y, z, hitFace, blockId) {
        const minecraft = world.minecraft;
        if (!minecraft || !hitFace || !minecraft.playerController ||
            typeof minecraft.playerController.sendBlockPlacementPacket !== 'function') {
            return;
        }
        minecraft.playerController.sendBlockPlacementPacket(
            new BlockPosition(x - hitFace.x, y - hitFace.y, z - hitFace.z),
            minecraft.getFaceValue(hitFace),
            { id: blockId }
        );
    }
}
