import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

// A Boat Core turns the contraption it is part of into a boat. The core can sit
// anywhere on the hull: once any cell of the body is in water the contraption
// floats, and a player who right clicks the core steers it with WASD. They do
// not have to stand on the hull to work the helm, and the keys push the boat the
// way they are facing. A core with nobody at the helm does nothing, so an empty
// boat stays where it is instead of sailing off on its own.
export default class BlockBoatCore extends Block {

    // Placeholder until the Boat Core gets real art.
    static TEXTURE = 'missing';

    // A pilot's walking keys only nudge the hull, and water drag settles it at a
    // slow rowing pace instead of a sprint.
    static STEER_THRUST = 0.012;
    static MAX_STEER_SPEED = 0.1;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Boat Core";
        this.shiftDescription = "Right click the core to steer the contraption with WASD, shift to exit";
        this.hardness = 1.5;
        this.sound = Block.sounds.stone;

        this.rotationType = Block.ROTATION_HORIZONTAL;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;

        this.isBoatCore = true;
    }

    getTextureForFace(face) {
        return BlockBoatCore.TEXTURE;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}
