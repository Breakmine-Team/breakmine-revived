import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";

export default class BlockLog extends Block {

    constructor(id, textureSlotId, woodType = "oak", displayName = "Oak Log") {
        super(id, textureSlotId);
        this.description = displayName;
        this.woodType = woodType;
        this.hardness = 2.0;

        this.sound = Block.sounds.wood;
    }
    
    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        if (face === 4 || face === 5) return 1;
        if (face === 2 || face === 3) return 2;
        return 0;
    }

    getPreferredToolType() {
        return 'axe';
    }

    getRotationForFace(face, data = 0) {
        if (data !== 1 && data !== 2) {
            return 0;
        }

        if (face.isYAxis()) {
            return data === 1 ? 1 : 0;
        }

        if (data === 1) {
            return face === EnumBlockFace.NORTH || face === EnumBlockFace.SOUTH ? 1 : 0;
        }

        return face === EnumBlockFace.EAST || face === EnumBlockFace.WEST ? 1 : 0;
    }

    getTextureForFace(face, data = 0) {
        if (face.isYAxis() && data === 0) {
            return `${this.woodType}_log_top`;
        }

        if (data === 0) {
            return `${this.woodType}_log`; 
        } else if (data === 1) {
            return face === EnumBlockFace.EAST || face === EnumBlockFace.WEST ? `${this.woodType}_log_top` : `${this.woodType}_log`;
        } else if (data === 2) {
            return face === EnumBlockFace.NORTH || face === EnumBlockFace.SOUTH ? `${this.woodType}_log_top` : `${this.woodType}_log`;
        } else {
            return `${this.woodType}_log`;
        }
    }
}
