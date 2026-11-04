import { sampleIntProvider } from './value-providers.mjs';
import { DIRECTIONS, relative, requireContext, blockName, boxPositions, manhattanPositions, createBlockPredicateTester, sameBlockState } from './feature-world.mjs';

export const ENVIRONMENT_FEATURE_TYPES = new Set([
    'bamboo', 'blue_ice', 'delta_feature', 'underwater_magma', 'end_platform', 'void_start_platform',
    'huge_brown_mushroom', 'huge_red_mushroom', 'spike'
].map(type => `minecraft:${type}`));

export function placeEnvironmentFeature(feature, origin, random, { context, directState, sampleState, setBlock, canSurvive }) {
    const read = pos => requireContext(context, 'getBlockState')(pos);
    const air = pos => requireContext(context, 'isAir')(pos);
    const test = context?.testBlockPredicate?.bind(context) ?? createBlockPredicateTester(context);
    const write = (state, pos, flags = 2) => setBlock(state, { ...pos }, flags);
    const named = (name, properties = {}) => directState({ id: `minecraft:${name}`, properties });
    const bounds = () => {
        if (!Number.isInteger(context?.minY) || !Number.isInteger(context?.maxY)) throw new TypeError('Environment feature requires context.minY/maxY (exclusive upper bound)');
        return context;
    };
    switch (feature.type) {
        case 'minecraft:bamboo': {
            if (!air(origin)) return false;
            if (!canSurvive(named('bamboo', { age: '0', leaves: 'none', stage: '0' }), origin)) return true;
            const height = random.nextInt(12) + 5;
            if (random.nextFloat() < Math.fround(feature.probability)) {
                const radius = random.nextInt(4) + 1;
                for (let x = origin.x - radius; x <= origin.x + radius; x++) for (let z = origin.z - radius; z <= origin.z + radius; z++) {
                    if ((x - origin.x) ** 2 + (z - origin.z) ** 2 > radius ** 2) continue;
                    const pos = { x, y: requireContext(context, 'getHeight')('WORLD_SURFACE', x, z) - 1, z };
                    if (requireContext(context, 'isBlockInTag')(read(pos), 'minecraft:beneath_bamboo_podzol_replaceable')) write(named('podzol', { snowy: 'false' }), pos);
                }
            }
            const bamboo = (leaves, stage = '0') => named('bamboo', { age: '1', leaves, stage });
            let pos = { ...origin };
            for (let i = 0; i < height && air(pos); i++, pos = relative(pos, 'up')) write(bamboo('none'), pos);
            if (pos.y - origin.y >= 3) {
                write(bamboo('large', '1'), pos);
                write(bamboo('large'), relative(pos, 'down'));
                write(bamboo('small'), relative(pos, 'down', 2));
            }
            return true;
        }
        case 'minecraft:blue_ice': {
            if (!Number.isInteger(context?.seaLevel)) throw new TypeError('Blue ice requires context.seaLevel');
            if (origin.y > context.seaLevel - 1) return false;
            if (blockName(read(origin)) !== 'minecraft:water' && blockName(read(relative(origin, 'down'))) !== 'minecraft:water') return false;
            if (!DIRECTIONS.slice(1).some(d => blockName(read(relative(origin, d))) === 'minecraft:packed_ice')) return false;
            const state = named('blue_ice');
            write(state, origin);
            for (let i = 0; i < 200; i++) {
                const dy = random.nextInt(5) - random.nextInt(6);
                const spread = 3 + (dy < 2 ? Math.trunc(dy / 2) : 0);
                if (spread < 1) continue;
                const pos = { x: origin.x + random.nextInt(spread) - random.nextInt(spread), y: origin.y + dy, z: origin.z + random.nextInt(spread) - random.nextInt(spread) };
                if (!air(pos) && !['minecraft:water', 'minecraft:packed_ice', 'minecraft:ice'].includes(blockName(read(pos)))) continue;
                if (DIRECTIONS.some(d => blockName(read(relative(pos, d))) === 'minecraft:blue_ice')) write(state, pos);
            }
            return true;
        }
        case 'minecraft:delta_feature': {
            const rimDraw = random.nextDouble() < 0.9;
            const ox = rimDraw ? sampleIntProvider(feature.rim_size, random) : 0;
            const oz = rimDraw ? sampleIntProvider(feature.rim_size, random) : 0;
            const rimEnabled = rimDraw && ox !== 0 && oz !== 0;
            const rx = sampleIntProvider(feature.size, random), rz = sampleIntProvider(feature.size, random);
            const contents = directState(feature.contents), rim = directState(feature.rim);
            const blocked = new Set(['bedrock', 'nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_wart', 'chest', 'spawner'].map(n => `minecraft:${n}`));
            const clear = pos => {
                const name = blockName(read(pos));
                return name !== contents.name && !blocked.has(name) && DIRECTIONS.every(d => air(relative(pos, d)) === (d === 'up'));
            };
            let placed = false;
            for (const pos of manhattanPositions(origin, rx, 0, rz, Math.max(rx, rz))) {
                if (!clear(pos)) continue;
                if (rimEnabled) { write(rim, pos, 3); placed = true; }
                const shifted = { ...pos, x: pos.x + ox, z: pos.z + oz };
                if (clear(shifted)) { write(contents, shifted, 3); placed = true; }
            }
            return placed;
        }
        case 'minecraft:underwater_magma': {
            if (blockName(read(origin)) !== 'minecraft:water') return false;
            let floor = null;
            for (const direction of ['up', 'down']) {
                let pos = { ...origin };
                for (let i = 1; i < feature.floor_search_range && blockName(read(pos)) === 'minecraft:water'; i++) pos = relative(pos, direction);
                if (blockName(read(pos)) !== 'minecraft:water' && direction === 'down') floor = pos.y;
            }
            if (floor == null) return false;
            const full = (pos, face) => requireContext(context, 'isFaceOcclusionFull')(pos, face);
            let count = 0;
            const radius = feature.placement_radius_around_floor;
            for (const pos of boxPositions({ ...origin, y: floor }, radius, radius, radius)) {
                if (random.nextFloat() >= Math.fround(feature.placement_probability_per_valid_position)) continue;
                if (air(pos) || blockName(read(pos)) === 'minecraft:water' || !full(relative(pos, 'down'), 'up')) continue;
                const opposite = { north: 'south', east: 'west', south: 'north', west: 'east' };
                if (!['north', 'east', 'south', 'west'].every(d => full(relative(pos, d), opposite[d]))) continue;
                write(named('magma_block'), pos); count++;
            }
            return count > 0;
        }
        case 'minecraft:end_platform': {
            for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy < 3; dy++) {
                const pos = { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz };
                const name = dy === -1 ? 'obsidian' : 'air';
                if (blockName(read(pos)) !== `minecraft:${name}`) write(named(name), pos, 3);
            }
            return true;
        }
        case 'minecraft:void_start_platform': {
            const cx = Math.floor(origin.x / 16), cz = Math.floor(origin.z / 16);
            if (Math.max(Math.abs(cx), Math.abs(cz)) > 1) return true;
            for (let z = cz * 16; z <= cz * 16 + 15; z++) for (let x = cx * 16; x <= cx * 16 + 15; x++) {
                if (Math.max(Math.abs(x - 8), Math.abs(z - 8)) > 16) continue;
                write(named(x === 8 && z === 8 ? 'cobblestone' : 'stone'), { x, y: origin.y + 3, z });
            }
            return true;
        }
        case 'minecraft:huge_brown_mushroom':
        case 'minecraft:huge_red_mushroom': {
            let height = random.nextInt(3) + 4;
            if (random.nextInt(12) === 0) height *= 2;
            const { minY, maxY } = bounds();
            if (origin.y < minY + 1 || origin.y + height + 1 > maxY - 1 || !test(feature.can_place_on, relative(origin, 'down'))) return false;
            const brown = feature.type === 'minecraft:huge_brown_mushroom';
            const radius = feature.foliage_radius ?? 2;
            for (let dy = 0; dy <= height; dy++) {
                const r = brown && dy > 3 ? radius : 0;
                for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
                    const pos = { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz };
                    if (!air(pos) && !requireContext(context, 'isBlockInTag')(read(pos), 'minecraft:leaves')) return false;
                }
            }
            const placeMushroom = (source, pos, properties) => {
                const state = properties ? directState({ id: source.name, properties: { ...source.properties, ...properties } }) : source;
                if (air(pos) || requireContext(context, 'isBlockInTag')(read(pos), 'minecraft:replaceable_by_mushrooms')) write(state, pos, 3);
            };
            const start = brown ? height : height - 3;
            for (let dy = start; dy <= height; dy++) {
                const r = brown || dy < height ? radius : radius - 1;
                for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
                    const west = dx === -r, east = dx === r, north = dz === -r, south = dz === r;
                    const edgeX = west || east, edgeZ = north || south;
                    if (brown ? edgeX && edgeZ : dy < height && edgeX === edgeZ) continue;
                    const source = sampleState(feature.cap_provider, origin);
                    const keys = brown ? ['west', 'east', 'north', 'south'] : ['west', 'east', 'north', 'south', 'up'];
                    let properties;
                    if (keys.every(key => Object.hasOwn(source.properties, key))) {
                        properties = brown ? {
                            west: String(west || edgeZ && dx === 1 - radius), east: String(east || edgeZ && dx === radius - 1),
                            north: String(north || edgeX && dz === 1 - radius), south: String(south || edgeX && dz === radius - 1)
                        } : { up: String(dy >= height - 1), west: String(dx < -(radius - 2)), east: String(dx > radius - 2), north: String(dz < -(radius - 2)), south: String(dz > radius - 2) };
                    }
                    placeMushroom(source, { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz }, properties);
                }
            }
            for (let dy = 0; dy < height; dy++) placeMushroom(sampleState(feature.stem_provider, origin), relative(origin, 'up', dy));
            return true;
        }
        case 'minecraft:spike': {
            let center = { ...origin };
            while (air(center) && center.y > bounds().minY + 2) center = relative(center, 'down');
            if (!test(feature.can_place_on, center)) return false;
            center = relative(center, 'up', random.nextInt(4));
            const height = random.nextInt(4) + 7, width = Math.trunc(height / 4) + random.nextInt(2);
            if (width > 1 && random.nextInt(60) === 0) center = relative(center, 'up', 10 + random.nextInt(30));
            const state = directState(feature.state);
            const replace = pos => air(pos) || test(feature.can_replace, pos);
            for (let dy = 0; dy < height; dy++) {
                const radius = Math.fround(Math.fround(1 - Math.fround(dy / height)) * width), r = Math.ceil(radius);
                for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
                    const x = Math.abs(dx) - 0.25, z = Math.abs(dz) - 0.25;
                    if ((dx !== 0 || dz !== 0) && Math.fround(Math.fround(x * x) + Math.fround(z * z)) > Math.fround(radius * radius)) continue;
                    if ((dx === -r || dx === r || dz === -r || dz === r) && random.nextFloat() > 0.75) continue;
                    const top = { x: center.x + dx, y: center.y + dy, z: center.z + dz };
                    if (replace(top)) write(state, top, 3);
                    const bottom = { ...top, y: center.y - dy };
                    if (dy !== 0 && r > 1 && replace(bottom)) write(state, bottom, 3);
                }
            }
            const radius = Math.max(0, Math.min(1, width - 1));
            for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
                let pos = { x: center.x + dx, y: center.y - 1, z: center.z + dz };
                let length = Math.abs(dx) === 1 && Math.abs(dz) === 1 ? random.nextInt(5) : 50;
                while (pos.y > 50) {
                    const current = read(pos);
                    if (!replace(pos) && !sameBlockState(current, state)) break;
                    write(state, pos, 3); pos = relative(pos, 'down');
                    if (--length <= 0) { pos = relative(pos, 'down', random.nextInt(5) + 1); length = random.nextInt(5); }
                }
            }
            return true;
        }
        default: throw new Error(`Unsupported environment feature: ${feature.type}`);
    }
}
