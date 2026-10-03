import ItemGeneric from "./ItemGeneric.js";
import { BlockRegistry } from "../BlockRegistry.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockPosition from "../../../../util/BlockPosition.js";

export default class ItemBluestoneLeverPlacer extends ItemGeneric {

    constructor(id, textureSlotId, description) {
        super(id, textureSlotId, description);
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    getTextureForFace(face) {
        return 'lever';
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        if (!world || x === undefined || y === undefined || z === undefined || !itemstack) {
            return;
        }

        const targetTypeId = world.getBlockAt(x, y, z);
        const targetBlock = Block.getById(targetTypeId);
        const canPlace = targetTypeId === 0 || (targetBlock && targetBlock.isReplaceable(world, x, y, z));

        if (!canPlace) {
            return;
        }

        world.setBlockAt(x, y, z, BlockRegistry.BLUESTONE_LEVER.getId());
        BlockRegistry.BLUESTONE_LEVER.onBlockPlaced(world, x, y, z, hitFace);
        if (world && !world.minecraft.player.creative) itemstack.shrink(1);
        world.minecraft.player.swingArm();
        this.notifyServerPlacement(world, x, y, z, hitFace, BlockRegistry.BLUESTONE_LEVER.getId());
    }

    // See ItemBluestoneDustPlacer.notifyServerPlacement: without this the
    // server never learns about the lever, so its mount/power state is never
    // persisted or simulated and the block vanishes when the chunk reloads.
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
