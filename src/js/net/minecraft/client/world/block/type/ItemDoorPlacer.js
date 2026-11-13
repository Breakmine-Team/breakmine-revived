import ItemGeneric from "./ItemGeneric.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockPosition from "../../../../util/BlockPosition.js";

export default class ItemDoorPlacer extends ItemGeneric {

    constructor(id, textureSlotId, description, doorBlock, itemTexture = 'oak_door') {
        super(id, textureSlotId, description);
        this.doorBlock = doorBlock;
        this.itemTexture = itemTexture;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getTextureForFace(face) {
        return this.itemTexture;
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

        world.setBlockAt(x, y, z, this.doorBlock.getId());
        if (world && !world.minecraft.player.creative) itemstack.shrink(1);
        world.minecraft.player.swingArm();
        this.notifyServerPlacement(world, x, y, z, hitFace, this.doorBlock.getId());
    }

    notifyServerPlacement(world, x, y, z, hitFace, blockId) {
        if (world && world.isFieldLocalWorld) return; 
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
