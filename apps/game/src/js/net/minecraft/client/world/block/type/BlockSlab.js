import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";

export default class BlockSlab extends Block {

    constructor(id, textureSlotId, textureName, displayName, sound = null) {
        super(id, textureSlotId);
        this.textureName = textureName;
        this.description = displayName;
        this.hardness = 2.0;
        this.noFaceCull = true;
        if (sound) {
            this.sound = sound;
        }
    }

    isHalf() {
        return false;
    }

    isSolid() {
        return false;
    }

    getTextureForFace(face, data) {
        return this.textureName;
    }

    getBoundingBox(world, x, y, z) {
        let data = world ? world.getBlockDataAt(x, y, z) : 0;
        if (data & 1) {
            return new BoundingBox(0, 0.5, 0, 1, 1, 1);
        }
        return new BoundingBox(0, 0, 0, 1, 0.5, 1);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    onBlockPlaced(world, x, y, z, face) {
        let data = 0;
        if (face === EnumBlockFace.BOTTOM) {
            data = 1;
        }
        world.setBlockDataAt(x, y, z, data);
    }

    canCastAmbientOcclusion() {
        return true;
    }

    getAmbientOcclusion() {
        return false;
    }

    shouldRenderFace(world, x, y, z, face) {
        let data = world.getBlockDataAt(x, y, z);
        let isTop = (data & 1) === 1;

        if (isTop && face === EnumBlockFace.BOTTOM) return true;
        if (!isTop && face === EnumBlockFace.TOP) return true;

        let neighborId = world.getBlockAtFace(x, y, z, face);
        if (neighborId === 0) return true;

        let neighbor = Block.getById(neighborId);
        if (!neighbor) return true;

        return !(neighbor.isSolid() && !neighbor.isTranslucent() && !neighbor.noFaceCull && !neighbor.multipart && !neighbor.path);
    }
}
