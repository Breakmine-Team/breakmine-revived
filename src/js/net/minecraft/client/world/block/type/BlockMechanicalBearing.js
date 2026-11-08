import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import BearingDrive from "../BearingDrive.js";

/*
 * The bearing model.
 *
 * The shape is the supplied Bedrock geometry: a full-width housing from y 1 to
 * y 14, a two-pixel head plate closing the block at the top, and a one-pixel
 * frame around the bottom edge. The housing and the frame are bolted down; the
 * head plate is what the carried OGR turns, so it moves with it.
 *
 * A half shaft fills the bottom of the cell: that is the axle the drive comes
 * in on, and it turns with the head plate.
 *
 * Geometry is given in block pixels with y up and 0 at the floor of the cell,
 * the same convention the rest of the machine blocks use.
 */

const P = (pixels) => pixels / 16;

const BODY_TEXTURE = 'spruce_planks';
const HEAD_TEXTURE = 'spruce_planks';
const FRAME_TEXTURE = 'stone';
const SHAFT_TEXTURE = 'stone';

// Icon, break particles and any non-part rendering use the housing texture.
const TEXTURE = BODY_TEXTURE;

// [minX, minY, minZ, maxX, maxY, maxZ] in 1/16 pixels.
const BODY = [0, 1, 0, 16, 14, 16];
const HEAD = [0, 14, 0, 16, 16, 16];

// The bottom frame: two full-depth strips on the x edges, two between them.
const FRAME = [
    [15, 0, 0, 16, 1, 16],
    [0, 0, 0, 1, 1, 16],
    [1, 0, 0, 15, 1, 1],
    [1, 0, 15, 15, 1, 16]
];

function toBox(box) {
    const [x0, y0, z0, x1, y1, z1] = box;

    return {
        minX: P(x0), minY: P(y0), minZ: P(z0),
        maxX: P(x1), maxY: P(y1), maxZ: P(z1)
    };
}

function part(box, texture) {
    return ['texture', texture, {
        texture: texture,
        bbox: toBox(box)
    }];
}

/** The housing and the bottom frame: everything that stays still. */
function getCasingParts() {
    const parts = [part(BODY, BODY_TEXTURE)];

    for (const strip of FRAME) {
        parts.push(part(strip, FRAME_TEXTURE));
    }

    return parts;
}

/** The head plate the OGR rides on, and the input half shaft below it. */
function getHeadParts() {
    return [
        part(HEAD, HEAD_TEXTURE),
        ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, ShaftRenderer.AXIS.Y, {
            texture: SHAFT_TEXTURE,
            negative: true
        })
    ];
}

/**
 * A mechanical bearing: the block that turns a whole structure.
 *
 * The bearing sits on a vertical axle and carries whatever is built on top of
 * it. When a shaft, cog, gearbox, motor or water wheel drives it, the bearing
 * hands that structure to the off-grid renderer - the OGR - and turns it at the
 * bearing's own speed, around the bearing's own axle (see BearingDrive).
 *
 * Nothing is driven, nothing turns: a bearing with no power in its assembly
 * leaves its structure resting on it, and stopping the drive puts every block
 * back on the grid where it came from.
 */
export default class BlockMechanicalBearing extends BlockShaftPart {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Mechanical Bearing";
        this.shiftDescription = "Consumes 500 SU";
        this.hardness = 2.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // Read by ShaftDrive and BearingDrive to recognise the bearing.
        this.isMechanicalBearing = true;
    }

    /** The shape is the casing, the head plate and the input stub. */
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return TEXTURE;
    }

    getTextureForFace(face) {
        return TEXTURE;
    }

    /** The bearing always stands upright, whichever face it was placed on. */
    getPlacementMetadata() {
        return ShaftRenderer.AXIS.Y;
    }

    getAxis(data) {
        return ShaftRenderer.AXIS.Y;
    }

    getMultipart(world, x, y, z) {
        // A bearing the server placed arrives without the local placement
        // hooks, so the first tessellation is the first moment the client can
        // be sure it exists: register it for driving here.
        BearingDrive.register(world, x, y, z);

        return [...getCasingParts(), ...getHeadParts()];
    }

    /** The plate is bolted down: only the axle on top of it turns. */
    getStaticMultipart(world, x, y, z) {
        // A driven bearing is meshed from its static and rotating parts, so
        // getMultipart() never runs for it. Register here as well: a bearing
        // that arrived from a server or a save never runs the placement hooks,
        // and without this it is never ticked and never picks its load up.
        BearingDrive.register(world, x, y, z);

        return getCasingParts();
    }

    getRotatingMultipart(world, x, y, z) {
        return getHeadParts();
    }

    /**
     * The head plate turns with the OGR it carries, so it takes the field's own
     * angle rather than counting ticks from the RPM - the plate and the
     * structure on it stay locked together. With nothing carried the plate
     * still turns, showing the drive reaching the bare axle.
     */
    getRenderRotation(world, x, y, z, data, tick) {
        const field = world ? world.offGridField : null;
        const group = world ? BearingDrive.getGroup(world, x, y, z) : null;

        // Only the field this bearing actually filled carries its structure; a
        // field owned by another system must not turn the head plate.
        if (field && group !== null && group.field === field) {
            return {x: 0, y: field.rotation.y, z: 0};
        }

        return super.getRenderRotation(world, x, y, z, data, tick);
    }

    onBlockAdded(world, x, y, z) {
        super.onBlockAdded(world, x, y, z);
        BearingDrive.register(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        BearingDrive.unregister(world, x, y, z);
        BearingDrive.release(world, x, y, z);
        super.onBlockRemoved(world, x, y, z);
    }

    getPreferredToolType() {
        return 'axe';
    }
}
