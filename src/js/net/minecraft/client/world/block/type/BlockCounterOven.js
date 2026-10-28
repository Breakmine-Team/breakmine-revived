import Block from "../Block.js";
import BlockFurnace from "./BlockFurnace.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockCounterOven extends BlockFurnace {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Oven Counter";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    getPreferredToolType() {
        return 'axe';
    }

    getTextureForFace(face, data) {
        let facing = data & 7;
        if (facing === 0) facing = 2;
        const lit = (data & 8) !== 0;
        const frontTex = lit ? 'counter_stove_side_on' : 'counter_stove_side';
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
}
