import Block from "../Block.js";
import BlockChest from "./BlockChest.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockCounterDrawer extends BlockChest {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Drawer Counter";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.boundingBox = new BoundingBox(0.0, 0.0, 0.0, 1.0, 1.0, 1.0);
        this.noFaceCull = false;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        return Block.prototype.shouldRenderFace.call(this, world, x, y, z, face, prefetchedTypeId);
    }

    getAmbientOcclusion() {
        return true;
    }

    getTextureForFace(face, data) {
        let facing = data & 7;
        if (facing === 0) facing = 2;
        const frontTex = 'counter_side_drawer';
        switch (face) {
            case EnumBlockFace.NORTH:
                return facing === 2 ? frontTex : 'counter_side';
            case EnumBlockFace.SOUTH:
                return facing === 3 ? frontTex : 'counter_side';
            case EnumBlockFace.WEST:
                return facing === 4 ? frontTex : 'counter_side';
            case EnumBlockFace.EAST:
                return facing === 5 ? frontTex : 'counter_side';
            case EnumBlockFace.TOP:
                return 'counter_top';
            case EnumBlockFace.BOTTOM:
                return 'spruce_planks';
            default:
                return 'counter_side';
        }
    }

    getContainerTitle() {
        return "Drawer Counter";
    }
}
