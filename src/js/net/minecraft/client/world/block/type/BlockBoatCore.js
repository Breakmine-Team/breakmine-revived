import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

// A Boat Core turns the contraption it is part of into a boat. The core can sit
// anywhere on the hull: once any cell of the body is in water the contraption
// floats, and a player who right clicks the core steers it with WASD. They do
// not have to stand on the hull to work the helm, the forward and back keys push
// the boat the way they are facing, and A and D turn the hull itself. A core
// with nobody at the helm does nothing, so an empty boat stays where it is
// instead of sailing off on its own.
export default class BlockBoatCore extends Block {

    static TEXTURE_FRONT = 'core_front';
    static TEXTURE_SIDE = 'core_side';

    // A pilot's walking keys only nudge the hull, and water drag settles it at a
    // slow rowing pace instead of a sprint.
    static STEER_THRUST = 0.012;
    static MAX_STEER_SPEED = 0.1;

    // Spin added to the hull per tick while A or D is held. Turning is slowed by
    // the same water drag as the rest of the body, so this settles at a steady
    // rate rather than winding up: about 35 degrees a second on a wet hull.
    static STEER_TURN = 0.01;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Boat Core";
        this.shiftDescription = "Right click the core to steer the contraption with WASD (A/D turns), shift to exit";
        this.hardness = 1.5;
        this.sound = Block.sounds.stone;

        this.rotationType = Block.ROTATION_HORIZONTAL;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;

        this.isBoatCore = true;
    }

    getTextureForFace(face, data = 0) {
        // Same metadata layout as the furnace: 2/3/4/5 is the facing and the
        // front of the core points the way it was placed.
        let facing = data & 7;
        if (facing < 2 || facing > 5) {
            facing = 2;
        }

        switch (face) {
            case EnumBlockFace.NORTH:
                return facing === 2 ? BlockBoatCore.TEXTURE_FRONT : BlockBoatCore.TEXTURE_SIDE;
            case EnumBlockFace.SOUTH:
                return facing === 3 ? BlockBoatCore.TEXTURE_FRONT : BlockBoatCore.TEXTURE_SIDE;
            case EnumBlockFace.WEST:
                return facing === 4 ? BlockBoatCore.TEXTURE_FRONT : BlockBoatCore.TEXTURE_SIDE;
            case EnumBlockFace.EAST:
                return facing === 5 ? BlockBoatCore.TEXTURE_FRONT : BlockBoatCore.TEXTURE_SIDE;
            default:
                return BlockBoatCore.TEXTURE_SIDE;
        }
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}
