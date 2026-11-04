import NoiseGenerator from "../NoiseGenerator.js";
import NoiseGeneratorPerlin from "./NoiseGeneratorPerlin.js";

export default class NoiseGeneratorOctaves extends NoiseGenerator {

    constructor(random, octaves) {
        super();

        this.octaves = octaves;
        this.generatorCollection = new Array(octaves);

        for (let i = 0; i < octaves; i++) {
            this.generatorCollection[i] = new NoiseGeneratorPerlin(random);
        }
    }

    perlin(x, z) {
        let total = 0.0;
        let frequency = 1.0;
        const gens = this.generatorCollection;
        for (let i = 0; i < this.octaves; i++) {
            total += gens[i].perlin(x / frequency, z / frequency) * frequency;
            frequency *= 2.0;
        }
        return total;
    }

    generateNoiseOctaves(x1, y1, z1, x2, y2, z2, strengthX, strengthY, strengthZ) {
        let length = x2 * y2 * z2;
        // Float64Array eliminates zero-loop allocation overhead and GC pressure
        let noise = new Float64Array(length);

        let frequency = 1.0;
        const octaves = this.octaves;
        const gens = this.generatorCollection;

        for (let i = 0; i < octaves; i++) {
            gens[i].combined(
                noise,
                x1, y1, z1,
                x2, y2, z2,
                strengthX * frequency,
                strengthY * frequency,
                strengthZ * frequency,
                frequency
            );
            frequency *= 0.5;
        }

        return noise;
    }
}