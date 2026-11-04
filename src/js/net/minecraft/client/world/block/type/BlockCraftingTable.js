import Block from "../Block.js";
import GuiContainerCraftingTable from "../../../gui/screens/container/GuiContainerCraftingTable.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockCraftingTable extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Crafting Table";
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    getTextureForFace(face) {
        switch (face) {
            case EnumBlockFace.NORTH:
                return 'crafting_table_front';
            case EnumBlockFace.TOP:
                return 'crafting_table_top';
            case EnumBlockFace.BOTTOM:
                return 'oak_planks';
            default:
                return 'crafting_table_side';
        }
    }

    onMouseButton(world, x, y, z, button) {
        if (button === 2) {
            world.minecraft.displayScreen(new GuiContainerCraftingTable(world.minecraft.player, { x, y, z }));
            return true;
        }
        return false;
    }
}