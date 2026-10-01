import NoiseGenerator from "../NoiseGenerator.js";

// Fast file-scoped helpers to avoid method lookup overhead inside hot loops
function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(x, a, b) {
    return a + x * (b - a);
}

function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export default class NoiseGeneratorPerlin extends NoiseGenerator {

    constructor(random) {
        super();

        this.offsetX = random.nextDouble() * 256;
        this.offsetY = random.nextDouble() * 256;
        this.offsetZ = random.nextDouble() * 256;

        // Use typed Int32Array for optimal memory access
        this.permutations = new Int32Array(512);
        for (let i = 0; i < 256; i++) {
            this.permutations[i] = i;
        }
        for (let i = 0; i < 256; i++) {
            let n = random.nextInt(256 - i) + i;
            let n2 = this.permutations[i];
            this.permutations[i] = this.permutations[n];
            this.permutations[n] = n2;
            this.permutations[i + 256] = this.permutations[i];
        }
    }

    perlin(x, z) {
        return this.perlinXYZ(x, z, 0);
    }

    perlinXYZ(x, y, z) {
        let shiftX = x + this.offsetX;
        let shiftY = y + this.offsetY;
        let shiftZ = z + this.offsetZ;

        let floorX = Math.floor(shiftX);
        let floorY = Math.floor(shiftY);
        let floorZ = Math.floor(shiftZ);

        if (shiftX < floorX) floorX--;
        if (shiftY < floorY) floorY--;
        if (shiftZ < floorZ) floorZ--;

        let x1 = floorX & 0xff;
        let y1 = floorY & 0xff;
        let z1 = floorZ & 0xff;

        shiftX -= floorX;
        shiftY -= floorY;
        shiftZ -= floorZ;

        let u = fade(shiftX);
        let w = fade(shiftY);
        let v = fade(shiftZ);

        const p = this.permutations;

        let xy = p[x1] + y1;
        let xyz = p[xy] + z1;

        let xy1z = p[xy + 1] + z1;
        let xi = p[x1 + 1] + y1;
        let yi = p[xi] + z1;
        let zi = p[xi + 1] + z1;

        return lerp(v,
            lerp(w,
                lerp(u,
                    grad(p[xyz], shiftX, shiftY, shiftZ),
                    grad(p[yi], shiftX - 1.0, shiftY, shiftZ)),
                lerp(u,
                    grad(p[xy1z], shiftX, shiftY - 1.0, shiftZ),
                    grad(p[zi], shiftX - 1.0, shiftY - 1.0, shiftZ))),
            lerp(w,
                lerp(u,
                    grad(p[xyz + 1], shiftX, shiftY, shiftZ - 1.0),
                    grad(p[yi + 1], shiftX - 1.0, shiftY, shiftZ - 1.0)),
                lerp(u,
                    grad(p[xy1z + 1], shiftX, shiftY - 1.0, shiftZ - 1.0),
                    grad(p[zi + 1], shiftX - 1.0, shiftY - 1.0, shiftZ - 1.0))));
    }

    combined(noise, x1, y1, z1, x2, y2, z2, strengthX, strengthY, strengthZ, frequency) {
        let index = 0;
        let invertFrequency = 1.0 / frequency;
        let prevY3 = -1;

        let output1 = 0;
        let output2 = 0;
        let output3 = 0;
        let output4 = 0;

        const p = this.permutations;
        const offX = this.offsetX;
        const offY = this.offsetY;
        const offZ = this.offsetZ;

        for (let x = 0; x < x2; x++) {
            let shiftX = (x1 + x) * strengthX + offX;
            let floorX = Math.floor(shiftX);
            if (shiftX < floorX) floorX--;

            let x3 = floorX & 0xff;
            shiftX -= floorX;
            let u = fade(shiftX);

            for (let z = 0; z < z2; z++) {
                let shiftZ = (z1 + z) * strengthZ + offZ;
                let floorZ = Math.floor(shiftZ);
                if (shiftZ < floorZ) floorZ--;

                let z3 = floorZ & 0xff;
                shiftZ -= floorZ;
                let w = fade(shiftZ);

                for (let y = 0; y < y2; y++) {
                    let shiftY = (y1 + y) * strengthY + offY;
                    let floorY = Math.floor(shiftY);
                    if (shiftY < floorY) floorY--;

                    let y3 = floorY & 0xff;
                    shiftY -= floorY;
                    let v = fade(shiftY);

                    if (y === 0 || y3 !== prevY3) {
                        prevY3 = y3;

                        let xy = p[x3] + y3;
                        let xyz = p[xy] + z3;
                        let xy1z = p[xy + 1] + z3;
                        let xi = p[x3 + 1] + y3;
                        let yi = p[xi] + z3;
                        let zi = p[xi + 1] + z3;

                        output1 = lerp(u,
                            grad(p[xyz], shiftX, shiftY, shiftZ),
                            grad(p[yi], shiftX - 1.0, shiftY, shiftZ));
                        output2 = lerp(u,
                            grad(p[xy1z], shiftX, shiftY - 1.0, shiftZ),
                            grad(p[zi], shiftX - 1.0, shiftY - 1.0, shiftZ));
                        output3 = lerp(u,
                            grad(p[xyz + 1], shiftX, shiftY, shiftZ - 1.0),
                            grad(p[yi + 1], shiftX - 1.0, shiftY, shiftZ - 1.0));
                        output4 = lerp(u,
                            grad(p[xy1z + 1], shiftX, shiftY - 1.0, shiftZ - 1.0),
                            grad(p[zi + 1], shiftX - 1.0, shiftY - 1.0, shiftZ - 1.0));
                    }

                    let output5 = lerp(v, output1, output2);
                    let output6 = lerp(v, output3, output4);

                    let output = lerp(w, output5, output6);
                    noise[index++] += output * invertFrequency;
                }
            }
        }
    }
}