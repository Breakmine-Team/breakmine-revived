import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockPole extends Block {
    static PX = 1 / 16;
    static POLE_MIN = BlockPole.PX * 7;
    static POLE_MAX = BlockPole.PX * 9;
    static POLE_COLOR = 0x939393;
    static POLE_TEXTURE = "blank_white";

    static CORE = new BoundingBox(BlockPole.POLE_MIN, 0, BlockPole.POLE_MIN, BlockPole.POLE_MAX, 1, BlockPole.POLE_MAX);
    static ARM_WEST = new BoundingBox(0, BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MAX);
    static ARM_EAST = new BoundingBox(BlockPole.POLE_MAX, BlockPole.POLE_MIN, BlockPole.POLE_MIN, 1, BlockPole.POLE_MAX, BlockPole.POLE_MAX);
    static ARM_NORTH = new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MIN, 0, BlockPole.POLE_MAX, BlockPole.POLE_MAX, BlockPole.POLE_MIN);
    static ARM_SOUTH = new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MAX, BlockPole.POLE_MAX, 1);

    static POLE_PART = {
        getTextureForFace() {
            return BlockPole.POLE_TEXTURE;
        },

        getRotationForFace() {
            return 0;
        },

        getColor() {
            return BlockPole.POLE_COLOR;
        },

        isTranslucent() {
            return false;
        },

        occludesNeighborFaces() {
            return false;
        }
    };

    static SIDES = [
        { dx: -1, dz: 0, bbox: BlockPole.ARM_WEST },
        { dx: 1, dz: 0, bbox: BlockPole.ARM_EAST },
        { dx: 0, dz: -1, bbox: BlockPole.ARM_NORTH },
        { dx: 0, dz: 1, bbox: BlockPole.ARM_SOUTH }
    ];

    static armBoundingBox(dx, dz) {
        if (dx === -1) return BlockPole.ARM_WEST;
        if (dx === 1) return BlockPole.ARM_EAST;
        if (dz === -1) return BlockPole.ARM_NORTH;
        return BlockPole.ARM_SOUTH;
    }

    static refreshNeighbors(world, x, y, z) {
        if (!world || typeof world.onBlockChanged !== "function") {
            return;
        }

        for (const { dx, dz } of BlockPole.SIDES) {
            world.onBlockChanged(x + dx, y, z + dz);
        }
        world.onBlockChanged(x, y - 1, z);
        world.onBlockChanged(x, y + 1, z);
    }

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Pole";
        this.hardness = 0.5;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;

        this.boundingBox = BlockPole.CORE;
        this.multipart = true;
        this.noFaceCull = true;
        this.isPole = true;
        this.setSelectionBoxFull = true;
    }

    getTextureForFace() {
        return BlockPole.POLE_TEXTURE;
    }

    getColor() {
        return BlockPole.POLE_COLOR;
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getOpacity() {
        return 0;
    }

    getMultipart(world, x, y, z) {
        const parts = [
            ["blockClass", 0, { block: BlockPole.POLE_PART, bbox: BlockPole.CORE }]
        ];

        if (world === null || world === undefined) {
            return parts;
        }

        for (const { dx, dz, bbox } of BlockPole.SIDES) {
            const neighbor = Block.getById(world.getBlockAt(x + dx, y, z + dz));
            if (neighbor === null || neighbor.isPole !== true) {
                continue;
            }
            parts.push(["blockClass", 0, { block: BlockPole.POLE_PART, bbox }]);
        }

        return parts;
    }

    onBlockAdded(world, x, y, z) {
        BlockPole.refreshNeighbors(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        BlockPole.refreshNeighbors(world, x, y, z);
    }
}