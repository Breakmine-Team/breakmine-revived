import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";

/*
 * The wheel model.
 *
 * The shape comes from a MrCrayfish Model Creator file: eight tooth bars thirty
 * pixels long crossed at 0, 22.5, -22.5 and 45 degrees over a case of two 20px
 * plates (one of them rotated 45) and a 14px hub. The bars reach well past the
 * cell, which is what makes this the large wheel.
 *
 * The model is authored lying flat - the bars span x and z, the plates are two
 * pixels thick in y - which is ShaftRenderer's own frame with the axle on Y.
 * Boxes are therefore given as (u, v, w) with w along the axle and handed to
 * ShaftRenderer, so one definition stands the wheel up on X or Z when it is
 * placed against a side.
 *
 * Bars turn about the middle of the cell, the same point ShaftRenderer pivots
 * its cog teeth around, so the wheel can be spun as one piece.
 */

// Bars come from the model's Gear boxes, plates from its GearCase boxes.
const BARS = [
    // Along u (the model's north-south bars).
    {u: [-7, 23], v: [6.5, 9.5], w: [6.5, 9.5], angle: 0},
    {u: [-7, 23], v: [6.5, 9.5], w: [6.5, 9.5], angle: 22.5},
    {u: [-7, 23], v: [6.5, 9.5], w: [6.5, 9.5], angle: -22.5},
    {u: [-7, 23], v: [6.5, 9.5], w: [6.5, 9.5], angle: 45},

    // Along v (the model's east-west bars).
    {u: [6.5, 9.5], v: [-7, 23], w: [6.5, 9.5], angle: 0},
    {u: [6.5, 9.5], v: [-7, 23], w: [6.5, 9.5], angle: 22.5},
    {u: [6.5, 9.5], v: [-7, 23], w: [6.5, 9.5], angle: -22.5},
    {u: [6.5, 9.5], v: [-7, 23], w: [6.5, 9.5], angle: 45}
];

const PLATES = [
    // GearCaseInner and GearCaseInnerRotated: the wide plate, twice.
    {u: [-2, 18], v: [-2, 18], w: [7, 9], angle: 0},
    {u: [-2, 18], v: [-2, 18], w: [7, 9], angle: 45},

    // GearCaseOuter: the thicker hub the axle runs into.
    {u: [1, 15], v: [1, 15], w: [5.5, 10.5], angle: 0}
];

// The teeth are sawn planks; the case behind them stays log, and the axle
// through the middle is the same stone rod a shaft block is made of.
const BAR_TEXTURE = 'spruce_planks';
const PLATE_TEXTURE = 'spruce_planks';
const HUB_TEXTURE = 'spruce_planks';
const SHAFT_TEXTURE = 'stone';

// Icon, break particles and any non-part rendering use the bar texture.
const TEXTURE = BAR_TEXTURE;

const PIVOT = Object.freeze({x: 0.5, y: 0.5, z: 0.5});

/** One box, turned about the axle when its angle is not zero. */
function part(box, texture, axis) {
    const data = {
        texture: texture,
        bbox: ShaftRenderer.toBox(box, axis)
    };

    if (box.angle) {
        data.rotation = ShaftRenderer.getRotationForAxis(axis, box.angle);
        data.pivot = PIVOT;
    }

    return ['texture', texture, data];
}

/**
 * The whole wheel for one axle.
 *
 * @param {number} axis one of ShaftRenderer.AXIS
 */
function getParts(axis) {
    // A real stone shaft through the hub, on the wheel's own axle, so the cog
    // can be driven from either end like any other part.
    const parts = ShaftRenderer.getParts(ShaftRenderer.PART.SHAFT, axis, {
        texture: SHAFT_TEXTURE
    });

    for (const bar of BARS) {
        parts.push(part(bar, BAR_TEXTURE, axis));
    }

    for (const plate of PLATES) {
        const texture = plate.u[0] === 1 ? HUB_TEXTURE : PLATE_TEXTURE;
        parts.push(part(plate, texture, axis));
    }

    return parts;
}

/**
 * The large cog: a thirty-pixel spruce wheel with a plank hub, twice the span
 * of the plain cog so its teeth reach into the neighbouring cells.
 *
 * It is a shaft part like the small cog - it faces whoever placed it, meshes
 * with cogs (turning them the other way) and is turned by whatever assembly it
 * belongs to - but it draws the bigger model instead of the renderer's
 * built-in cog, so it is never drawn as a plain shaft part. Because the wheel
 * reaches the corners of its cell, only the cogs sitting on its diagonals are
 * in mesh with it; one sharing a side stays still (see ShaftDrive).
 */
export default class BlockLargeCog extends BlockShaftPart {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Large Cog";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // The wheel overhangs its cell into the neighbours' space.
        this.noFaceCull = true;

        // Read by ShaftDrive: this wheel only meshes with cogs on its diagonals.
        this.isLargeCog = true;
    }

    /** The whole shape is the wheel model; there are no plain shaft parts. */
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return TEXTURE;
    }

    /** Icon, break particles and any non-part rendering use the bar texture. */
    getTextureForFace(face) {
        return TEXTURE;
    }

    getMultipart(world, x, y, z) {
        const data = world && typeof world.getBlockDataAt === 'function'
            ? world.getBlockDataAt(x, y, z)
            : 0;

        return getParts(this.getAxis(data));
    }

    // Cogs mesh with neighbouring cogs and turn the other way.
    isCog() {
        return true;
    }

    /**
     * The wheel spans thirty pixels, so its teeth reach fifteen out: meshed with
     * the plain cog (9px) it turns at 3/5 of its speed, and the plain cog at
     * 5/3 of the wheel's.
     */
    getCogRadius() {
        return 15 / 16;
    }

    getPreferredToolType() {
        return 'axe';
    }
}
