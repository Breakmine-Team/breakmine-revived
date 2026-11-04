import { createEndIslandSampler } from './end-islands.mjs';

const JAVA_INT_MIN = -2147483648;
const JAVA_INT_MAX = 2147483647;
const END_BIOMES = Object.freeze({
    center: 'minecraft:the_end',
    highlands: 'minecraft:end_highlands',
    midlands: 'minecraft:end_midlands',
    islands: 'minecraft:small_end_islands',
    barrens: 'minecraft:end_barrens'
});

function javaInt(value, name) {
    if (!Number.isInteger(value) || value < JAVA_INT_MIN || value > JAVA_INT_MAX) {
        throw new RangeError(`${name} must be a Java int`);
    }
    return value;
}

function blockToSection(block) {
    return Math.floor(block / 16);
}

function sectionCenter(section) {
    return (section * 2 + 1) * 8;
}

export function createEndBiomeSource(sampleErosion, biomes = END_BIOMES) {
    if (typeof sampleErosion !== 'function') throw new TypeError('Expected an End erosion sampler');
    for (const key of Object.keys(END_BIOMES)) {
        if (typeof biomes?.[key] !== 'string' || !biomes[key].startsWith('minecraft:')) {
            throw new TypeError(`Missing End biome id: ${key}`);
        }
    }

    return {
        biomes: Object.freeze(Object.values(biomes)),
        biomeAtQuart(quartX, quartY, quartZ) {
            [quartX, quartY, quartZ].forEach((value, index) => {
                javaInt(value, ['quartX', 'quartY', 'quartZ'][index]);
                const block = value * 4;
                if (block < JAVA_INT_MIN || block > JAVA_INT_MAX) throw new RangeError('Quart coordinate exceeds block int range');
            });

            const blockX = quartX * 4;
            const blockY = quartY * 4;
            const blockZ = quartZ * 4;
            const sectionX = blockToSection(blockX);
            const sectionZ = blockToSection(blockZ);
            if (sectionX * sectionX + sectionZ * sectionZ <= 4096) return biomes.center;

            const erosion = sampleErosion(sectionCenter(sectionX), blockY, sectionCenter(sectionZ));
            if (!Number.isFinite(erosion)) throw new TypeError('End erosion sampler must return a finite value');
            if (erosion > 0.25) return biomes.highlands;
            if (erosion >= -0.0625) return biomes.midlands;
            if (erosion < -0.21875) return biomes.islands;
            return biomes.barrens;
        }
    };
}

export function createSeededEndBiomeSource(seed, biomes = END_BIOMES) {
    const islands = createEndIslandSampler(seed);
    return createEndBiomeSource((x, y, z) => islands.outerIslands(x, y, z), biomes);
}

export function createKernelEndBiomeSource(kernel, seed, data, biomes = END_BIOMES) {
    const graph = kernel.density(seed, data, { erosion: 'minecraft:end/islands' });
    const source = createEndBiomeSource((x, y, z) => graph.sample('erosion', x, y, z), biomes);
    return { ...source, dispose: graph.dispose };
}

export { END_BIOMES };
