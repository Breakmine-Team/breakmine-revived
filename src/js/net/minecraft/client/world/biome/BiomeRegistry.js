import BiomeForest from "./BiomeForest.js";
import BiomePlains from "./BiomePlains.js";
import BiomeSnowy from "./BiomeSnowy.js";

export class BiomeRegistry {

    static biomes = new Map();

    static FOREST = new BiomeForest();
    static PLAINS = new BiomePlains();
    static SNOWY = new BiomeSnowy();

    static init = false;

    static register(biome) {
        this.biomes.set(biome.id, biome);
        this.biomes.set(biome.name.toLowerCase(), biome);
        return biome;
    }

    static getById(id) {
        return this.biomes.get(id);
    }

    static getByName(name) {
        return this.biomes.get(name.toLowerCase());
    }

    static getAll() {
        return Array.from(this.biomes.values()).filter(b => typeof b === 'object' && b.id !== undefined);
    }

    static create() {
        BiomeRegistry.register(BiomeRegistry.FOREST);
        BiomeRegistry.register(BiomeRegistry.PLAINS);
        BiomeRegistry.register(BiomeRegistry.SNOWY);

        BiomeRegistry.init = true;
    }
}
