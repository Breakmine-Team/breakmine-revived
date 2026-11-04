/**
 * Renderer for the mechanical bearing.
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
 * the same convention the rest of the machine renderers use.
 */

import ShaftRenderer from "./ShaftRenderer.js";

const P = (pixels) => pixels / 16;

const BODY_TEXTURE = 'spruce_planks';
const HEAD_TEXTURE = 'spruce_planks';
const FRAME_TEXTURE = 'stone';
const SHAFT_TEXTURE = 'stone';

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

export default class BearingRenderer {

    static TEXTURE = BODY_TEXTURE;

    static toBox(box) {
        const [x0, y0, z0, x1, y1, z1] = box;

        return {
            minX: P(x0), minY: P(y0), minZ: P(z0),
            maxX: P(x1), maxY: P(y1), maxZ: P(z1)
        };
    }

    static part(box, texture) {
        return ['texture', texture, {
            texture: texture,
            bbox: BearingRenderer.toBox(box)
        }];
    }

    /** The housing and the bottom frame: everything that stays still. */
    static getCasingParts() {
        const parts = [BearingRenderer.part(BODY, BODY_TEXTURE)];

        for (const strip of FRAME) {
            parts.push(BearingRenderer.part(strip, FRAME_TEXTURE));
        }

        return parts;
    }

    /** The head plate the OGR rides on, and the input half shaft below it. */
    static getShaftParts() {
        return [
            BearingRenderer.part(HEAD, HEAD_TEXTURE),
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, ShaftRenderer.AXIS.Y, {
                texture: SHAFT_TEXTURE,
                negative: true
            })
        ];
    }
}
