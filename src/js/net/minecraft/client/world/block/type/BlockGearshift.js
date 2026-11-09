import BlockShaftControl from "./BlockShaftControl.js";

export default class BlockGearshift extends BlockShaftControl {

    static TEXTURE_ON = 'gearshift_on';
    static TEXTURE_OFF = 'gearshift_off';

    constructor(id, textureSlotId) {
        super(id, textureSlotId, "Gearshift", "Reverses rotation when powered");

        this.isGearshift = true;
    }

    getPoweredTexture() {
        return BlockGearshift.TEXTURE_ON;
    }

    getUnpoweredTexture() {
        return BlockGearshift.TEXTURE_OFF;
    }

    getRotationPassThrough(world, x, y, z) {
        return this.isPowered(world, x, y, z) ? -1 : 1;
    }
}
