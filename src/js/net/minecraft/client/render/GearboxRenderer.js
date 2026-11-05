/**
 * Renderer for the gearbox block.
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

export default class GearboxRenderer {

    static TEXTURE = TEXTURE;

    /** How many boxes the gearbox is drawn from. */
    static get BOX_COUNT() {
        return BOXES.length;
    }

    /**
     * Multipart entries for a gearbox.
     *
     * @param {boolean} vertical true for the rotated variant
     * @param {number} facing face id the plates should face (vertical only)
     */
    static getParts(vertical, facing) {
        const quarterX = vertical ? 1 : 0;
        const quarterY = vertical ? GearboxRenderer.getYawQuarters(facing) : 0;

        return BOXES.map((box, index) => ['texture', TEXTURE, {
            texture: TEXTURE,
            bbox: GearboxRenderer.orientBox(box, quarterX, quarterY),
            // Only the body has shafts leaving it, and which of its faces they
            // leave through depends on how the casing was placed.
            faces: index === BODY_INDEX ? GearboxRenderer.getEntranceFaces(vertical, facing) : null
        }]);
    }

    /** Names of the casing faces a shaft leaves through, for this variant. */
    static getEntranceFaces(vertical, facing) {
        if (vertical !== true) {
            return SIDE_FACES;
        }

        return (facing === 4 || facing === 5) ? UPRIGHT_Z_FACES : UPRIGHT_X_FACES;
    }

    /** Quarter turns about Y that put the vertical plates against the player. */
    static getYawQuarters(facing) {
        // Face ids 4 and 5 are west and east, so the look axis is X there.
        return (facing === 4 || facing === 5) ? 1 : 0;
    }

    /** Turn one box about the middle of the cell: about X, then about Y. */
    static orientBox(box, quarterX, quarterY) {
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
        ].map(([x, y, z]) => GearboxRenderer.turn([x * PIXEL, y * PIXEL, z * PIXEL], quarterX, quarterY));

        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        const zs = points.map((point) => point[2]);

        return {
            minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs),
            maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs)
        };
    }

    /** Rotate a point about the middle of the cell: about X, then about Y. */
    static turn(point, quarterX, quarterY) {
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
}
