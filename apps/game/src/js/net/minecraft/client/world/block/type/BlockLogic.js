import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockLogic extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Logic Block\n§7Work in Progress!!";
        this.hardness = 0.8;
        this.sound = Block.sounds.stone;
                        
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    getTextureForFace(face) {
        return 'logic';
    }
}
