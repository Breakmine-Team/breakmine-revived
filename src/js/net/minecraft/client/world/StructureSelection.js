/**
 * The two corners of a structure selection made with /st p1 and /st p2.
 *
 * Lives on the Minecraft instance and is read by the world renderer, which
 * draws a box around whatever is selected. Corners are block positions; the
 * box max side is exclusive, so a 2x1x1 selection spans x..x+2.
 */
export default class StructureSelection {

    constructor() {
        this.p1 = null;
        this.p2 = null;
    }

    /** Store corner 1 or 2 at a block position. */
    setPoint(index, x, y, z) {
        const point = {x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z)};
        if (index === 1) {
            this.p1 = point;
        } else {
            this.p2 = point;
        }
        return point;
    }

    /** The selected block box, or null until both corners exist. */
    getBounds() {
        if (this.p1 === null || this.p2 === null) {
            return null;
        }

        return {
            minX: Math.min(this.p1.x, this.p2.x),
            minY: Math.min(this.p1.y, this.p2.y),
            minZ: Math.min(this.p1.z, this.p2.z),
            maxX: Math.max(this.p1.x, this.p2.x) + 1,
            maxY: Math.max(this.p1.y, this.p2.y) + 1,
            maxZ: Math.max(this.p1.z, this.p2.z) + 1
        };
    }

    /** Width, height and depth in blocks, or null while a corner is missing. */
    getSize() {
        const bounds = this.getBounds();
        if (bounds === null) {
            return null;
        }

        return {
            x: bounds.maxX - bounds.minX,
            y: bounds.maxY - bounds.minY,
            z: bounds.maxZ - bounds.minZ
        };
    }
}
