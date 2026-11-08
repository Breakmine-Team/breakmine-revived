import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";

export default class BlockGear extends BlockShaftPart {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Gear";
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;
        this.sound = Block.sounds.wood;
    }

    getShaftParts() {
        return [
            {part: ShaftRenderer.PART.COG, texture: this.getShaftTexture()},
            {part: ShaftRenderer.PART.SHAFT, texture: 'stone'}
        ];
    }

    getShaftTexture() {
        return 'spruce_planks';
    }

    isCog() {
        return true;
    }

    getPreferredToolType() {
        return 'axe';
    }
}
