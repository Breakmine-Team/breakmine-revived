/**
 * Renderer for the turntable.
 *
 * The shape comes from a Blockbench model: a short stub of axle under a wide,
 * flat gear case made of two thin plates, the upper one being the table itself.
 * The case is fourteen pixels across, so it sits just inside its cell.
 *
 * The whole block turns, axle and all, so a driven turntable visibly spins the
 * table, and whoever stands on it is carried round with it.
 */

const P = (pixels) => pixels / 16;

const AXLE_TEXTURE = 'spruce_log';
const CASE_TEXTURE = 'spruce_planks';
const TOP_TEXTURE = 'stone';

// [minX, minY, minZ, maxX, maxY, maxZ] in 1/16 pixels.
const AXLE = [6, 0, 6, 10, 7, 10];
const CASE_LOWER = [1, 3.9, 1, 15, 5.9, 15];
const CASE_UPPER = [1, 5.9, 1, 15, 7.9, 15];

export default class TurntableRenderer {

    static TEXTURE = CASE_TEXTURE;

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
            bbox: TurntableRenderer.toBox(box)
        }];
    }

    /** The axle stub, the lower gear case and the table on top. */
    static getParts() {
        return [
            TurntableRenderer.part(AXLE, AXLE_TEXTURE),
            TurntableRenderer.part(CASE_LOWER, CASE_TEXTURE),
            TurntableRenderer.part(CASE_UPPER, TOP_TEXTURE)
        ];
    }
}
