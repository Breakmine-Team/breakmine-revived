import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockGrassPath extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Grass Path";
        this.hardness = 0.5;

        // Sound
        this.sound = Block.sounds.grass;
        this.boundingBox = new BoundingBox(0, 0, 0, 1, (1/16) * 15, 1);

        this.path = true;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getAmbientOcclusion() {
        return false;
    }

    getParticleTextureFace() {
        return EnumBlockFace.NORTH;
    }

    getTextureForFace(face) {
        switch (face) {
            case EnumBlockFace.TOP:
                return 'grass_path_top';
            case EnumBlockFace.BOTTOM:
                return 'dirt';
            default:
                return 'grass_path_side';
        }
    }
    
    getDrop(world, x, y, z) {
        return [3, 1];
    }

}