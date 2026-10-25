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

        // Data 0 marks a source block; only the flow simulation may create
        // weaker (higher-level) blocks from it.
        world.setBlockAt(x, y, z, BlockRegistry.WATER.getId(), 0);
        itemstack.typeId = BlockRegistry.ITEM_BUCKET_EMPTY.getId();
        if (!world.minecraft.player.creative) itemstack.count = Math.max(1, itemstack.count || 1);
        this.notifyServerPlacement(world, x, y, z, hitFace, BlockRegistry.WATER.getId());
    }

    notifyServerPlacement(world, x, y, z, hitFace, blockId) {
        if (world && world.isFieldLocalWorld) return; // see ItemBluestoneDustPlacer
        const minecraft = world.minecraft;
        if (!minecraft || !hitFace || !minecraft.playerController ||
            typeof minecraft.playerController.sendBlockPlacementPacket !== 'function') {
            return;
        }
        // The packet carries the *clicked* block, and the server applies the
        // face offset itself. x/y/z here are already the adjacent block the
        // water went into, so sending them would place it one block further
        // (one block above when using the bucket on a top face).
        minecraft.playerController.sendBlockPlacementPacket(
            new BlockPosition(x - hitFace.x, y - hitFace.y, z - hitFace.z),
            minecraft.getFaceValue(hitFace),
            { id: blockId }
        );
    }
}
