import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import GuiContainerFurnace from "../../../gui/screens/container/GuiContainerFurnace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockFurnace extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Furnace";
        this.hardness = 3.5;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }
    
    getPreferredToolType() {
        return 'pickaxe';
    }

    getTextureForFace(face, data) {
        let facing = data & 7;
        if (facing === 0) facing = 2;
        const lit = (data & 8) !== 0;
        const frontTex = lit ? 'furnace_front_on' : 'furnace_front';
        switch (face) {
            case EnumBlockFace.NORTH:
                return facing === 2 ? frontTex : 'furnace_side';
            case EnumBlockFace.SOUTH:
                return facing === 3 ? frontTex : 'furnace_side';
            case EnumBlockFace.WEST:
                return facing === 4 ? frontTex : 'furnace_side';
            case EnumBlockFace.EAST:
                return facing === 5 ? frontTex : 'furnace_side';
            case EnumBlockFace.TOP:
                return 'furnace_top';
            case EnumBlockFace.BOTTOM:
                return 'furnace_top';
            default:
                return 'furnace_side';
        }
    }

    setLit(world, x, y, z, lit) {
        const data = world.getBlockDataAt(x, y, z);
        if (lit) {
            world.setBlockDataAt(x, y, z, data | 8);
        } else {
            world.setBlockDataAt(x, y, z, data & ~8);
        }
    }

    onBlockPlaced(world, x, y, z, face) {
        if (world && world.minecraft && world.minecraft.player) {
            let player = world.minecraft.player;
            let dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
            let data = [2, 5, 3, 4][dirIndex];
            world.setBlockDataAt(x, y, z, data);
        }
    }
    
    onMouseButton(world, x, y, z, button) {
        if (button === 2) {
            world.minecraft.displayScreen(new GuiContainerFurnace(world.minecraft.player, { x, y, z }));
            return true;
        }
        return false;
    }
}