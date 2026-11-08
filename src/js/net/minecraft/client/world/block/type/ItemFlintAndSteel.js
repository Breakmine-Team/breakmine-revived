import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";
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

    // Item use is handled on the client and early-returns before the block
    // placement code, so without this the server never hears about the click
    // and no portal is ever lit. Send the clicked block over as a use packet;
    // the server validates the obsidian frame and broadcasts the portal blocks.
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

        // x/y/z is the cell next to the hit face; the block the player clicked
        // is one face behind it, and that is what the frame search must see.
        const clickedX = x - hitFace.x;
        const clickedY = y - hitFace.y;
        const clickedZ = z - hitFace.z;

        if (minecraft.player) {
            minecraft.player.swingArm();
        }

        minecraft.playerController.sendBlockPlacementPacket(
            new BlockPosition(clickedX, clickedY, clickedZ),
            255,
            { id: this.id }
        );
    }
}
