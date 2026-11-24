import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockBob extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bob";
        this.textureName = "bob";
        this.hardness = 1.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
        this.rotationType = Block.ROTATION_HORIZONTAL;
    }

    getTextureForFace(face, data) {
        let facing = data & 7;
        if (facing === 0) facing = 2;
        const frontTex = 'bob';
        switch (face) {
            case EnumBlockFace.NORTH:
                return facing === 2 ? frontTex : 'bob_side';
            case EnumBlockFace.SOUTH:
                return facing === 3 ? frontTex : 'bob_side';
            case EnumBlockFace.WEST:
                return facing === 4 ? frontTex : 'bob_side';
            case EnumBlockFace.EAST:
                return facing === 5 ? frontTex : 'bob_side';
            case EnumBlockFace.TOP:
            case EnumBlockFace.BOTTOM:
                return 'bob_side';
            default:
                return 'bob_side';
        }
    }
}
