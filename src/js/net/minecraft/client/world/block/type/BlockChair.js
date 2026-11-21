import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockChair extends Block {

    static SEAT = new BoundingBox(0, 7 / 16, 0, 1, 9 / 16, 1);

    static BACK = new BoundingBox(0, 9 / 16, 14 / 16, 1, 23 / 16, 1);

    static LEGS = [
        new BoundingBox(1 / 16, 0, 1 / 16, 3 / 16, 7 / 16, 3 / 16),
        new BoundingBox(13 / 16, 0, 1 / 16, 15 / 16, 7 / 16, 3 / 16),
        new BoundingBox(1 / 16, 0, 13 / 16, 3 / 16, 7 / 16, 15 / 16),
        new BoundingBox(13 / 16, 0, 13 / 16, 15 / 16, 7 / 16, 15 / 16)
    ];

    // Direction the backrest faces. The base model has its back on the south
    // (+z) side, then the whole shape turns a quarter per metadata value.
    static FACING_SOUTH = 0;
    static FACING_EAST = 1;
    static FACING_NORTH = 2;
    static FACING_WEST = 3;

    static rotateBox(box, steps) {
        let minX = box.minX;
        let maxX = box.maxX;
        let minZ = box.minZ;
        let maxZ = box.maxZ;

        for (let i = 0; i < ((steps % 4) + 4) % 4; i++) {
            const nextMinX = minZ;
            const nextMaxX = maxZ;
            const nextMinZ = 1 - maxX;
            const nextMaxZ = 1 - minX;
            minX = nextMinX;
            maxX = nextMaxX;
            minZ = nextMinZ;
            maxZ = nextMaxZ;
        }

        return new BoundingBox(minX, box.minY, minZ, maxX, box.maxY, maxZ);
    }

    constructor(id, textureSlotId, woodName, woodId, woodDisplayName) {
        super(id, textureSlotId);
        this.woodName = woodName;
        this.woodId = woodId;
        this.description = `${woodDisplayName} Chair`;
        this.hardness = 2;
        this.multipart = true;
        this.noFaceCull = true;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getPreferredToolType() {
        return 'axe';
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getAmbientOcclusion() {
        return true;
    }

    getTextureForFace(face) {
        return `${this.woodName}_planks`;
    }

    getFacing(world, x, y, z) {
        if (!world || typeof x !== "number") {
            return BlockChair.FACING_SOUTH;
        }
        return world.getBlockDataAt(x, y, z) & 3;
    }

    getBoxes(world, x, y, z) {
        const boxes = [BlockChair.SEAT, BlockChair.BACK, ...BlockChair.LEGS];
        const facing = this.getFacing(world, x, y, z);

        if (facing === BlockChair.FACING_SOUTH) {
            return boxes;
        }
        return boxes.map(box => BlockChair.rotateBox(box, facing));
    }

    getModel(world, x, y, z) {
        return this.getBoxes(world, x, y, z).map(box => ["block", this.woodId, box]);
    }

    getMultipart(world, x, y, z) {
        return this.getModel(world, x, y, z);
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return [
            BlockChair.FACING_SOUTH,
            BlockChair.FACING_WEST,
            BlockChair.FACING_NORTH,
            BlockChair.FACING_EAST
        ][dirIndex];
    }

    onBlockPlaced(world, x, y, z, face) {
        const player = world?.minecraft?.player;
        if (!player) {
            return;
        }
        world.setBlockDataAt(x, y, z, this.getPlacementMetadata(
            world, x, y, z, face, player.rotationYaw
        ));
    }

}
