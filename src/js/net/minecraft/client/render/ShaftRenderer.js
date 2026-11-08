

const P = (pixels) => pixels / 16;


const ROD_MIN = 6;
const ROD_MAX = 10;



const COG_PARTS = [
    {u: [-1, 17], v: [6.5, 9.5], w: [6.5, 9.5], teeth: true},
    {u: [-1, 17], v: [6.5, 9.5], w: [6.5, 9.5], rotation: 45, teeth: true},
    {u: [-1, 17], v: [6.5, 9.5], w: [6.5, 9.5], rotation: -45, teeth: true},
    {u: [6.5, 9.5], v: [-1, 17], w: [6.5, 9.5], teeth: true},
    {u: [2, 14], v: [2, 14], w: [7, 9]},
    {u: [4, 12], v: [4, 12], w: [6, 10]}
];

export default class ShaftRenderer {

    
    static AXIS = Object.freeze({Y: 0, X: 1, Z: 2});

    
    static PART = Object.freeze({
        SHAFT: 'shaft',
        HALF_SHAFT: 'halfShaft',
        COG: 'cog'
    });

    
    static DEFAULT_RPM = 16;

    static getAxis(data) {
        const axis = (data || 0) & 3;
        return axis === ShaftRenderer.AXIS.X || axis === ShaftRenderer.AXIS.Z
            ? axis
            : ShaftRenderer.AXIS.Y;
    }

    
    static getAxisFromFace(face) {
        if (face === 4 || face === 5) return ShaftRenderer.AXIS.X;
        if (face === 2 || face === 3) return ShaftRenderer.AXIS.Z;
        return ShaftRenderer.AXIS.Y;
    }

    
    static getRotationForAxis(axis, angle) {
        if (axis === ShaftRenderer.AXIS.X) {
            return {x: angle, y: 0, z: 0};
        }
        if (axis === ShaftRenderer.AXIS.Z) {
            return {x: 0, y: 0, z: angle};
        }
        return {x: 0, y: angle, z: 0};
    }

    
    static angleFor(rpm, direction, tick) {
        const rate = Number(rpm);
        const safeRate = Number.isFinite(rate) ? rate : ShaftRenderer.DEFAULT_RPM;
        const degreesPerTick = (safeRate * 360) / 60 / 20;
        const step = (Number(tick) || 0) + 0.5;
        const sign = direction < 0 ? -1 : 1;

        return (step * degreesPerTick * sign) % 360;
    }

    
    static getRotation(axis, rpm, direction, tick) {
        return ShaftRenderer.getRotationForAxis(
            axis,
            ShaftRenderer.angleFor(rpm, direction, tick)
        );
    }

    
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
                data.rotation = ShaftRenderer.getRotationForAxis(axis, box.rotation);
                data.pivot = {x: 0.5, y: 0.5, z: 0.5};
            }

            return ['texture', partTexture, data];
        });
    }

    
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
