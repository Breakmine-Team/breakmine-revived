import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockCctvCamera extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "CCTV Camera";
        this.hardness = 0.5;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return dirIndex << 1;
    }

    onBlockPlaced(world, x, y, z, face) {
        const player = world.minecraft?.player;
        if (!player) return;

        const dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
        world.setBlockDataAt(x, y, z, dirIndex << 1);
    }

    _getDirectionFaces(data) {
        const direction = (data >> 1) & 3;

        switch (direction) {
            case 1:
                return { front: [-1, 0, 0], frontFace: EnumBlockFace.WEST };
            case 2:
                return { front: [0, 0, -1], frontFace: EnumBlockFace.NORTH };
            case 3:
                return { front: [1, 0, 0], frontFace: EnumBlockFace.EAST };
            case 0:
            default:
                return { front: [0, 0, 1], frontFace: EnumBlockFace.SOUTH };
        }
    }

    getTextureForFace(face, data, x, y, z, world) {
        if (face === EnumBlockFace.TOP || face === EnumBlockFace.BOTTOM) {
            return 'observer_top';
        }

        const { frontFace } = this._getDirectionFaces(data);
        if (face === frontFace) {
            return 'observer_front';
        }

        return 'observer_side';
    }
}
