
export default class StructureSelection {

    constructor() {
        this.p1 = null;
        this.p2 = null;
    }

    
    setPoint(index, x, y, z) {
        const point = {x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z)};
        if (index === 1) {
            this.p1 = point;
        } else {
            this.p2 = point;
        }
        return point;
    }

    
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
