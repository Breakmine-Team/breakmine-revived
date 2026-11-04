import { blockName, relative, requireContext } from './feature-world.mjs';

const f = Math.fround;
// Java's integer ceil cannot preserve JS negative zero.
const ceil = value => Math.ceil(value) + 0;
const air = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(state));
const ice = state => ['minecraft:packed_ice', 'minecraft:blue_ice', 'minecraft:snow_block'].includes(blockName(state));

export function icebergEllipseDistance(x, z, center, a, b, angle) {
    const dx = x - center.x, dz = z - center.z;
    return Math.pow((dx * Math.cos(angle) - dz * Math.sin(angle)) / a, 2)
        + Math.pow((dx * Math.sin(angle) + dz * Math.cos(angle)) / b, 2) - 1;
}

export function icebergRoundRadius(random, y, height, radius) {
    const factor = f(3.5 - random.nextFloat());
    let value = f(f(1 - f(f(y * y) / f(height * factor))) * radius);
    if (height > 15 + random.nextInt(5)) {
        const adjusted = y < 3 + random.nextInt(6) ? Math.trunc(y / 2) : y;
        value = f(f(1 - f(adjusted / f(f(height * factor) * f(0.4)))) * radius);
    }
    return ceil(f(value / 2));
}

const ellipseRadius = (y, height, radius) => ceil(f(f(f(1 - f(f(y * y) / height)) * radius) / 2));
const ellipseC = (y, height, c) => y > 0 && height - y <= 3 ? c - (4 - (height - y)) : c;
function steepRadius(random, y, height, radius) {
    const factor = f(1 + f(random.nextFloat() / 2));
    return ceil(f(f(f(1 - f(y / f(height * factor))) * radius) / 2));
}

export function smoothIceberg(origin, radius, height, elliptical, ellipseBound, { context, directState, setBlock }) {
    const read = requireContext(context, 'getBlockState');
    const writeAir = pos => setBlock(directState('minecraft:air'), pos, 3);
    const bound = elliptical ? ellipseBound : Math.trunc(radius / 2);
    for (let x = -bound; x <= bound; x++) for (let z = -bound; z <= bound; z++) for (let y = 0; y <= height; y++) {
        const pos = { x: origin.x + x, y: origin.y + y, z: origin.z + z }, state = read(pos);
        if (!ice(state) && blockName(state) !== 'minecraft:snow') continue;
        if (air(read(relative(pos, 'down')))) { writeAir(pos); writeAir(relative(pos, 'up')); continue; }
        if (ice(state)) {
            const neighbors = ['west', 'east', 'north', 'south'].map(direction => read(relative(pos, direction)));
            if (neighbors.filter(state => !ice(state)).length >= 3) writeAir(pos);
        }
    }
}

export function placeIceberg(feature, position, random, options) {
    const { context, directState, setBlock } = options;
    if (!Number.isInteger(context?.seaLevel)) throw new TypeError('Iceberg placement requires context.seaLevel from the generator');
    const origin = { ...position, y: context.seaLevel }, read = requireContext(context, 'getBlockState');
    const write = (state, pos) => setBlock(state, pos, 3);
    const named = (name, properties = {}) => directState({ id: `minecraft:${name}`, properties });
    const snow = random.nextDouble() > 0.7, state = directState(feature.state);
    const angle = random.nextDouble() * 2 * Math.PI;
    const ellipseBound = 11 - random.nextInt(5), c = 3 + random.nextInt(3), elliptical = random.nextDouble() > 0.7;
    let height = elliptical ? random.nextInt(6) + 6 : random.nextInt(15) + 3;
    if (!elliptical && random.nextDouble() > 0.9) height += random.nextInt(19) + 7;
    const depth = Math.min(height + random.nextInt(11), 18);
    const radius = Math.min(height + random.nextInt(7) - random.nextInt(5), 11);
    const bound = elliptical ? ellipseBound : 11;
    const center = { x: 0, z: 0 };
    const generate = (x, y, z, round, ellipseA, totalHeight) => {
        const distance = elliptical ? icebergEllipseDistance(x, z, center, ellipseA, ellipseC(y, totalHeight, c), angle)
            : f(f(10 * Math.max(f(0.2), Math.min(f(0.8), random.nextFloat()))) / round) + x * x + z * z - round * round;
        if (!(distance < 0)) return;
        const edge = elliptical ? -0.5 : -6 - random.nextInt(3);
        if (distance > edge && random.nextDouble() > 0.9) return;
        const pos = { x: origin.x + x, y: origin.y + y, z: origin.z + z }, current = read(pos);
        const name = blockName(current);
        if (!air(current) && !['minecraft:snow_block', 'minecraft:ice', 'minecraft:water'].includes(name)) return;
        const snowAllowed = !elliptical || random.nextDouble() > 0.05;
        const divisor = elliptical ? 3 : 2;
        if (snow && name !== 'minecraft:water' && totalHeight - y <= random.nextInt(Math.max(1, Math.trunc(totalHeight / divisor))) + totalHeight * 0.6 && snowAllowed)
            write(named('snow_block'), pos);
        else write(state, pos);
    };
    for (let x = -bound; x < bound; x++) for (let z = -bound; z < bound; z++) for (let y = 0; y < height; y++) {
        const r = elliptical ? ellipseRadius(y, height, radius) : icebergRoundRadius(random, y, height, radius);
        if (elliptical || x < r) generate(x, y, z, r, bound, height);
    }
    smoothIceberg(origin, radius, height, elliptical, ellipseBound, options);
    for (let x = -bound; x < bound; x++) for (let z = -bound; z < bound; z++) for (let y = -1; y > -depth; y--) {
        const a = elliptical ? ceil(f(bound * f(1 - f(f(y * y) / f(depth * 8))))) : bound;
        const r = steepRadius(random, -y, depth, radius);
        if (x < r) generate(x, y, z, r, a, depth);
    }
    const cutOut = random.nextDouble() > (elliptical ? 0.1 : 0.7);
    if (cutOut) {
        const sx = random.nextBoolean() ? -1 : 1, sz = random.nextBoolean() ? -1 : 1;
        const half = Math.trunc(radius / 2);
        let ox = random.nextInt(Math.max(half - 2, 1));
        if (random.nextBoolean()) ox = half + 1 - random.nextInt(Math.max(radius - half - 1, 1));
        let oz = random.nextInt(Math.max(half - 2, 1));
        if (random.nextBoolean()) oz = half + 1 - random.nextInt(Math.max(radius - half - 1, 1));
        if (elliptical) ox = oz = random.nextInt(Math.max(ellipseBound - 5, 1));
        const cutCenter = { x: sx * ox, z: sz * oz };
        const cutAngle = elliptical ? angle + Math.PI / 2 : random.nextDouble() * 2 * Math.PI;
        const carve = (r, y, underwater) => {
            const a = r + 1 + Math.trunc(ellipseBound / 3), b = Math.min(r - 3, 3) + Math.trunc(c / 2) - 1;
            for (let x = -a; x < a; x++) for (let z = -a; z < a; z++) {
                if (!(icebergEllipseDistance(x, z, cutCenter, a, b, cutAngle) < 0)) continue;
                const pos = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
                if (!ice(read(pos))) continue;
                write(underwater ? named('water', { level: '0' }) : named('air'), pos);
                const above = relative(pos, 'up');
                if (!underwater && blockName(read(above)) === 'minecraft:snow') write(named('air'), above);
            }
        };
        for (let y = 0; y < height - 3; y++) carve(icebergRoundRadius(random, y, height, radius), y, false);
        for (let y = -1; y > -height + random.nextInt(5); y--) carve(steepRadius(random, -y, height, radius), y, true);
    }
    return true;
}
