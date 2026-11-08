import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";

/*
 * The gearbox model.
 *
 * The shape comes from a MrCrayfish model: a 14x12x14 body clamped between two
 * 16x2x16 spruce plates, one on the floor and one on the ceiling of the cell.
 * It is spruce to match the cog, and its axle stubs are cut from the same wood.
 *
 * The vertical variant is the same sandwich turned a quarter about X, which
 * puts the plates on the front and back instead of the floor and ceiling, and
 * then turned about Y so those plates face the player who placed it.
 */

// Boxes in 1/16 pixels as [minX, minY, minZ, maxX, maxY, maxZ]. The model is
// authored around the middle of the cell (x and z from -8 to 8), so the +8
// offset is already applied.
const BOXES = [
    [1, 2, 1, 15, 14, 15],    // body
    [0, 14, 0, 16, 16, 16],   // top plate
    [0, 0, 0, 16, 2, 16]      // bottom plate
];

const TEXTURE = 'spruce_planks';

// Faces a shaft leaves the casing through wear the shaft entrance plate
// instead of bare planks. The plates stay spruce.
const SHAFT_ENTRANCE_TEXTURE = 'shaft_enterance';

// Flat gearbox: its own axle and the crossed one leave through the four sides.
const SIDE_FACES = {
    north: SHAFT_ENTRANCE_TEXTURE,
    south: SHAFT_ENTRANCE_TEXTURE,
    east: SHAFT_ENTRANCE_TEXTURE,
    west: SHAFT_ENTRANCE_TEXTURE
};

// Vertical gearbox: the horizontal axle leaves through the pair of sides that
// is still open, and the upright axle through the top and the bottom.
const UPRIGHT_X_FACES = {
    east: SHAFT_ENTRANCE_TEXTURE,
    west: SHAFT_ENTRANCE_TEXTURE,
    top: SHAFT_ENTRANCE_TEXTURE,
    bottom: SHAFT_ENTRANCE_TEXTURE
};

const UPRIGHT_Z_FACES = {
    north: SHAFT_ENTRANCE_TEXTURE,
    south: SHAFT_ENTRANCE_TEXTURE,
    top: SHAFT_ENTRANCE_TEXTURE,
    bottom: SHAFT_ENTRANCE_TEXTURE
};

const BODY_INDEX = 0;

const PIXEL = 1 / 16;
const CENTRE = 0.5;

// Player yaw index (0 south, 1 west, 2 north, 3 east) to the face the casing
// points at: the gearbox faces the player, the way a furnace or chest does.
const YAW_TO_FACE = [2, 5, 3, 4];

// Axle stubs are the same stone rod a shaft block is made of.
const AXLE_TEXTURE = 'stone';

/** Names of the casing faces a shaft leaves through, for this variant. */
function getEntranceFaces(vertical, facing) {
    if (vertical !== true) {
        return SIDE_FACES;
    }

    return (facing === 4 || facing === 5) ? UPRIGHT_Z_FACES : UPRIGHT_X_FACES;
}

/** Quarter turns about Y that put the vertical plates against the player. */
function getYawQuarters(facing) {
    // Face ids 4 and 5 are west and east, so the look axis is X there.
    return (facing === 4 || facing === 5) ? 1 : 0;
}

/** Rotate a point about the middle of the cell: about X, then about Y. */
function turn(point, quarterX, quarterY) {
    let [x, y, z] = point;

    if (quarterX !== 0) {
        const radians = quarterX * Math.PI / 2;
        const cos = Math.round(Math.cos(radians));
        const sin = Math.round(Math.sin(radians));
        const dy = y - CENTRE;
        const dz = z - CENTRE;
        // A positive quarter about X sends +Y towards +Z.
        y = CENTRE + dy * cos - dz * sin;
        z = CENTRE + dy * sin + dz * cos;
    }

    if (quarterY !== 0) {
        const radians = quarterY * Math.PI / 2;
        const cos = Math.round(Math.cos(radians));
        const sin = Math.round(Math.sin(radians));
        const dx = x - CENTRE;
        const dz = z - CENTRE;
        // A positive quarter about Y sends +Z towards +X.
        x = CENTRE + dx * cos + dz * sin;
        z = CENTRE - dx * sin + dz * cos;
    }

    return [x, y, z];
}

/** Turn one box about the middle of the cell: about X, then about Y. */
function orientBox(box, quarterX, quarterY) {
    const [x0, y0, z0, x1, y1, z1] = box;

    if (quarterX === 0 && quarterY === 0) {
        return {
            minX: x0 * PIXEL, minY: y0 * PIXEL, minZ: z0 * PIXEL,
            maxX: x1 * PIXEL, maxY: y1 * PIXEL, maxZ: z1 * PIXEL
        };
    }

    const points = [
        [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]
    ].map(([x, y, z]) => turn([x * PIXEL, y * PIXEL, z * PIXEL], quarterX, quarterY));

    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const zs = points.map((point) => point[2]);

    return {
        minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs),
        maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs)
    };
}

/**
 * Multipart entries for a gearbox casing.
 *
 * @param {boolean} vertical true for the rotated variant
 * @param {number} facing face id the plates should face (vertical only)
 */
function getCasingParts(vertical, facing) {
    const quarterX = vertical ? 1 : 0;
    const quarterY = vertical ? getYawQuarters(facing) : 0;

    return BOXES.map((box, index) => ['texture', TEXTURE, {
        texture: TEXTURE,
        bbox: orientBox(box, quarterX, quarterY),
        // Only the body has shafts leaving it, and which of its faces they
        // leave through depends on how the casing was placed.
        faces: index === BODY_INDEX ? getEntranceFaces(vertical, facing) : null
    }]);
}

/**
 * A spruce gearbox: a casing clamped between two plates, with stone axle stubs
 * leaving its open sides.
 *
 * It is a shaft part, so rotation passes through it, and its two axles meet at
 * right angles like bevel gears, so the second one turns the other way:
 *
 *  - the flat gearbox lies with its plates against the floor and ceiling. Its
 *    own axle runs the way the player was looking, out through both ends, and a
 *    crossed axle runs out through the two sides, driven in reverse.
 *  - the vertical gearbox stands with its plates facing the player. Its
 *    horizontal axle therefore leaves across those plates, out through the two
 *    open sides, and its second axle stands up out of the top and the bottom,
 *    in reverse.
 *
 * Only the axle stubs turn; the casing stays bolted down.
 */
export default class BlockGearbox extends BlockShaftPart {

    constructor(id, textureSlotId, vertical = false) {
        super(id, textureSlotId);
        this.vertical = vertical === true;
        this.description = this.vertical ? "Vertical Gearbox" : "Gearbox";
        this.shiftDescription = "Tranfers rotation on 2 axes";
        this.hardness = 2.0;

        // The plates fill the cell footprint, so neighbours must not cull their
        // boundary faces and leave a seam.
        this.noFaceCull = true;

        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // Read by ShaftDrive: this block also takes and gives rotation on the
        // axle crossed with its own.
        this.isGearbox = true;
    }

    /** Facing is the face id the casing looks at (2 north .. 5 east). */
    getFacing(data) {
        const facing = (data | 0) & 7;
        return facing >= 2 && facing <= 5 ? facing : 3;
    }

    /** The horizontal axis the casing's flat plates face along. */
    getFacingAxis(data) {
        return ShaftRenderer.getAxisFromFace(this.getFacing(data));
    }

    /**
     * The axle. A flat gearbox runs along the way it faces, plates above and
     * below. A vertical one has those plates on its front and back, so its
     * horizontal axle leaves through the open sides, across the plates.
     */
    getAxis(data) {
        const facingAxis = this.getFacingAxis(data);
        if (this.vertical !== true) {
            return facingAxis;
        }

        return facingAxis === ShaftRenderer.AXIS.Z ? ShaftRenderer.AXIS.X : ShaftRenderer.AXIS.Z;
    }

    /** The other horizontal axle: the pair that meets it at right angles. */
    getCrossAxis(data) {
        return this.getAxis(data) === ShaftRenderer.AXIS.Z
            ? ShaftRenderer.AXIS.X
            : ShaftRenderer.AXIS.Z;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return YAW_TO_FACE[dirIndex];
    }

    /** Icon, break particles and any non-part rendering use the casing texture. */
    getTextureForFace(face) {
        return TEXTURE;
    }

    /** The casing comes from the gearbox model, not from shaft parts. */
    getShaftParts() {
        return [];
    }

    /** Two half-shaft stubs along `axis`, one out of each side. */
    getAxleParts(axis) {
        return [
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, axis, {texture: AXLE_TEXTURE, negative: true}),
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, axis, {texture: AXLE_TEXTURE})
        ];
    }

    /** The upright axle: one stub out of the top and one out of the bottom. */
    getVerticalAxleParts() {
        return [
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, ShaftRenderer.AXIS.Y, {texture: AXLE_TEXTURE, negative: true}),
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, ShaftRenderer.AXIS.Y, {texture: AXLE_TEXTURE})
        ];
    }

    /** What turns: the horizontal pair, plus either the crossed pair or the upright axle. */
    getMovingParts(data) {
        if (this.vertical === true) {
            return [...this.getAxleParts(this.getAxis(data)), ...this.getVerticalAxleParts()];
        }

        return [
            ...this.getAxleParts(this.getAxis(data)),
            ...this.getAxleParts(this.getCrossAxis(data))
        ];
    }

    getCasingParts(data) {
        return getCasingParts(this.vertical, this.getFacing(data));
    }

    /** Full shape: the casing plus its axle stubs. */
    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;

        return [...this.getCasingParts(data), ...this.getMovingParts(data)];
    }

    /** The casing stays still while the axles turn. */
    getStaticMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return this.getCasingParts(data);
    }

    /** Every stub turns, but the second axle turns its own way. */
    getRotatingMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return this.getMovingParts(data);
    }

    /**
     * The two axles become separate meshes: they turn about different axes, and
     * the second one the other way round - the crossed pair on a flat gearbox,
     * the upright shaft on a vertical one.
     */
    getRotatingGroups(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const axis = this.getAxis(data);

        if (this.vertical === true) {
            return [
                {parts: this.getAxleParts(axis), axis: axis, sign: 1},
                {parts: this.getVerticalAxleParts(), axis: ShaftRenderer.AXIS.Y, sign: -1}
            ];
        }

        const crossAxis = this.getCrossAxis(data);
        return [
            {parts: this.getAxleParts(axis), axis: axis, sign: 1},
            {parts: this.getAxleParts(crossAxis), axis: crossAxis, sign: -1}
        ];
    }

    /** Rotation for one axle pair, from whatever is driving the gearbox. */
    getGroupRotation(index, world, x, y, z, tick) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const groups = this.getRotatingGroups(world, x, y, z);
        const group = groups[Math.min(Math.max(index | 0, 0), groups.length - 1)];
        const drive = this.getDrive(world, x, y, z, tick);

        return ShaftRenderer.getRotationForAxis(
            group.axis,
            ShaftRenderer.angleFor(drive.rpm, drive.direction * group.sign, tick)
        );
    }

    getPreferredToolType() {
        return 'axe';
    }
}
