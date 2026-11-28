import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

// A Balancer keeps the contraption it is part of upright. While the hull is in
// water it cancels the roll and pitch the body has picked up and pushes the deck
// back level, so a boat carrying one does not capsize when a wave, a lopsided
// load or a rider tips it. It only turns the hull about its horizontal axes: the
// heading is left to the helm. Any cell of the body can be a balancer, and one
// is enough.
export default class BlockBalancer extends Block {

    static TEXTURE = 'balancer';

    // Righting push per tick at a tilt of 90 degrees, in radians per tick. The
    // water drag already slows every turn, so a small push settles the hull fast
    // without making it rock past level.
    static RIGHTING = 0.04;

    // How much of the leftover roll and pitch spin is kept each tick. This is
    // the "does not rock" half of the block: the push above brings the deck
    // back, this stops it swinging past.
    static TILT_DAMPING = 0.9;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Balancer";
        this.shiftDescription = "Keeps the contraption it is part of level: it rights the hull and stops it rocking, so a boat does not capsize";
        this.hardness = 1.5;

        this.textureName = BlockBalancer.TEXTURE;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;

        this.isBalancer = true;
    }

    getTextureForFace() {
        return BlockBalancer.TEXTURE;
    }
}
