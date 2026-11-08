import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";

/*
 * The wheel model.
 *
 * The shape comes from a Blockbench model: a vertical axle, eight spokes in a
 * cross, inner planks bridging the axle to the rim, and four braced
 * connectors. The model is authored lying flat, so every box is stood up here:
 * a quarter turn about X around the middle of the cell puts the wheel in the
 * vertical plane and its axle on Z, which is how a water wheel hangs.
 *
 * Spokes and braces are one box copied round at -22.5, 0, 22.5 and 45 degrees.
 * In the flat model those are turns about Y; after standing the wheel up the
 * same turns are about the axle, Z.
 */

const P = (pixels) => pixels / 16;

// The wheel turns about the middle of its cell, which is also its axle.
const PIVOT = Object.freeze({x: 0.5, y: 0.5, z: 0.5});

const LOG_TEXTURE = 'spruce_log';
// The hub is the same stone rod a shaft block is made of.
const SHAFT_TEXTURE = 'stone';
const PLANK_TEXTURE = 'spruce_planks';

// Icon, break particles and any non-part rendering use the plank texture.
const TEXTURE = PLANK_TEXTURE;

// One spoke of each pair of opposite arms, plus the yaws that copy it round.
const SPOKES = [
    [13, -1, -8, 14, 17, 0],
    [2, -1, 16, 3, 17, 24],
    [-8, -1, 2, 0, 17, 3],
    [16, -1, 13, 24, 17, 14]
];

// Inner planks: two per quarter on the x sides, two on the z sides.
const INNER_PLANKS = [
    {box: [-2, -0.6, 4, 0, 16.6, 12], yaw: 45},
    {box: [-2, -0.6, 4, 0, 16.6, 12], yaw: 0},
    {box: [-2, -0.6, 4, 0, 16.6, 12], yaw: -45},
    {box: [16, -0.6, 4, 18, 16.6, 12], yaw: 45},
    {box: [16, -0.6, 4, 18, 16.6, 12], yaw: 0},
    {box: [16, -0.6, 4, 18, 16.6, 12], yaw: -45},
    {box: [4, -0.6, -2, 12, 16.6, 0], yaw: 0},
    {box: [4, -0.6, 15.9, 12, 16.6, 18], yaw: 0}
];

const CONNECTORS = [
    {box: [6.5, 2, -1, 9.5, 14, 17], yaw: 22.5},
    {box: [6.5, 2, -1, 9.5, 14, 17], yaw: -22.5},
    {box: [-1, 2, 6.5, 17, 14, 9.5], yaw: 22.5},
    {box: [-1, 2, 6.5, 17, 14, 9.5], yaw: -22.5}
];

const YAW_STEPS = Object.freeze([-22.5, 0, 22.5, 45]);

/**
 * Stand a pixel box up: a quarter turn about X around the middle of the cell,
 * which sends (x, y, z) to (x, 1 - z, y). A quarter turn keeps boxes axis
 * aligned, so the two corners can be swapped directly.
 */
function toBox(box) {
    const [x0, y0, z0, x1, y1, z1] = box;

    return {
        minX: P(x0),
        maxX: P(x1),
        minY: 1 - P(z1),
        maxY: 1 - P(z0),
        minZ: P(y0),
        maxZ: P(y1)
    };
}

/** One multipart entry, turned about the axle when `yaw` is not zero. */
function part(box, texture, yaw = 0) {
    const data = {
        texture: texture,
        bbox: toBox(box)
    };

    if (yaw !== 0) {
        data.rotation = {x: 0, y: 0, z: yaw};
        data.pivot = PIVOT;
    }

    return ['texture', texture, data];
}

/** The full wheel: shaft, spokes, planks and braces. */
function getParts() {
    const parts = [
        // A real shaft through the hub, on the wheel's own axle.
        ...ShaftRenderer.getParts(ShaftRenderer.PART.SHAFT, ShaftRenderer.AXIS.Z, {
            texture: SHAFT_TEXTURE
        })
    ];

    for (const spoke of SPOKES) {
        for (const yaw of YAW_STEPS) {
            parts.push(part(spoke, LOG_TEXTURE, yaw));
        }
    }

    for (const plank of INNER_PLANKS) {
        parts.push(part(plank.box, PLANK_TEXTURE, plank.yaw));
    }

    for (const connector of CONNECTORS) {
        parts.push(part(connector.box, LOG_TEXTURE, connector.yaw));
    }

    return parts;
}

/**
 * The large spruce water wheel: an upright two-block wheel on a horizontal
 * axle, driven by water.
 *
 * Water touching the wheel turns it, and the wheel turns whatever shares its
 * axle, so it is a power source as well as a part (see ShaftDrive.findDriver).
 * A motor or a shaft run can also turn it when it stands in no water.
 */
export default class BlockWaterWheel extends BlockShaftPart {

    /** Revolutions per minute water turns the wheel at. */
    static RPM = 8;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Water Wheel";
        this.shiftDescription = "Outputs 900 SU @ 8 RPM";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // The wheel overhangs its cell into the neighbours' space.
        this.noFaceCull = true;

        // Read by ShaftDrive: this block can supply power on its own.
        this.isWaterWheel = true;
    }

    /** The whole shape is the wheel model; there are no plain shaft parts. */
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return TEXTURE;
    }

    /** Icon, break particles and any non-part rendering use the plank texture. */
    getTextureForFace(face) {
        return TEXTURE;
    }

    getMultipart(world, x, y, z) {
        return getParts();
    }

    /**
     * The wheel always stands upright with its axle running north to south,
     * whichever face it was placed against and whichever way the player looked.
     */
    getPlacementMetadata() {
        return ShaftRenderer.AXIS.Z;
    }

    getAxis(data) {
        return ShaftRenderer.AXIS.Z;
    }

    /** True for the water block, without importing the registry (cycles). */
    static isWaterBlock(block) {
        if (!block) {
            return false;
        }
        if (block.isWater === true || block.liquidType === 'water') {
            return true;
        }

        // BlockWater identifies itself as 'water' once registered.
        const name = `${block.identifier || ''} ${block.name || ''} ${block.description || ''}`;
        return /\bwater\b/i.test(name) && block.isShaftPart !== true;
    }

    /** True when water touches the wheel on any side. */
    hasWater(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== 'function') {
            return false;
        }

        for (const step of ShaftDrive.NEIGHBOURS) {
            const typeId = world.getBlockAt(
                x + step.delta[0],
                y + step.delta[1],
                z + step.delta[2]
            );
            if (!typeId) {
                continue;
            }
            if (BlockWaterWheel.isWaterBlock(Block.getById(typeId))) {
                return true;
            }
        }

        return false;
    }

    /** What the water turns the wheel at, or null when it is dry. */
    getWaterDrive(world, x, y, z) {
        if (!this.hasWater(world, x, y, z)) {
            return null;
        }

        return {rpm: BlockWaterWheel.RPM, direction: 1};
    }

    getPreferredToolType() {
        return 'axe';
    }
}
