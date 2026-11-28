import BoundingBox from "./BoundingBox.js";

// A block that has been rotated out of the world grid, kept as the box it really
// is instead of being squared off around its corners.
//
// The axis aligned extent is still there, so everything that only needs a rough
// idea of where the box is keeps working, but vertical movement is clipped
// against the real tilted faces: the top or bottom face over the part of the
// footprint the mover covers. Without that, standing on a leaning contraption
// left the player a lattice step above the deck, or inside it, depending on
// which way the cell had been rounded.
export default class PosedCollisionBox extends BoundingBox {

    // Corner index bits: 1 = max x, 2 = max y, 4 = max z. Listed so the four
    // corners of a face form a ring instead of a bowtie.
    static TOP = [2, 3, 7, 6];
    static BOTTOM = [0, 1, 5, 4];

    // How far inside a face a mover may be and still be put back outside it.
    // A hull that rocks up under a rider, or a solver that leaves the feet a
    // hair under the surface, would otherwise be "already inside" and let the
    // body fall the rest of the way through the boat. Kept under half a block
    // so someone standing in a cabin half a block below its ceiling is not
    // hoisted through the deck.
    static SNAP = 0.4;

    constructor(corners) {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (const corner of corners) {
            if (corner.x < minX) minX = corner.x;
            if (corner.y < minY) minY = corner.y;
            if (corner.z < minZ) minZ = corner.z;
            if (corner.x > maxX) maxX = corner.x;
            if (corner.y > maxY) maxY = corner.y;
            if (corner.z > maxZ) maxZ = corner.z;
        }

        super(minX, minY, minZ, maxX, maxY, maxZ);

        this.corners = corners;
    }

    
    offsetBox(x, y, z) {
        return new PosedCollisionBox(this.corners.map((corner) => ({
            x: corner.x + x,
            y: corner.y + y,
            z: corner.z + z
        })));
    }

    // Highest (or lowest) point of a face over the part of the mover's footprint
    // that face covers, or null when it covers none of it. The face is a plane,
    // so clipping its quad to the footprint and taking the extreme vertex is
    // exact rather than an approximation.
    faceHeightOver(mover, top) {
        let polygon = (top ? PosedCollisionBox.TOP : PosedCollisionBox.BOTTOM)
            .map((index) => this.corners[index]);

        polygon = PosedCollisionBox.clip(polygon, "x", mover.minX, true);
        if (polygon.length === 0) return null;

        polygon = PosedCollisionBox.clip(polygon, "x", mover.maxX, false);
        if (polygon.length === 0) return null;

        polygon = PosedCollisionBox.clip(polygon, "z", mover.minZ, true);
        if (polygon.length === 0) return null;

        polygon = PosedCollisionBox.clip(polygon, "z", mover.maxZ, false);
        if (polygon.length === 0) return null;

        let height = top ? -Infinity : Infinity;

        for (const point of polygon) {
            height = top ? Math.max(height, point.y) : Math.min(height, point.y);
        }

        return height;
    }

    // Keep the part of the polygon on one side of an axis aligned plane.
    static clip(polygon, axis, limit, keepAbove) {
        const points = [];

        for (let i = 0; i < polygon.length; i++) {
            const current = polygon[i];
            const previous = polygon[(i + polygon.length - 1) % polygon.length];

            const currentIn = keepAbove ? current[axis] >= limit : current[axis] <= limit;
            const previousIn = keepAbove ? previous[axis] >= limit : previous[axis] <= limit;

            if (currentIn === previousIn) {
                if (currentIn) {
                    points.push(current);
                }
                continue;
            }

            const delta = current[axis] - previous[axis];
            const t = Math.abs(delta) < 1e-12 ? 0.0 : (limit - previous[axis]) / delta;

            points.push({
                x: previous.x + (current.x - previous.x) * t,
                y: previous.y + (current.y - previous.y) * t,
                z: previous.z + (current.z - previous.z) * t
            });

            if (currentIn) {
                points.push(current);
            }
        }

        return points;
    }

    // The same job BoundingBox.clipYCollide does, but against the real top and
    // bottom faces instead of the squared off extent.
    clipYCollide(mover, y) {
        if (mover.maxX <= this.minX || mover.minX >= this.maxX) {
            return y;
        }

        if (mover.maxZ <= this.minZ || mover.minZ >= this.maxZ) {
            return y;
        }

        if (y > 0.0) {
            const face = this.faceHeightOver(mover, false);
            const bottom = face === null ? this.minY : face;

            if (mover.maxY > bottom) {
                // The head has just poked into the underside. Stop the rise
                // rather than let the body slide up through the block.
                if (mover.minY < bottom && mover.maxY - bottom <= PosedCollisionBox.SNAP) {
                    return 0.0;
                }

                // Body well inside already: nothing here can help it.
                return y;
            }

            return Math.min(y, bottom - mover.maxY - this.epsilon);
        }

        if (y < 0.0) {
            const face = this.faceHeightOver(mover, true);
            const top = face === null ? this.maxY : face;

            if (mover.minY < top) {
                // Feet slightly inside the surface: put them back on it. Deeper
                // than a step and the mover is under the deck on purpose, so
                // leave that to the axis aligned behaviour.
                if (top - mover.minY <= PosedCollisionBox.SNAP) {
                    return Math.max(y, top - mover.minY + this.epsilon);
                }

                return y;
            }

            return Math.max(y, top - mover.minY + this.epsilon);
        }

        return y;
    }
}
