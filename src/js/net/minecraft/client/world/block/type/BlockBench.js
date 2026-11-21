import BoundingBox from "../../../../util/BoundingBox.js";
import BlockChair from "./BlockChair.js";

export default class BlockBench extends BlockChair {

    // Benches have a lower backrest than chairs so the two read differently.
    static BACK = new BoundingBox(0, 9 / 16, 14 / 16, 1, 1, 1);

    // World offset of the bench's local west/east end for each facing, so a
    // connected bench can drop the legs on the shared end.
    static LOCAL_SIDES = [
        { west: [-1, 0], east: [1, 0] },
        { west: [0, 1], east: [0, -1] },
        { west: [1, 0], east: [-1, 0] },
        { west: [0, -1], east: [0, 1] }
    ];

    constructor(id, textureSlotId, woodName, woodId, woodDisplayName) {
        super(id, textureSlotId, woodName, woodId, woodDisplayName);
        this.description = `${woodDisplayName} Bench`;
    }

    hasConnectedBench(world, x, y, z, [dx, dz], facing) {
        if (!world || typeof world.getBlockAt !== "function") {
            return false;
        }
        if (world.getBlockAt(x + dx, y, z + dz) !== this.id) {
            return false;
        }
        return (world.getBlockDataAt(x + dx, y, z + dz) & 3) === facing;
    }

    getBoxes(world, x, y, z) {
        const facing = this.getFacing(world, x, y, z);
        const sides = BlockBench.LOCAL_SIDES[facing];

        const connectedWest = this.hasConnectedBench(world, x, y, z, sides.west, facing);
        const connectedEast = this.hasConnectedBench(world, x, y, z, sides.east, facing);

        const boxes = [BlockChair.SEAT, BlockBench.BACK];
        for (const leg of BlockChair.LEGS) {
            const isWest = leg.maxX <= 0.5;
            if (isWest ? connectedWest : connectedEast) {
                continue;
            }
            boxes.push(leg);
        }

        if (facing === BlockChair.FACING_SOUTH) {
            return boxes;
        }
        return boxes.map(box => BlockChair.rotateBox(box, facing));
    }

    static refreshNeighbors(world, x, y, z) {
        if (!world || typeof world.onBlockChanged !== "function") {
            return;
        }
        world.onBlockChanged(x - 1, y, z);
        world.onBlockChanged(x + 1, y, z);
        world.onBlockChanged(x, y, z - 1);
        world.onBlockChanged(x, y, z + 1);
    }

    onBlockAdded(world, x, y, z) {
        BlockBench.refreshNeighbors(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        BlockBench.refreshNeighbors(world, x, y, z);
    }

}
