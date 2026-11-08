export default class BoundingBox {

    
    constructor(minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0) {
        this.epsilon = 0.0;

        this.minX = minX;
        this.minY = minY;
        this.minZ = minZ;
        this.maxX = maxX;
        this.maxY = maxY;
        this.maxZ = maxZ;
    }

    width() {
        return this.maxX - this.minX;
    }

    height() {
        return this.maxY - this.minY;
    }

    depth() {
        return this.maxZ - this.minZ;
    }

    
    clone() {
        return new BoundingBox(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
    }

    
    expand(x, y, z) {
        let minX = this.minX;
        let minY = this.minY;
        let minZ = this.minZ;
        let maxX = this.maxX;
        let maxY = this.maxY;
        let maxZ = this.maxZ;

        if (x < 0.0) {
            minX += x;
        } else {
            maxX += x;
        }

        if (y < 0.0) {
            minY += y;
        } else {
            maxY += y;
        }

        if (z < 0.0) {
            minZ += z;
        } else {
            maxZ += z;
        }

        return new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ);
    }


    
    grow(x, y, z) {
        return new BoundingBox(
            this.minX - x,
            this.minY - y,
            this.minZ - z,
            this.maxX + x,
            this.maxY + y,
            this.maxZ + z
        );
    }


    
    clipXCollide(otherBoundingBox, x) {
        if (otherBoundingBox.maxY <= this.minY || otherBoundingBox.minY >= this.maxY) {
            return x;
        }

        if (otherBoundingBox.maxZ <= this.minZ || otherBoundingBox.minZ >= this.maxZ) {
            return x;
        }

        if (x > 0.0 && otherBoundingBox.maxX <= this.minX) {
            let max = this.minX - otherBoundingBox.maxX - this.epsilon;
            if (max < x) {
                x = max;
            }
        }

        if (x < 0.0 && otherBoundingBox.minX >= this.maxX) {
            let max = this.maxX - otherBoundingBox.minX + this.epsilon;
            if (max > x) {
                x = max;
            }
        }

        return x;
    }

    
    clipYCollide(otherBoundingBox, y) {
        if (otherBoundingBox.maxX <= this.minX || otherBoundingBox.minX >= this.maxX) {
            return y;
        }

        if (otherBoundingBox.maxZ <= this.minZ || otherBoundingBox.minZ >= this.maxZ) {
            return y;
        }

        if (y > 0.0 && otherBoundingBox.maxY <= this.minY) {
            let max = this.minY - otherBoundingBox.maxY - this.epsilon;
            if (max < y) {
                y = max;
            }
        }

        if (y < 0.0 && otherBoundingBox.minY >= this.maxY) {
            let max = this.maxY - otherBoundingBox.minY + this.epsilon;
            if (max > y) {
                y = max;
            }
        }

        return y;
    }


    
    clipZCollide(otherBoundingBox, z) {
        if (otherBoundingBox.maxX <= this.minX || otherBoundingBox.minX >= this.maxX) {
            return z;
        }

        if (otherBoundingBox.maxY <= this.minY || otherBoundingBox.minY >= this.maxY) {
            return z;
        }

        if (z > 0.0 && otherBoundingBox.maxZ <= this.minZ) {
            let max = this.minZ - otherBoundingBox.maxZ - this.epsilon;
            if (max < z) {
                z = max;
            }
        }

        if (z < 0.0 && otherBoundingBox.minZ >= this.maxZ) {
            let max = this.maxZ - otherBoundingBox.minZ + this.epsilon;
            if (max > z) {
                z = max;
            }
        }

        return z;
    }

    
    intersects(otherBoundingBox) {
        if (otherBoundingBox.maxX <= this.minX || otherBoundingBox.minX >= this.maxX) {
            return false;
        }

        if (otherBoundingBox.maxY <= this.minY || otherBoundingBox.minY >= this.maxY) {
            return false;
        }

        return (!(otherBoundingBox.maxZ <= this.minZ)) && (!(otherBoundingBox.minZ >= this.maxZ));
    }

    
    move(x, y, z) {
        this.minX += x;
        this.minY += y;
        this.minZ += z;
        this.maxX += x;
        this.maxY += y;
        this.maxZ += z;
    }

    
    offset(x, y, z) {
        return new BoundingBox(
            this.minX + x,
            this.minY + y,
            this.minZ + z,
            this.maxX + x,
            this.maxY + y,
            this.maxZ + z
        );
    }
}