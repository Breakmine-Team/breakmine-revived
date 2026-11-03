/**
 * Renderer for the motor block.
 *
 * The shape comes from a MrCrayfish model: a plinth, a body, a back plate, two
 * rims and the block between them, with the drive end at the front. The model
 * is authored with its drive end at +Z and is turned a quarter at a time so the
 * end points wherever the motor's output goes, including straight up or down.
 * The casing is purple concrete, with a white bottom plate and three white fins
 * around the body; the drive rod on the output side is a stone half-shaft, the
 * same rod a shaft block uses.
 */

import ShaftRenderer from "./ShaftRenderer.js";

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

export default class MotorRenderer {

    static TEXTURE = TEXTURE;

    /**
     * Multipart entries for a motor whose drive end points along `facing`
     * (a face id, 0 bottom .. 5 east).
     */
    static getParts(facing) {
        const orientation = ORIENTATIONS[(facing | 0) & 7] || ORIENTATIONS[3];

        return MOTOR_BOXES.map((entry) => {
            const texture = entry.texture || TEXTURE;

            return ['texture', texture, {
                texture: texture,
                bbox: MotorRenderer.orientBox(entry.box, orientation)
            }];
        });
    }

    /**
     * The half-shaft on the drive end, as ShaftRenderer parts so it is the same
     * rod a shaft block uses and can be turned on its own while the casing
     * stays still.
     */
    static getRodParts(facing) {
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

    /** Turn one box into the cell orientation, about the middle of the cell. */
    static orientBox(box, orientation) {
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
        ].map(([x, y, z]) => {
            const point = MotorRenderer.turn([x * PIXEL, y * PIXEL, z * PIXEL], orientation);
            return point;
        });

        const xs = corners.map((corner) => corner[0]);
        const ys = corners.map((corner) => corner[1]);
        const zs = corners.map((corner) => corner[2]);

        return {
            minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs),
            maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs)
        };
    }

    /** Rotate a point about the middle of the cell: about X, then about Y. */
    static turn(point, orientation) {
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
}
