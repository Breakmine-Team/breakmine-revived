import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";

/** A spruce cog on a stone axle; it faces the player who placed it. */
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

    // Cogs mesh with neighbouring cogs and turn the other way.
    isCog() {
        return true;
    }

    getPreferredToolType() {
        return 'axe';
    }
}
