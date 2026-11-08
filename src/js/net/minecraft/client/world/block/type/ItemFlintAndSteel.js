import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";
import Block from "../Block.js";
import BlockPosition from "../../../../util/BlockPosition.js";

export default class ItemFlint extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Flint and Steel";
        this.isTool = false;
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
    }

    getTextureForFace(face) {
        return 'flint_and_steel';
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        if (!world || x === undefined || y === undefined || z === undefined || !hitFace) {
            return;
        }
        if (world.isFieldLocalWorld) {
            return;
        }

        const minecraft = world.minecraft;
        if (!minecraft || !minecraft.playerController ||
            typeof minecraft.playerController.sendBlockPlacementPacket !== 'function') {
            return;
        }

        const clickedX = x - hitFace.x;
        const clickedY = y - hitFace.y;
        const clickedZ = z - hitFace.z;

        if (minecraft.player) {
            minecraft.player.swingArm();
        }

        // TNT is ignited by the tool itself: holding an item sends the click
        // down this path instead of the block's onMouseButton, so without this
        // a flint and steel would never light TNT locally. The packet below
        // still tells the server (see handleBlockPlacement).
        const clickedBlock = Block.getById(world.getBlockAt(clickedX, clickedY, clickedZ));
        if (clickedBlock && typeof clickedBlock.ignite === "function") {
            clickedBlock.ignite(world, clickedX, clickedY, clickedZ);
        }

        minecraft.playerController.sendBlockPlacementPacket(
            new BlockPosition(clickedX, clickedY, clickedZ),
            255,
            { id: this.id }
        );
    }
}
