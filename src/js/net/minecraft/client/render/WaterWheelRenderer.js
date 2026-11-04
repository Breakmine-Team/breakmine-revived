/**
 * Renderer for the large water wheel.
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

import ShaftRenderer from "./ShaftRenderer.js";

const P = (pixels) => pixels / 16;

// The wheel turns about the middle of its cell, which is also its axle.
const PIVOT = Object.freeze({x: 0.5, y: 0.5, z: 0.5});

const LOG_TEXTURE = 'spruce_log';
// The hub is the same stone rod a shaft block is made of.
const SHAFT_TEXTURE = 'stone';
const PLANK_TEXTURE = 'spruce_planks';

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

export default class WaterWheelRenderer {

    static TEXTURE = PLANK_TEXTURE;

    /**
     * Stand a pixel box up: a quarter turn about X around the middle of the
     * cell, which sends (x, y, z) to (x, 1 - z, y). A quarter turn keeps boxes
     * axis aligned, so the two corners can be swapped directly.
     */
    static toBox(box) {
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
    static part(box, texture, yaw = 0) {
        const data = {
            texture: texture,
            bbox: WaterWheelRenderer.toBox(box)
        };

        if (yaw !== 0) {
            data.rotation = {x: 0, y: 0, z: yaw};
            data.pivot = PIVOT;
        }

        return ['texture', texture, data];
    }

    /** The full wheel: shaft, spokes, planks and braces. */
    static getParts() {
        const parts = [
            // A real shaft through the hub, on the wheel's own axle.
            ...ShaftRenderer.getParts(ShaftRenderer.PART.SHAFT, ShaftRenderer.AXIS.Z, {
                texture: SHAFT_TEXTURE
            }),
        ];

        for (const spoke of SPOKES) {
            for (const yaw of YAW_STEPS) {
                parts.push(WaterWheelRenderer.part(spoke, LOG_TEXTURE, yaw));
            }
        }

        for (const plank of INNER_PLANKS) {
            parts.push(WaterWheelRenderer.part(plank.box, PLANK_TEXTURE, plank.yaw));
        }

        for (const connector of CONNECTORS) {
            parts.push(WaterWheelRenderer.part(connector.box, LOG_TEXTURE, connector.yaw));
        }

        return parts;
    }
}
