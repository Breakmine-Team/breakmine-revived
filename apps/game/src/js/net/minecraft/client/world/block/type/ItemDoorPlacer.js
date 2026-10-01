import ItemGeneric from "./ItemGeneric.js";
import { BlockRegistry } from "../BlockRegistry.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class ItemDoorPlacer extends ItemGeneric {

    constructor(id, textureSlotId, description) {
        super(id, textureSlotId, description);
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getTextureForFace(face) {
        return 'oak_door';
    }

    onUse(world, x, y, z, itemstack) {
        if (!world || x === undefined || y === undefined || z === undefined || !itemstack) {
            return;
        }

        const targetTypeId = world.getBlockAt(x, y, z);
        const targetBlock = Block.getById(targetTypeId);
        const canPlace = targetTypeId === 0 || (targetBlock && targetBlock.isReplaceable(world, x, y, z));

        if (!canPlace) {
            return;
        }

        world.setBlockAt(x, y, z, BlockRegistry.OAK_DOOR.getId());
        if (world && !world.minecraft.player.creative) itemstack.shrink(1);
        world.minecraft.player.swingArm();
    }
}
