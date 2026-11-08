import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";

/*
 * The motor model.
 *
 * The shape comes from a MrCrayfish model: a plinth, a body, a back plate, two
 * rims and the block between them, with the drive end at the front. The model
 * is authored with its drive end at +Z and is turned a quarter at a time so the
 * end points wherever the motor's output goes, including straight up or down.
 * The casing is purple concrete, with a white bottom plate and three white fins
 * around the body; the drive rod on the output side is a stone half-shaft, the
 * same rod a shaft block uses.
 */

const TEXTURE = 'purple_concrete';
const TRIM_TEXTURE = 'light_gray_concrete';
const ROD_TEXTURE = 'stone';

// Boxes in 1/16 pixels, [minX, minY, minZ, maxX, maxY, maxZ], drive end at max Z.
// The bottom plate and the three plate-like fins around the body are white.
const MOTOR_BOXES = [
    {box: [1, 0, 2, 15, 1, 10], texture: TRIM_TEXTURE},   // bottom plate
    {box: [4, 1, 2, 12, 4, 10]},                          // base top
    {box: [3, 3, 0, 13, 13, 2], texture: TRIM_TEXTURE},   // back plate (fin)
    {box: [3, 3, 10, 13, 13, 11], texture: TRIM_TEXTURE}, // back rim (fin)
    {box: [3, 3, 13, 13, 13, 14], texture: TRIM_TEXTURE}, // front rim (fin, drive end)
    {box: [5, 5, 11, 11, 11, 13]},                        // between the rims
    {box: [4, 4, 2, 12, 12, 10]}                          // body
];

const PIXEL = 1 / 16;

/**
 * How the model is turned for each facing, as face ids (0 bottom, 1 top,
 * 2 north, 3 south, 4 west, 5 east) - the same numbering placement uses.
 * `x` turns the model about X first, then `y` about Y.
 */
const ORIENTATIONS = {
    0: {x: 1, y: 0},   // drive end down
    1: {x: -1, y: 0},  // drive end up
    2: {x: 0, y: 2},   // north
    3: {x: 0, y: 0},   // south
    4: {x: 0, y: 3},   // west
    5: {x: 0, y: 1}    // east
};

/** Rotate a point about the middle of the cell: about X, then about Y. */
function turn(point, orientation) {
    let [x, y, z] = point;

    if (orientation.x !== 0) {
        const radians = orientation.x * Math.PI / 2;
        const cos = Math.round(Math.cos(radians));
        const sin = Math.round(Math.sin(radians));
        const dy = y - 0.5;
        const dz = z - 0.5;
        // Rotating about X sends +Z towards -Y for a positive quarter turn.
        y = 0.5 + dy * cos - dz * sin;
        z = 0.5 + dy * sin + dz * cos;
    }

    if (orientation.y !== 0) {
        const radians = orientation.y * Math.PI / 2;
        const cos = Math.round(Math.cos(radians));
        const sin = Math.round(Math.sin(radians));
        const dx = x - 0.5;
        const dz = z - 0.5;
        // Rotating about Y sends +Z towards +X for a positive quarter turn.
        x = 0.5 + dx * cos + dz * sin;
        z = 0.5 - dx * sin + dz * cos;
    }

    return [x, y, z];
}

/** Turn one box into the cell orientation, about the middle of the cell. */
function orientBox(box, orientation) {
    const [x0, y0, z0, x1, y1, z1] = box;

    if (orientation.x === 0 && orientation.y === 0) {
        return {
            minX: x0 * PIXEL, minY: y0 * PIXEL, minZ: z0 * PIXEL,
            maxX: x1 * PIXEL, maxY: y1 * PIXEL, maxZ: z1 * PIXEL
        };
    }

    const corners = [
        [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]
    ].map(([x, y, z]) => turn([x * PIXEL, y * PIXEL, z * PIXEL], orientation));

    const xs = corners.map((corner) => corner[0]);
    const ys = corners.map((corner) => corner[1]);
    const zs = corners.map((corner) => corner[2]);

    return {
        minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs),
        maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs)
    };
}

/**
 * Multipart entries for a motor whose drive end points along `facing`
 * (a face id, 0 bottom .. 5 east).
 */
function getParts(facing) {
    const orientation = ORIENTATIONS[(facing | 0) & 7] || ORIENTATIONS[3];

    return MOTOR_BOXES.map((entry) => {
        const texture = entry.texture || TEXTURE;

        return ['texture', texture, {
            texture: texture,
            bbox: orientBox(entry.box, orientation)
        }];
    });
}

/**
 * The half-shaft on the drive end, as ShaftRenderer parts so it is the same
 * rod a shaft block uses and can be turned on its own while the casing stays
 * still.
 */
function getRodParts(facing) {
    const face = (facing | 0) & 7;

    return ShaftRenderer.getParts(
        ShaftRenderer.PART.HALF_SHAFT,
        ShaftRenderer.getAxisFromFace(face),
        {
            texture: ROD_TEXTURE,
            negative: face === 0 || face === 2 || face === 4
        }
    );
}

// Output normal for each face id (0 bottom, 1 top, 2 north, 3 south, 4 west,
// 5 east), the numbering placement uses.
const OUTPUT_NORMALS = [
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
    [-1, 0, 0],
    [1, 0, 0]
];

// Player yaw index (0 south, 1 west, 2 north, 3 east) to the face the motor's
// drive end points at: it faces the player, the way a furnace or chest does.
const YAW_TO_FACE = [2, 5, 3, 4];

/**
 * A pink concrete motor. It turns whatever shaft or cog its drive end points
 * at, at 16 RPM, and that motion spreads through the assembly from there (see
 * ShaftDrive). With no motor in an assembly, its shafts and cogs stand still.
 *
 * The drive end faces the player who placed it (never the face that was
 * clicked), so you point it at whatever stands behind you as you place it.
 */
export default class BlockMotor extends Block {

    /** Revolutions per minute the motor turns its output at. */
    static RPM = 16;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Motor";
        this.shiftDescription = "Outputs 10,000 SU @ 16 RPM";
        this.hardness = 2.0;
        this.sound = Block.sounds.stone;
        this.multipart = true;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // Read by ShaftDrive to tell motors apart from the parts they turn.
        this.isShaftMotor = true;
    }

    // Like the shafts it drives, the motor keeps flat lighting and casts no
    // shading onto the blocks around it.
    getAmbientOcclusion() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    /** Facing is the face id of the drive end (0 bottom .. 5 east). */
    getFacing(data) {
        const facing = (data | 0) & 7;
        return facing <= 5 ? facing : 3;
    }

    /** Unit vector the drive end points along. */
    getOutputNormal(data) {
        return OUTPUT_NORMALS[this.getFacing(data)];
    }

    /** The axle a driven part must have to take this motor's output. */
    getOutputAxis(data) {
        return ShaftRenderer.getAxisFromFace(this.getFacing(data));
    }

    /** +1 or -1: which way the motor turns its output. */
    getOutputDirection(data) {
        return 1;
    }

    getOutputRpm(data) {
        return BlockMotor.RPM;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        // Only the player's yaw matters: the drive end faces them, whichever
        // face of a block the motor was clicked onto.
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return YAW_TO_FACE[dirIndex];
    }

    /** Icon, break particles and any non-part rendering use the model texture. */
    getTextureForFace(face) {
        return TEXTURE;
    }

    /** Full shape: the casing plus the half-shaft on the drive end. */
    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return [
            ...getParts(this.getFacing(data)),
            ...getRodParts(this.getFacing(data))
        ];
    }

    /** The casing is bolted down: it never turns. */
    getStaticMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return getParts(this.getFacing(data));
    }

    /** Only the drive rod turns, on the output axle through the middle. */
    getRotatingMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return getRodParts(this.getFacing(data));
    }

    /** The motor always runs, so its rod turns at 16 RPM all the time. */
    getRenderRotation(world, x, y, z, data, tick) {
        // Without a world this is the inventory icon, which must stay upright.
        if (!world) {
            return 0;
        }

        return ShaftRenderer.getRotationForAxis(
            this.getOutputAxis(data),
            ShaftRenderer.angleFor(BlockMotor.RPM, 1, tick)
        );
    }

    // The client places the block before the server sends its metadata back, so
    // the drive end is turned to face the local player straight away.
    onBlockPlaced(world, x, y, z, face) {
        const player = world && world.minecraft && world.minecraft.player;
        if (!player || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        world.setBlockDataAt(x, y, z, this.getPlacementMetadata(world, x, y, z, face, player.rotationYaw));
    }

    // A motor makes or breaks a driven assembly, so the parts around it have to
    // be re-classified: a still part gets a mesh of its own once it is driven.
    onBlockAdded(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}
