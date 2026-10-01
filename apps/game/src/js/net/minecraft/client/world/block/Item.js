import Block from "./Block.js";
import BlockRenderType from "../../../util/BlockRenderType.js";
import EnumBlockFace from "../../../util/EnumBlockFace.js";
import BoundingBox from "../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../gui/EnumCreativeInventoryTab.js";

export default class Item extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.boundingBox = new BoundingBox(0.0, 0.0, 0.0, 0.0, 1.0, 1.0);
        this.isTool = false;
        this.inventoryTab = EnumCreativeInventoryTab
    }
    
    getTextureForFace(face) {
        return 'missing';
    }

    isItem() {
        return true;
    }

    getRenderType() {
        return BlockRenderType.ITEM;
    }
}
