import { sampleIntProvider } from './value-providers.mjs';

function requireCallback(context, name) {
    if (typeof context?.[name] !== 'function') throw new TypeError(`Vegetation patch requires context.${name}`);
    return context[name];
}

function javaHashSetOrder(positions) {
    let capacity = 16;
    while (positions.length > capacity * 0.75) capacity *= 2;
    const hash = pos => Math.imul((Math.imul(pos.y, 31) + pos.z) | 0, 31) + pos.x | 0;
    return [...positions].sort((a, b) => {
        const ah = hash(a), bh = hash(b);
        const ai = (ah ^ (ah >>> 16)) & (capacity - 1);
        const bi = (bh ^ (bh >>> 16)) & (capacity - 1);
        return ai - bi || a.insertion - b.insertion;
    });
}

export function placeVegetationPatch(feature, origin, random, {
    context = {}, sampleGroundState, setBlock, placeVegetation
} = {}) {
    if (!feature || !['minecraft:vegetation_patch', 'minecraft:waterlogged_vegetation_patch'].includes(feature.type)) {
        throw new TypeError('Expected a compatible vegetation patch feature');
    }
    const waterlogged = feature.type === 'minecraft:waterlogged_vegetation_patch';
    if (!random || typeof random.nextFloat !== 'function' || typeof random.nextInt !== 'function') throw new TypeError('Vegetation patch requires a Java-compatible random source');
    for (const [name, callback] of Object.entries({ sampleGroundState, setBlock, placeVegetation })) {
        if (typeof callback !== 'function') throw new TypeError(`Vegetation patch requires ${name}`);
    }
    for (const name of ['getBlockState', 'isAir', 'isEmptyBlock', 'matchesBlockTag', 'isFaceSturdy']) requireCallback(context, name);
    if (waterlogged) {
        for (const name of ['getWaterState', 'hasProperty', 'getProperty', 'withProperty']) requireCallback(context, name);
    }
    if (!feature.replaceable || typeof feature.replaceable !== 'string' || !feature.replaceable.startsWith('#')) throw new TypeError('Vegetation patch replaceable must be a block tag');
    if (!feature.ground_state || !feature.vegetation_feature || !['floor', 'ceiling'].includes(feature.surface)) throw new TypeError('Malformed vegetation patch configuration');
    if (!Number.isInteger(feature.vertical_range) || feature.vertical_range < 1 || feature.vertical_range > 256) throw new RangeError('Invalid vegetation patch vertical range');
    for (const name of ['extra_bottom_block_chance', 'extra_edge_column_chance', 'vegetation_chance']) {
        if (!Number.isFinite(feature[name]) || feature[name] < 0 || feature[name] > 1) throw new RangeError(`Invalid vegetation patch ${name}`);
    }
    if (!origin || ![origin.x, origin.y, origin.z].every(Number.isInteger)) throw new TypeError('Vegetation patch origin must be an integer block position');

    const surfaceY = feature.surface === 'floor' ? -1 : 1;
    const surfaceDirection = { x: 0, y: surfaceY, z: 0 };
    const oppositeDirection = { x: 0, y: -surfaceY, z: 0 };
    const depthAt = (pos, depth) => {
        for (let layer = 0; layer < depth; layer++) {
            const state = sampleGroundState(feature.ground_state, pos);
            const current = context.getBlockState(pos);
            if (current?.name === state?.name) continue;
            if (!context.matchesBlockTag(current, feature.replaceable)) return layer > 0;
            setBlock(state, pos, 2);
            pos.y += surfaceY;
        }
        return true;
    };

    const radiusX = sampleIntProvider(feature.xz_radius, random) + 1;
    const radiusZ = sampleIntProvider(feature.xz_radius, random) + 1;
    const positions = [];
    const unique = new Set();
    for (let dx = -radiusX; dx <= radiusX; dx++) {
        const edgeX = Math.abs(dx) === radiusX;
        for (let dz = -radiusZ; dz <= radiusZ; dz++) {
            const edgeZ = Math.abs(dz) === radiusZ;
            if (edgeX && edgeZ) continue;
            if ((edgeX || edgeZ) && feature.extra_edge_column_chance > 0 &&
                Math.fround(random.nextFloat()) > Math.fround(feature.extra_edge_column_chance)) continue;

            const pos = { x: origin.x + dx, y: origin.y, z: origin.z + dz };
            let steps = 0;
            while (steps < feature.vertical_range && context.isAir(pos)) {
                pos.y += surfaceY;
                steps++;
            }
            steps = 0;
            while (steps < feature.vertical_range && !context.isAir(pos)) {
                pos.y -= surfaceY;
                steps++;
            }

            const ground = { x: pos.x, y: pos.y + surfaceY, z: pos.z };
            if (!context.isEmptyBlock(pos)) continue;
            const support = context.getBlockState(ground);
            if (!context.isFaceSturdy(support, ground, oppositeDirection)) continue;
            const groundPosition = { ...ground };

            let depth = sampleIntProvider(feature.depth, random);
            if (feature.extra_bottom_block_chance > 0 && Math.fround(random.nextFloat()) < Math.fround(feature.extra_bottom_block_chance)) depth++;
            if (!depthAt(ground, depth)) continue;
            const key = `${groundPosition.x},${groundPosition.y},${groundPosition.z}`;
            if (!unique.has(key)) {
                unique.add(key);
                positions.push({ ...groundPosition, insertion: positions.length });
            }
        }
    }

    let vegetationPositions = javaHashSetOrder(positions);
    if (waterlogged) {
        const exposedDirections = [
            { x: 0, y: 0, z: -1 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: -1, z: 0 }
        ];
        const enclosed = [];
        for (const pos of vegetationPositions) {
            const exposed = exposedDirections.some(direction => {
                const neighbor = { x: pos.x + direction.x, y: pos.y + direction.y, z: pos.z + direction.z };
                const face = { x: -direction.x, y: -direction.y, z: -direction.z };
                return !context.isFaceSturdy(context.getBlockState(neighbor), neighbor, face);
            });
            if (!exposed) enclosed.push({ x: pos.x, y: pos.y, z: pos.z, insertion: enclosed.length });
        }
        vegetationPositions = javaHashSetOrder(enclosed);
        if (vegetationPositions.length > 0) {
            const water = context.getWaterState();
            if (water == null) throw new TypeError('Waterlogged vegetation patch requires a water block state');
            for (const pos of vegetationPositions) setBlock(water, pos, 2);
        }
    }

    for (const pos of vegetationPositions) {
        if (feature.vegetation_chance > 0 && Math.fround(random.nextFloat()) < Math.fround(feature.vegetation_chance)) {
            const target = { x: pos.x, y: pos.y - surfaceY - (waterlogged ? 1 : 0), z: pos.z };
            if (placeVegetation(feature.vegetation_feature, target) && waterlogged) {
                const state = context.getBlockState(pos);
                if (context.hasProperty(state, 'waterlogged')) {
                    const waterloggedValue = context.getProperty(state, 'waterlogged');
                    if (waterloggedValue === false || waterloggedValue === 'false') {
                        setBlock(context.withProperty(state, 'waterlogged', true), pos, 2);
                    }
                }
            }
        }
    }
    return vegetationPositions.length > 0;
}
