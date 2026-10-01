import BoundingBox from "../../../../util/BoundingBox.js";
import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockTorch extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Torch";
        this.hardness = 0.0;

        this.boundingBox = new BoundingBox(0.4, 0.0, 0.4, 0.6, 0.6, 0.6);

        // Sound
        this.sound = Block.sounds.wood;

        // Create data faces
        this.dataFaces = [
            EnumBlockFace.WEST,
            EnumBlockFace.EAST,
            EnumBlockFace.NORTH,
            EnumBlockFace.SOUTH,
            EnumBlockFace.BOTTOM,
        ]
    }

    getTextureForFace(face) {
        return 'torch_on';
    }

    getLightValue() {
        return 14;
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    getRenderType() {
        return BlockRenderType.TORCH;
    }

    onBlockAdded(world, x, y, z) {
        for (let i = this.dataFaces.length - 1; i >= 0; i--) {
            let dataFace = this.dataFaces[i];

            if (world.isSolidBlockAt(x + dataFace.x, y + dataFace.y, z + dataFace.z)) {
                let data = i + 1;

                // Update block data in world
                world.setBlockDataAt(x, y, z, data);
                break;
            }
        }
    }

    onBlockPlaced(world, x, y, z, face) {
        let data = world.getBlockDataAt(x, y, z);

        for (let i in this.dataFaces) {
            let dataFace = this.dataFaces[i];

            if (face === dataFace.opposite() && world.isSolidBlockAt(x + dataFace.x, y + dataFace.y, z + dataFace.z)) {
                data = parseInt(i) + 1;
                break;
            }
        }

        // Update block data in chunk section directly to avoid notify
        world.getChunkSectionAt(x >> 4, y >> 4, z >> 4).setBlockDataAt(x & 15, y & 15, z & 15, data);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return null;
    }

    getBoundingBox(world, x, y, z) {
        this._updateBoundingBox(world, x, y, z);
        return this.boundingBox;
    }

    collisionRayTrace(world, x, y, z, start, end) {
        this._updateBoundingBox(world, x, y, z);
        return super.collisionRayTrace(world, x, y, z, start, end);
    }

    _updateBoundingBox(world, x, y, z) {
        let data = world.getBlockDataAt(x, y, z) & 7;

        switch (data) {
            case 1:
                this.boundingBox = new BoundingBox(0.0, 0.2, 0.35, 0.3, 0.8, 0.65);
                break;
            case 2:
                this.boundingBox = new BoundingBox(0.7, 0.2, 0.35, 1.0, 0.8, 0.65);
                break;
            case 3:
                this.boundingBox = new BoundingBox(0.35, 0.2, 0.0, 0.65, 0.8, 0.3);
                break;
            case 4:
                this.boundingBox = new BoundingBox(0.35, 0.2, 0.7, 0.65, 0.8, 1.0);
                break;
            default:
                this.boundingBox = new BoundingBox(0.4, 0.0, 0.4, 0.6, 0.6, 0.6);
                break;
        }
    }

    onBlockTick(world, x, y, z) {
        let data = world.getBlockDataAt(x, y, z) & 7;

        if (data >= 1 && data <= 5) {
            let dataFace = this.dataFaces[data - 1];

            // Check if supporting block is still solid
            if (!world.isSolidBlockAt(x + dataFace.x, y + dataFace.y, z + dataFace.z)) {
                // Break the torch
                world.setBlockAt(x, y, z, 0);
            }
        }
    }
}