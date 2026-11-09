import BlockShaftControl from "./BlockShaftControl.js";

export default class BlockClutch extends BlockShaftControl {

    static TEXTURE_ON = 'clutch_on';
    static TEXTURE_OFF = 'clutch_off';

    constructor(id, textureSlotId) {
        super(id, textureSlotId, "Clutch", "Disengages rotation when powered");

        this.isClutch = true;
    }

    getPoweredTexture() {
        return BlockClutch.TEXTURE_OFF;
    }

    getUnpoweredTexture() {
        return BlockClutch.TEXTURE_ON;
    }

    getRotationPassThrough(world, x, y, z) {
        return this.isPowered(world, x, y, z) ? 0 : 1;
    }
}
