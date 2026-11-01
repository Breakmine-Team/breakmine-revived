import ItemGeneric from "./ItemGeneric.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class ItemRoadBuilder extends ItemGeneric {

    constructor(id, textureName, description) {
        super(id, textureName, 'Road Builder\n§7RMB: Place\n§7+/-: Width\n§7R: Variant');
        this.isRoadBuilder = true;
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        if (!world || !world.minecraft || !world.minecraft.roadBuilder) {
            return;
        }

        // The generic item path hands us the cell in front of the clicked
        // face. The road builder works into the selected surface instead, so
        // undo that offset and use the block that was actually clicked.
        if (x !== undefined && y !== undefined && z !== undefined && hitFace) {
            x -= hitFace.x || 0;
            y -= hitFace.y || 0;
            z -= hitFace.z || 0;
        }
        world.minecraft.roadBuilder.handleUse(world, x, y, z, hitFace);
    }
}
