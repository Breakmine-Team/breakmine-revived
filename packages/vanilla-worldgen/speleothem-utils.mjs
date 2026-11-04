import { blockName, relative, matchesHolderSet, requireContext } from './feature-world.mjs';

export const SPELEOTHEM_FEATURE_TYPES = new Set(['minecraft:speleothem', 'minecraft:speleothem_cluster', 'minecraft:large_dripstone']);
export const SPELEOTHEM_HORIZONTAL = Object.freeze(['north', 'east', 'south', 'west']);
export const isEmptyOrWater = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:water'].includes(blockName(state));
export const isEmptyOrWaterOrLava = state => isEmptyOrWater(state) || blockName(state) === 'minecraft:lava';
export const f32 = Math.fround;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let sineTable;
function table() { return sineTable ??= Float32Array.from({ length: 65536 }, (_, i) => Math.sin(i * Math.PI * 2 / 65536)); }
export const speleothemSin = angle => table()[Math.trunc(angle * 10430.378350470453) & 65535];
export const speleothemCos = angle => table()[Math.trunc(angle * 10430.378350470453 + 16384) & 65535];

export function speleothemHeight(distance, radius, scale, bluntness) {
    if (distance < bluntness) distance = bluntness;
    const normalized = distance / radius * 0.384;
    const height = scale * (0.75 * Math.pow(normalized, 1.3333333333333333) - Math.pow(normalized, 0.6666666666666666) - 0.3333333333333333 * Math.log(normalized));
    return Math.max(height, 0) / 0.384 * radius;
}

export function createSpeleothemTools(feature, { context, directState, setBlock }) {
    const read = requireContext(context, 'getBlockState');
    const baseName = blockName(feature.base_block), pointedName = blockName(feature.pointed_block);
    const defaultState = name => {
        const state = requireContext(context, 'getDefaultBlockState')(name);
        return directState({ id: blockName(state), properties: state.properties ?? {} });
    };
    const isBase = state => blockName(state) === baseName || matchesHolderSet(feature.replaceable_blocks, state, context);
    const placeBase = pos => {
        if (!matchesHolderSet(feature.replaceable_blocks, read(pos), context)) return false;
        setBlock(defaultState(baseName), pos, 2); return true;
    };
    const grow = (origin, direction, height, merge) => {
        if (!isBase(read(relative(origin, direction === 'up' ? 'down' : 'up')))) return;
        const thicknesses = [];
        if (height >= 3) { thicknesses.push('base'); for (let i = 0; i < height - 3; i++) thicknesses.push('middle'); }
        if (height >= 2) thicknesses.push('frustum');
        if (height >= 1) thicknesses.push(merge ? 'tip_merge' : 'tip');
        let pos = { ...origin };
        for (const thickness of thicknesses) {
            const state = defaultState(pointedName);
            const waterlogged = requireContext(context, 'blockFluidIsInTag')(read(pos), 'minecraft:water', pos);
            setBlock(directState({ id: state.name, properties: { ...state.properties, vertical_direction: direction, thickness, waterlogged: String(waterlogged) } }), pos, 2);
            pos = relative(pos, direction);
        }
    };
    return { read, isBase, placeBase, grow, defaultState, baseName, pointedName };
}
