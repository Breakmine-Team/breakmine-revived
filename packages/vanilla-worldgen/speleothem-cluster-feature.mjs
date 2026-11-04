import { relative, blockName, requireContext } from './feature-world.mjs';
import { scanWorldgenColumn } from './column-scan.mjs';
import { sampleIntProvider, sampleFloatProvider } from './value-providers.mjs';
import { createSpeleothemTools, SPELEOTHEM_HORIZONTAL, isEmptyOrWater, f32, clamp } from './speleothem-utils.mjs';

export function placeSpeleothemCluster(feature, origin, random, options) {
    const { context, directState, setBlock } = options;
    const { read, placeBase, grow, baseName, pointedName } = createSpeleothemTools(feature, options);
    if (!isEmptyOrWater(read(origin))) return false;
    const height = sampleIntProvider(feature.height, random), wetness = sampleFloatProvider(feature.wetness, random), density = sampleFloatProvider(feature.density, random);
    const radiusX = sampleIntProvider(feature.radius, random), radiusZ = sampleIntProvider(feature.radius, random);
    const water = pos => requireContext(context, 'blockFluidIsInTag')(read(pos), 'minecraft:water', pos);
    const adjacent = pos => requireContext(context, 'isBlockInTag')(read(pos), 'minecraft:base_stone_overworld', pos) || water(pos);
    const canPool = pos => !['minecraft:water', baseName, pointedName].includes(blockName(read(pos))) && !water(relative(pos, 'up'))
        && SPELEOTHEM_HORIZONTAL.every(d => adjacent(relative(pos, d))) && adjacent(relative(pos, 'down'));
    const replaceLayer = (pos, thickness, direction) => {
        for (let i = 0; i < thickness; i++, pos = relative(pos, direction)) if (!placeBase(pos)) return;
    };
    const randomHeight = (x, z, max) => {
        if (random.nextFloat() > density) return 0;
        const bias = f32(max / 2 + clamp((Math.abs(x) + Math.abs(z)) / feature.max_distance_from_center_affecting_height_bias, 0, 1) * (0 - max / 2));
        return Math.trunc(sampleFloatProvider({ type: 'minecraft:clamped_normal', mean: bias, deviation: feature.height_deviation, min: 0, max }, random));
    };
    for (let x = -radiusX; x <= radiusX; x++) for (let z = -radiusZ; z <= radiusZ; z++) {
        const pos = { x: origin.x + x, y: origin.y, z: origin.z + z };
        const column = scanWorldgenColumn(pos, feature.floor_to_ceiling_search_range, read, isEmptyOrWater, state => !isEmptyOrWater(state));
        if (!column || column.ceiling == null && column.floor == null) continue;
        const { ceiling } = column; let { floor } = column;
        const wantsPool = random.nextFloat() < wetness;
        if (wantsPool && floor != null && canPool({ ...pos, y: floor })) {
            setBlock(directState({ id: 'minecraft:water', properties: { level: '0' } }), { ...pos, y: floor }, 2); floor--;
        }
        const edge = Math.min(radiusX - Math.abs(x), radiusZ - Math.abs(z));
        const t = f32(f32(edge) / f32(feature.max_distance_from_edge_affecting_chance_of_speleothem));
        const chance = f32(f32(feature.chance_of_speleothem_at_max_distance_from_center) + f32(clamp(t, 0, 1) * f32(1 - f32(feature.chance_of_speleothem_at_max_distance_from_center))));
        let down = 0, up = 0;
        const wantsDown = random.nextDouble() < chance;
        if (ceiling != null && wantsDown && blockName(read({ ...pos, y: ceiling })) !== 'minecraft:lava') {
            replaceLayer({ ...pos, y: ceiling }, sampleIntProvider(feature.speleothem_block_layer_thickness, random), 'up');
            down = randomHeight(x, z, floor != null ? Math.min(height, ceiling - floor) : height);
        }
        const wantsUp = random.nextDouble() < chance;
        if (floor != null && wantsUp && blockName(read({ ...pos, y: floor })) !== 'minecraft:lava') {
            replaceLayer({ ...pos, y: floor }, sampleIntProvider(feature.speleothem_block_layer_thickness, random), 'down');
            up = ceiling != null ? Math.max(0, down + random.nextInt(feature.max_stalagmite_stalactite_height_diff * 2 + 1) - feature.max_stalagmite_stalactite_height_diff) : randomHeight(x, z, height);
        }
        if (ceiling != null && floor != null && ceiling - down <= floor + up) {
            const min = Math.max(ceiling - down, floor + 1), max = Math.min(floor + up, ceiling - 1) + 1;
            const split = min + random.nextInt(max - min + 1);
            down = ceiling - split; up = split - 1 - floor;
        }
        const mergeDraw = random.nextBoolean();
        const merge = mergeDraw && down > 0 && up > 0 && ceiling != null && floor != null && down + up === ceiling - floor - 1;
        if (ceiling != null) grow({ ...pos, y: ceiling - 1 }, 'down', down, merge);
        if (floor != null) grow({ ...pos, y: floor + 1 }, 'up', up, merge);
    }
    return true;
}
