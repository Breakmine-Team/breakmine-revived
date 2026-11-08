import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockDebugSpinner extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Debug Spinner";
        this.hardness = 1.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.DEBUG;

        this.noFaceCull = true;
    }

    getTextureForFace(face) {
        return 'stone';
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getOpacity() {
        return 0;
    }

    getRenderRotation(world, x, y, z, data, tick) {
        const step = (typeof tick === 'number' ? tick : 0) + 1;

        return {
            x: (step * 3) % 360,
            y: (step * 5) % 360,
            z: (step * 7) % 360
        };
    }
}
