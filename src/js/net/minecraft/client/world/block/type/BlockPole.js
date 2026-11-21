import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockPole extends Block {
    static PX = 1 / 16;
    static POLE_MIN = BlockPole.PX * 7;
    static POLE_MAX = BlockPole.PX * 9;
    static POLE_COLOR = 0x939393;
    static POLE_TEXTURE = "blank_white";

    // Metadata: the axis the pole runs along. Placing a pole on a side face
    // makes it horizontal, so poles can be run along a wall as well as
    // upright. Values 3 and up are unused and fall back to upright, which
    // keeps poles saved before horizontal placement existed as they were.
    static AXIS_Y = 0;
    static AXIS_X = 1;
    static AXIS_Z = 2;

    static CORE = new BoundingBox(BlockPole.POLE_MIN, 0, BlockPole.POLE_MIN, BlockPole.POLE_MAX, 1, BlockPole.POLE_MAX);
    static CORE_X = new BoundingBox(0, BlockPole.POLE_MIN, BlockPole.POLE_MIN, 1, BlockPole.POLE_MAX, BlockPole.POLE_MAX);
    static CORE_Z = new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MIN, 0, BlockPole.POLE_MAX, BlockPole.POLE_MAX, 1);

    static CORES = [BlockPole.CORE, BlockPole.CORE_X, BlockPole.CORE_Z];

    // Connectors towards neighbouring poles. A collinear pole already meets
    // this one through the cores, so arms only point at the four directions
    // perpendicular to the pole's own axis.
    static ARMS = [
        // Upright: arms reach out to the four sides at mid height.
        [
            { dx: -1, dy: 0, dz: 0, bbox: new BoundingBox(0, BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MAX) },
            { dx: 1, dy: 0, dz: 0, bbox: new BoundingBox(BlockPole.POLE_MAX, BlockPole.POLE_MIN, BlockPole.POLE_MIN, 1, BlockPole.POLE_MAX, BlockPole.POLE_MAX) },
            { dx: 0, dy: 0, dz: -1, bbox: new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MIN, 0, BlockPole.POLE_MAX, BlockPole.POLE_MAX, BlockPole.POLE_MIN) },
            { dx: 0, dy: 0, dz: 1, bbox: new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MAX, BlockPole.POLE_MAX, 1) }
        ],
        // East-west: arms reach north/south and up/down.
        [
            { dx: 0, dy: 0, dz: -1, bbox: new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MIN, 0, BlockPole.POLE_MAX, BlockPole.POLE_MAX, BlockPole.POLE_MIN) },
            { dx: 0, dy: 0, dz: 1, bbox: new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MAX, BlockPole.POLE_MAX, 1) },
            { dx: 0, dy: -1, dz: 0, bbox: new BoundingBox(BlockPole.POLE_MIN, 0, BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MIN, BlockPole.POLE_MAX) },
            { dx: 0, dy: 1, dz: 0, bbox: new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MIN, BlockPole.POLE_MAX, 1, BlockPole.POLE_MAX) }
        ],
        // North-south: arms reach east/west and up/down.
        [
            { dx: -1, dy: 0, dz: 0, bbox: new BoundingBox(0, BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MAX) },
            { dx: 1, dy: 0, dz: 0, bbox: new BoundingBox(BlockPole.POLE_MAX, BlockPole.POLE_MIN, BlockPole.POLE_MIN, 1, BlockPole.POLE_MAX, BlockPole.POLE_MAX) },
            { dx: 0, dy: -1, dz: 0, bbox: new BoundingBox(BlockPole.POLE_MIN, 0, BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MIN, BlockPole.POLE_MAX) },
            { dx: 0, dy: 1, dz: 0, bbox: new BoundingBox(BlockPole.POLE_MIN, BlockPole.POLE_MAX, BlockPole.POLE_MIN, BlockPole.POLE_MAX, 1, BlockPole.POLE_MAX) }
        ]
    ];

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

    /** Decode the pole axis out of a metadata value. */
    static getAxis(data) {
        const axis = (data || 0) & 3;
        return axis === BlockPole.AXIS_X || axis === BlockPole.AXIS_Z ? axis : BlockPole.AXIS_Y;
    }

    static coreForAxis(axis) {
        return BlockPole.CORES[axis] ?? BlockPole.CORE;
    }

    /** Blocks a pole runs into: other poles, and traffic lights mounted on poles. */
    static connectsTo(block) {
        return block !== null && block !== undefined
            && (block.isPole === true || block.isTrafficLight === true);
    }

    /**
     * Arms bridging this block's shaft to neighbouring poles and traffic lights.
     * Both sides draw an arm, so the two meet flush over the block boundary.
     */
    static getConnectionParts(world, x, y, z, axis = BlockPole.AXIS_Y) {
        const parts = [];
        if (!world || typeof x !== "number" || typeof world.getBlockAt !== "function") {
            return parts;
        }

        for (const { dx, dy, dz, bbox } of BlockPole.ARMS[axis]) {
            const neighbor = Block.getById(world.getBlockAt(x + dx, y + dy, z + dz));
            if (BlockPole.connectsTo(neighbor)) {
                parts.push(["blockClass", 0, { block: BlockPole.POLE_PART, bbox }]);
            }
        }

        return parts;
    }

    /**
     * Axis a pole gets when placed against `face`: on a side it runs along
     * that face's normal (sticking out of the wall), on top or bottom it
     * stands upright. `face` is either an EnumBlockFace or the numeric face
     * id used on the wire (0 bottom, 1 top, 2 north, 3 south, 4 west, 5 east).
     */
    static getFaceAxis(face) {
        if (face === null || face === undefined) {
            return null;
        }

        if (typeof face === "number") {
            if (face === 0 || face === 1) return BlockPole.AXIS_Y;
            if (face === 2 || face === 3) return BlockPole.AXIS_Z;
            if (face === 4 || face === 5) return BlockPole.AXIS_X;
            return null;
        }

        if (face.y !== 0) return BlockPole.AXIS_Y;
        if (face.x !== 0) return BlockPole.AXIS_X;
        if (face.z !== 0) return BlockPole.AXIS_Z;
        return null;
    }

    static refreshNeighbors(world, x, y, z) {
        if (!world || typeof world.onBlockChanged !== "function") {
            return;
        }

        for (const { dx, dy, dz } of BlockPole.NEIGHBORS) {
            world.onBlockChanged(x + dx, y + dy, z + dz);
        }
        world.onBlockChanged(x, y, z);
    }

    static NEIGHBORS = [
        { dx: -1, dy: 0, dz: 0 },
        { dx: 1, dy: 0, dz: 0 },
        { dx: 0, dy: 0, dz: -1 },
        { dx: 0, dy: 0, dz: 1 },
        { dx: 0, dy: -1, dz: 0 },
        { dx: 0, dy: 1, dz: 0 }
    ];

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

    _getAxis(world, x, y, z) {
        if (!world || typeof x !== "number" || typeof world.getBlockDataAt !== "function") {
            return BlockPole.AXIS_Y;
        }
        return BlockPole.getAxis(world.getBlockDataAt(x, y, z));
    }

    getPlacementMetadata(world, x, y, z, face) {
        return BlockPole.getFaceAxis(face) ?? BlockPole.AXIS_Y;
    }

    onBlockPlaced(world, x, y, z, face) {
        // The world reports a fresh block with a null face; only the real
        // placement carries the face the player clicked.
        if (!world || face === null || face === undefined) {
            return;
        }
        if (typeof world.setBlockDataAt !== "function" || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        world.setBlockDataAt(x, y, z, this.getPlacementMetadata(world, x, y, z, face));
        BlockPole.refreshNeighbors(world, x, y, z);
    }

    getBoundingBox(world, x, y, z) {
        return BlockPole.coreForAxis(this._getAxis(world, x, y, z));
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    getMultipart(world, x, y, z) {
        const axis = this._getAxis(world, x, y, z);
        return [
            ["blockClass", 0, { block: BlockPole.POLE_PART, bbox: BlockPole.coreForAxis(axis) }],
            ...BlockPole.getConnectionParts(world, x, y, z, axis)
        ];
    }

    onBlockAdded(world, x, y, z) {
        BlockPole.refreshNeighbors(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        BlockPole.refreshNeighbors(world, x, y, z);
    }
}
