import { blockName, boxPositions, relative, requireContext } from './feature-world.mjs';

export const PORTAL_FEATURE_TYPES = new Set(['minecraft:end_podium', 'minecraft:end_gateway', 'minecraft:fill_layer']);

export function placePortalFeature(feature, origin, random, { context, directState, setBlock }) {
    const named = (name, properties = {}) => directState({ id: `minecraft:${name}`, properties });
    const write = (state, pos, flags = 3) => setBlock(state, pos, flags);
    switch (feature.type) {
        case 'minecraft:fill_layer': {
            if (!Number.isInteger(context?.minY)) throw new TypeError('Fill layer requires context.minY');
            if (!Number.isInteger(feature.height) || feature.height < 0) throw new RangeError('Invalid fill layer height');
            const read = requireContext(context, 'getBlockState'), state = directState(feature.state);
            for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
                const pos = { x: origin.x + x, y: context.minY + feature.height, z: origin.z + z };
                if (['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(read(pos)))) write(state, pos, 2);
            }
            return true;
        }
        case 'minecraft:end_podium': {
            const dropAndWrite = (name, pos) => {
                if (blockName(requireContext(context, 'getBlockState')(pos)) === `minecraft:${name}`) return;
                requireContext(context, 'destroyBlock')(pos, true);
                write(named(name), pos);
            };
            for (const pos of boxPositions(origin, 4, 1, 4, 32)) {
                const distance = (pos.x - origin.x) ** 2 + (pos.y - origin.y) ** 2 + (pos.z - origin.z) ** 2;
                const inner = distance < 2.5 ** 2;
                if (!inner && distance >= 3.5 ** 2) continue;
                if (pos.y < origin.y) {
                    if (inner) write(named('bedrock'), pos);
                    else if (feature.active) dropAndWrite('end_stone', pos);
                    else write(named('end_stone'), pos);
                } else if (pos.y > origin.y) {
                    if (feature.active) dropAndWrite('air', pos);
                    else write(named('air'), pos);
                } else if (!inner) write(named('bedrock'), pos);
                else if (feature.active) dropAndWrite('end_portal', pos);
                else write(named('air'), pos);
            }
            for (let y = 0; y < 4; y++) write(named('bedrock'), relative(origin, 'up', y));
            for (const facing of ['north', 'east', 'south', 'west']) write(named('wall_torch', { facing }), relative(relative(origin, 'up', 2), facing));
            return true;
        }
        case 'minecraft:end_gateway': {
            if (feature.exit != null && (!Array.isArray(feature.exit) || feature.exit.length !== 3 || !feature.exit.every(Number.isInteger))) throw new TypeError('Gateway exit requires three integer coordinates');
            for (const pos of boxPositions(origin, 1, 2, 1)) {
                const x = pos.x === origin.x, y = pos.y === origin.y, z = pos.z === origin.z, cap = Math.abs(pos.y - origin.y) === 2;
                if (x && y && z) {
                    write(named('end_gateway'), pos);
                    if (feature.exit != null && requireContext(context, 'hasEndGatewayBlockEntity')(pos))
                        requireContext(context, 'setEndGatewayExit')(pos, { x: feature.exit[0], y: feature.exit[1], z: feature.exit[2] }, feature.exact);
                } else write(named(y || !x && !z || cap && !(x && z) ? 'air' : 'bedrock'), pos);
            }
            return true;
        }
        default: throw new Error(`Unsupported portal feature: ${feature.type}`);
    }
}
