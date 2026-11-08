import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

/**
 * A solid, flat-coloured block used to mark an area while building. The six
 * markers share this class and differ only in texture, so the corners and
 * origin of a structure stand out against whatever it is built from.
 */
export default class BlockStructureMarker extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 0.5;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
