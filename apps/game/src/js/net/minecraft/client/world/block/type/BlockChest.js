import Block from "../Block.js";
import GuiContainerChest from "../../../gui/screens/container/GuiContainerChest.js"
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockChest extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Chest";
        this.hardness = 2.5;
        this.boundingBox = new BoundingBox(0.0625, 0.0, 0.0625, 0.9375, 0.875, 0.9375);
        this.noFaceCull = true;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }
    
    getPreferredToolType() {
        return 'axe';
    }

    getTextureForFace(face, data) {
        let facing = data & 7;
        if (facing === 0) facing = 2;
        switch (face) {
            case EnumBlockFace.NORTH:
                return facing === 2 ? 'chest_front' : 'chest_side';
            case EnumBlockFace.SOUTH:
                return facing === 3 ? 'chest_front' : 'chest_side';
            case EnumBlockFace.WEST:
                return facing === 4 ? 'chest_front' : 'chest_side';
            case EnumBlockFace.EAST:
                return facing === 5 ? 'chest_front' : 'chest_side';
            case EnumBlockFace.TOP:
            case EnumBlockFace.BOTTOM:
                return 'chest_bottom';
            default:
                return 'chest_side';
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

    shouldRenderFace(world, x, y, z, face) {
        return true;
    }

    getAmbientOcclusion() {
        return false;
    }

    onMouseButton(world, x, y, z, button) {
        if (button === 2) {
            world.minecraft.displayScreen(new GuiContainerChest(world.minecraft.player, { x, y, z }));
            return true;
        }
        return false;
    }
}