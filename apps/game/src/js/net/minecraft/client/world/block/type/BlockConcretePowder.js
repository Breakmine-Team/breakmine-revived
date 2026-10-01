import { BlockRegistry } from "../BlockRegistry.js";
import BlockSand from "./BlockSand.js";

export default class BlockConcretePowder extends BlockSand {

    constructor(id, textureSlotId, textureName, name, concreteId) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.concreteId = concreteId;
        this.hardness = 0.4;
    }

    getTextureForFace(face) {
        return this.textureName;
    }

    onBlockPlaced(world, x, y, z, face) {
        if (this.touchesWater(world, x, y, z)) {
            this.harden(world, x, y, z);
        } else {
            world.scheduleBlockTick(x, y, z, 3);
        }
    }

    onBlockTick(world, x, y, z) {
        if (this.touchesWater(world, x, y, z)) {
            this.harden(world, x, y, z);
            return;
        }

        let below = world.getBlockAt(x, y - 1, z);
        if (below === BlockRegistry.WATER.id) {
            // Fall into the water and harden there
            world.setBlockAt(x, y, z, 0, 0);
            this.harden(world, x, y - 1, z);
            return;
        }

        if (!world.isSolidBlockAt(x, y - 1, z)) {
            let typeId = world.getBlockAt(x, y, z);
            let blockData = world.getBlockDataAt(x, y, z);

            world.setBlockAt(x, y, z, 0, 0);
            world.setBlockAt(x, y - 1, z, typeId, blockData);

            if (y - 1 > 0 && !world.isSolidBlockAt(x, y - 2, z)) {
                world.scheduleBlockTick(x, y - 1, z, 3);
            }
        }
    }

    onNeighborBlockChange(world, x, y, z) {
        if (this.touchesWater(world, x, y, z)) {
            this.harden(world, x, y, z);
        }
    }

    touchesWater(world, x, y, z) {
        const faces = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1]
        ];
        for (const [dx, dy, dz] of faces) {
            if (world.getBlockAt(x + dx, y + dy, z + dz) === BlockRegistry.WATER.id) {
                return true;
            }
        }
        return false;
    }

    harden(world, x, y, z) {
        world.setBlockAt(x, y, z, this.concreteId, 0);
    }
}
