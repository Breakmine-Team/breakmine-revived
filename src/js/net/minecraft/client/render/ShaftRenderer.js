/**
 * Renderer for shaft-style machine parts: shafts, half-shafts and cogs.
 *
 * A block does not draw these itself. It lists the parts it wants
 * (see BlockShaftPart.getShaftParts) and this class turns that list into
 * multipart geometry, orients it on the axis the block was placed on, and
 * works out how far the whole assembly has turned for the current tick.
 *
 * Geometry is authored in the parts' own frame: u and v span the face of the
 * part (perpendicular to the axle), w runs along the axle. `toBox` maps that
 * onto block coordinates for the chosen axis, so every part works on all three
 * axes from one definition.
 *
 * Speed and direction belong to the block: it asks ShaftDrive what is turning
 * it and returns RPM and a sign from getShaftRpm() / getShaftDirection(), and
 * this class turns those into a degrees-per-tick angle for the renderer's
 * animation clock. An undriven part gets 0 RPM, so it stands still.
 */

const P = (pixels) => pixels / 16;

// 4/16 square rod, the cross-section the shaft block has always used.
const ROD_MIN = 6;
const ROD_MAX = 10;

// Cog model (1/16 pixels): four tooth bars plus the two-piece casing. The
// crossed bars carry their own rotation about the axle.
const COG_PARTS = [
    {u: [-1, 17], v: [6.5, 9.5], w: [6.5, 9.5], teeth: true},
    {u: [-1, 17], v: [6.5, 9.5], w: [6.5, 9.5], rotation: 45, teeth: true},
    {u: [-1, 17], v: [6.5, 9.5], w: [6.5, 9.5], rotation: -45, teeth: true},
    {u: [6.5, 9.5], v: [-1, 17], w: [6.5, 9.5], teeth: true},
    {u: [2, 14], v: [2, 14], w: [7, 9]},
    {u: [4, 12], v: [4, 12], w: [6, 10]}
];

export default class ShaftRenderer {

    /** Axis a shaft part runs along. Matches the shaft block's metadata. */
    static AXIS = Object.freeze({Y: 0, X: 1, Z: 2});

    /** The parts this renderer draws. */
    static PART = Object.freeze({
        SHAFT: 'shaft',
        HALF_SHAFT: 'halfShaft',
        COG: 'cog'
    });

    /** Default turn rate of a placed shaft, in revolutions per minute. */
    static DEFAULT_RPM = 16;

    static getAxis(data) {
        const axis = (data || 0) & 3;
        return axis === ShaftRenderer.AXIS.X || axis === ShaftRenderer.AXIS.Z
            ? axis
            : ShaftRenderer.AXIS.Y;
    }

    /** Metadata for a block placed against `face` (0 bottom .. 5 east). */
    static getAxisFromFace(face) {
        if (face === 4 || face === 5) return ShaftRenderer.AXIS.X;
        if (face === 2 || face === 3) return ShaftRenderer.AXIS.Z;
        return ShaftRenderer.AXIS.Y;
    }

    /** A rotation block getting turned about `axis` by `angle` degrees. */
    static getRotationForAxis(axis, angle) {
        if (axis === ShaftRenderer.AXIS.X) {
            return {x: angle, y: 0, z: 0};
        }
        if (axis === ShaftRenderer.AXIS.Z) {
            return {x: 0, y: 0, z: angle};
        }
        return {x: 0, y: angle, z: 0};
    }

    /**
     * Angle in degrees for `tick` at `rpm`, where a negative `direction` turns
     * the part the other way.
     *
     * The half-tick offset keeps the angle away from exactly 0, which the block
     * renderer reads as "this block does not turn" and bakes into the section
     * mesh instead of giving it a mesh of its own. A block that really asks for
     * 0 RPM still gets 0 and stays static.
     */
    static angleFor(rpm, direction, tick) {
        const rate = Number(rpm);
        const safeRate = Number.isFinite(rate) ? rate : ShaftRenderer.DEFAULT_RPM;
        const degreesPerTick = (safeRate * 360) / 60 / 20;
        const step = (Number(tick) || 0) + 0.5;
        const sign = direction < 0 ? -1 : 1;

        return (step * degreesPerTick * sign) % 360;
    }

    /** The rotation a block should report for its whole assembly. */
    static getRotation(axis, rpm, direction, tick) {
        return ShaftRenderer.getRotationForAxis(
            axis,
            ShaftRenderer.angleFor(rpm, direction, tick)
        );
    }

    /**
     * Boxes of one part in its own frame. A half-shaft runs from the middle of
     * the cell to one end: `negative` picks the low end, otherwise the high one.
     */
    static getPartBoxes(part, options = {}) {
        switch (part) {
            case ShaftRenderer.PART.COG:
                return COG_PARTS;
            case ShaftRenderer.PART.HALF_SHAFT:
                return [{
                    u: [ROD_MIN, ROD_MAX],
                    v: [ROD_MIN, ROD_MAX],
                    w: options.negative ? [0, 8] : [8, 16]
                }];
            case ShaftRenderer.PART.SHAFT:
            default:
                return [{
                    u: [ROD_MIN, ROD_MAX],
                    v: [ROD_MIN, ROD_MAX],
                    w: [0, 16]
                }];
        }
    }

    /**
     * Multipart entries for one part.
     *
     * @param {string} part one of ShaftRenderer.PART
     * @param {number} axis one of ShaftRenderer.AXIS
     * @param {object} options {texture, teethTexture, negative}
     */
    static getParts(part, axis, options = {}) {
        const texture = options.texture || 'stone';
        const teethTexture = options.teethTexture || texture;

        return ShaftRenderer.getPartBoxes(part, options).map((box) => {
            const partTexture = box.teeth ? teethTexture : texture;
            const data = {
                texture: partTexture,
                bbox: ShaftRenderer.toBox(box, axis)
            };

            if (box.rotation) {
                // Tooth bars cross at the middle of the cell, which is also the
                // centre of the part on the axle.
                data.rotation = ShaftRenderer.getRotationForAxis(axis, box.rotation);
                data.pivot = {x: 0.5, y: 0.5, z: 0.5};
            }

            return ['texture', partTexture, data];
        });
    }

    /**
     * Flatten a block's part descriptors into one multipart list.
     *
     * @param {{part: string, texture?: string, teethTexture?: string, negative?: boolean}[]} descriptors
     * @param {number} axis
     */
    static buildParts(descriptors, axis) {
        const parts = [];

        for (const descriptor of descriptors || []) {
            if (!descriptor) {
                continue;
            }
            parts.push(...ShaftRenderer.getParts(descriptor.part, axis, descriptor));
        }

        return parts;
    }

    /** Map a part's own (u, v, w) box onto block coordinates for `axis`. */
    static toBox(box, axis) {
        const [u0, u1] = box.u;
        const [v0, v1] = box.v;
        const [w0, w1] = box.w;

        if (axis === ShaftRenderer.AXIS.X) {
            return {
                minX: P(w0), minY: P(u0), minZ: P(v0),
                maxX: P(w1), maxY: P(u1), maxZ: P(v1)
            };
        }
        if (axis === ShaftRenderer.AXIS.Z) {
            return {
                minX: P(u0), minY: P(v0), minZ: P(w0),
                maxX: P(u1), maxY: P(v1), maxZ: P(w1)
            };
        }
        return {
            minX: P(u0), minY: P(w0), minZ: P(v0),
            maxX: P(u1), maxY: P(w1), maxZ: P(v1)
        };
    }
}
