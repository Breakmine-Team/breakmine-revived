import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";

export default class BlockLog extends Block {

    constructor(id, textureSlotId, woodType = "oak", displayName = "Oak Log") {
        super(id, textureSlotId);
        this.description = displayName;
        this.woodType = woodType;
        this.hardness = 2.0;

        // Sound
        this.sound = Block.sounds.wood;
    }
    
    getPreferredToolType() {
        return 'axe';
    }

    getTextureForFace(face, data = 0) {
        if (face.isYAxis() && data === 0) {
            return `${this.woodType}_log_top`;
        }

        // Determine rotation based on block data
        // 0 = upright (default), 1-3 = rotated on X/Z axis
        if (data === 0) {
            return `${this.woodType}_log`; // Upright
        } else if (data === 1) {
            // Rotated along X axis (east-west)
            return face === EnumBlockFace.EAST || face === EnumBlockFace.WEST ? `${this.woodType}_log_top` : `${this.woodType}_log`;
        } else if (data === 2) {
            // Rotated along Z axis (north-south)
            return face === EnumBlockFace.NORTH || face === EnumBlockFace.SOUTH ? `${this.woodType}_log_top` : `${this.woodType}_log`;
        } else {
            return `${this.woodType}_log`;
        }
    }
}
