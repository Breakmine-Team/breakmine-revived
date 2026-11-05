import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import GearboxRenderer from "../../../render/GearboxRenderer.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";

// Player yaw index (0 south, 1 west, 2 north, 3 east) to the face the casing
// points at: the gearbox faces the player, the way a furnace or chest does.
const YAW_TO_FACE = [2, 5, 3, 4];

// Axle stubs are the same stone rod a shaft block is made of.
const AXLE_TEXTURE = 'stone';

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
        return GearboxRenderer.TEXTURE;
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
        return GearboxRenderer.getParts(this.vertical, this.getFacing(data));
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
