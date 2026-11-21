import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockGlass extends Block {

    constructor(id, textureSlotId, isBoarded = false) {
        super(id, textureSlotId);
        this.description = isBoarded === true ? "Boarded Glass" : "Glass";
        this.hardness = 0.3;
        this.isBoarded = isBoarded;

        this.sound = Block.sounds.glass;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face, data, x, y, z, world) {
        if (!this.isBoarded) {return 'glass';}

        // add more?
        const variants = [
            'window_planks',
            'window_planks_2',
            'window_planks_3',
            'window_planks_4',
            'window_planks_5'
        ];

        const index = (((x + y + z) % 5) + 5) % 5;
        return variants[index];
    }

    isTranslucent() {
        return true;
    }

    shouldRenderFace(world, x, y, z, face) {
        let typeId = world.getBlockAtFace(x, y, z, face);
        return typeId === 0 || typeId !== this.id;
    }

    getOpacity() {
        return 0;
    }
}