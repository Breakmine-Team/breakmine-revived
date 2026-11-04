/**
 * Renderer for the large cog.
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

import ShaftRenderer from "./ShaftRenderer.js";

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
const PLATE_TEXTURE = 'spruce_log';
const HUB_TEXTURE = 'spruce_planks';
const SHAFT_TEXTURE = 'stone';

const PIVOT = Object.freeze({x: 0.5, y: 0.5, z: 0.5});

export default class LargeCogRenderer {

    static TEXTURE = BAR_TEXTURE;

    /** One box, turned about the axle when its angle is not zero. */
    static part(box, texture, axis) {
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
    static getParts(axis) {
        // A real stone shaft through the hub, on the wheel's own axle, so the
        // cog can be driven from either end like any other part.
        const parts = ShaftRenderer.getParts(ShaftRenderer.PART.SHAFT, axis, {
            texture: SHAFT_TEXTURE
        });

        for (const bar of BARS) {
            parts.push(LargeCogRenderer.part(bar, BAR_TEXTURE, axis));
        }

        for (const plate of PLATES) {
            const texture = plate.u[0] === 1 ? HUB_TEXTURE : PLATE_TEXTURE;
            parts.push(LargeCogRenderer.part(plate, texture, axis));
        }

        return parts;
    }
}
