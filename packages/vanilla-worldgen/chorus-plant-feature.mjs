import { blockName, relative, requireContext } from './feature-world.mjs';

const horizontal = ['north', 'east', 'south', 'west'];
const connections = ['down', 'up', ...horizontal];
const opposite = d => horizontal[(horizontal.indexOf(d) + 2) % 4];

export function placeChorusPlant(feature, origin, random, { context, directState, setBlock }) {
    const read = requireContext(context, 'getBlockState'), air = requireContext(context, 'isAir');
    const supports = pos => requireContext(context, 'isBlockInTag')(read(pos), 'minecraft:supports_chorus_plant', pos);
    if (!air(origin) || !supports(relative(origin, 'down'))) return false;
    const plant = pos => {
        const properties = {};
        for (const direction of connections) {
            const neighbor = relative(pos, direction), name = blockName(read(neighbor));
            properties[direction] = String(name === 'minecraft:chorus_plant' || name === 'minecraft:chorus_flower' || direction === 'down' && supports(neighbor));
        }
        setBlock(directState({ id: 'minecraft:chorus_plant', properties }), pos, 2);
    };
    const neighborsEmpty = (pos, except) => horizontal.every(d => d === except || air(relative(pos, d)));
    const grow = (base, depth) => {
        const height = random.nextInt(4) + 1 + Number(depth === 0);
        for (let i = 0; i < height; i++) {
            const pos = relative(base, 'up', i + 1);
            if (!neighborsEmpty(pos, null)) return;
            plant(pos); plant(relative(pos, 'down'));
        }
        let branched = false;
        if (depth < 4) {
            const count = random.nextInt(4) + Number(depth === 0);
            for (let i = 0; i < count; i++) {
                const direction = horizontal[random.nextInt(4)], pos = relative(relative(base, 'up', height), direction);
                if (Math.abs(pos.x - origin.x) >= 8 || Math.abs(pos.z - origin.z) >= 8) continue;
                if (!air(pos) || !air(relative(pos, 'down')) || !neighborsEmpty(pos, opposite(direction))) continue;
                branched = true; plant(pos); plant(relative(pos, opposite(direction))); grow(pos, depth + 1);
            }
        }
        if (!branched) setBlock(directState({ id: 'minecraft:chorus_flower', properties: { age: '5' } }), relative(base, 'up', height), 2);
    };
    plant(origin); grow(origin, 0);
    return true;
}
