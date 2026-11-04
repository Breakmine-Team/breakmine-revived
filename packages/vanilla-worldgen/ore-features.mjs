import { DIRECTIONS, relative, requireContext, blockName } from './feature-world.mjs';

export function testOreRule(rule, state, pos, random, context) {
    switch (rule?.predicate_type?.replace(/^minecraft:/, '')) {
        case 'always_true': return true;
        case 'block_match': return blockName(state) === blockName(rule.block);
        case 'blockstate_match': {
            const expected = rule.block_state;
            return blockName(state) === blockName(expected) && Object.entries(expected.properties ?? {}).every(([key, value]) => state.properties?.[key] === value);
        }
        case 'tag_match': return requireContext(context, 'isBlockInTag')(state, rule.tag);
        case 'height_match': return pos.y >= rule.min_inclusive && pos.y <= rule.max_inclusive;
        case 'not': return !testOreRule(rule.rule, state, pos, random, context);
        case 'any_of': return rule.rules.some(value => testOreRule(value, state, pos, random, context));
        case 'all_of': return rule.rules.every(value => testOreRule(value, state, pos, random, context));
        case 'random_block_match': return blockName(state) === blockName(rule.block) && random.nextFloat() < Math.fround(rule.probability);
        case 'random_blockstate_match': return testOreRule({ ...rule, predicate_type: 'minecraft:blockstate_match' }, state, pos, random, context) && random.nextFloat() < Math.fround(rule.probability);
        default: throw new Error(`Unsupported ore rule test: ${rule?.predicate_type}`);
    }
}

export function canPlaceOre(target, state, pos, chance, random, context) {
    if (!testOreRule(target.target, state, pos, random, context)) return false;
    chance = Math.fround(chance);
    if (chance <= 0 || (chance < 1 && random.nextFloat() >= chance)) return true;
    return !DIRECTIONS.some(direction => requireContext(context, 'isAir')(relative(pos, direction)));
}

let sineTable;
function tableSin(angle) {
    sineTable ??= Float32Array.from({ length: 65536 }, (_, i) => Math.sin(i * Math.PI * 2 / 65536));
    return sineTable[Math.trunc(angle * 10430.378350470453) & 65535];
}

export function placeOreFeature(feature, origin, random, { context, directState, setBlock }) {
    if (!Number.isInteger(feature.size) || feature.size < 0 || feature.size > 64) throw new RangeError('Ore feature size must be 0..64');
    if (!Array.isArray(feature.targets)) throw new TypeError('Ore feature requires targets');
    const chance = feature.discard_chance_on_air_exposure ?? 0;
    if (!Number.isFinite(chance) || chance < 0 || chance > 1) throw new RangeError('Invalid ore air-exposure chance');
    const read = requireContext(context, 'getBlockState');
    const choose = pos => {
        const state = read(pos);
        for (const target of feature.targets) if (canPlaceOre(target, state, pos, chance, random, context)) return directState(target.state);
        return null;
    };
    if (feature.type === 'minecraft:scattered_ore') {
        const count = random.nextInt(feature.size + 1);
        for (let i = 0; i < count; i++) {
            const span = Math.min(i, 7);
            const offset = () => Math.floor(Math.fround(Math.fround(random.nextFloat() - random.nextFloat()) * span) + 0.5);
            const pos = { x: origin.x + offset(), y: origin.y + offset(), z: origin.z + offset() };
            const state = choose(pos);
            if (state) setBlock(state, pos, 2);
        }
        return true;
    }
    if (feature.type !== 'minecraft:ore') throw new Error(`Unsupported ore feature: ${feature.type}`);
    const angle = Math.fround(random.nextFloat() * Math.fround(Math.PI));
    const reach = Math.fround(feature.size / 8);
    const padding = Math.ceil(Math.fround(Math.fround(Math.fround(feature.size / 16) * 2) + 1) / 2);
    const sin = Math.sin(angle) * reach, cos = Math.cos(angle) * reach;
    const from = { x: origin.x + sin, y: origin.y + random.nextInt(3) - 2, z: origin.z + cos };
    const to = { x: origin.x - sin, y: origin.y + random.nextInt(3) - 2, z: origin.z - cos };
    const base = { x: origin.x - Math.ceil(reach) - padding, y: origin.y - 2 - padding, z: origin.z - Math.ceil(reach) - padding };
    const width = 2 * (Math.ceil(reach) + padding), height = 2 * (2 + padding);
    const getHeight = requireContext(context, 'getHeight');
    let intersects = false;
    heightCheck: for (let x = base.x; x <= base.x + width; x++) for (let z = base.z; z <= base.z + width; z++) {
        if (base.y <= getHeight('OCEAN_FLOOR_WG', x, z)) { intersects = true; break heightCheck; }
    }
    if (!intersects) return false;
    const spheres = [];
    for (let i = 0; i < feature.size; i++) {
        const t = Math.fround(i / feature.size);
        const r = random.nextDouble() * feature.size / 16;
        spheres.push({ x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y), z: from.z + t * (to.z - from.z),
            r: (Math.fround(tableSin(Math.fround(Math.fround(Math.PI) * t)) + 1) * r + 1) / 2 });
    }
    for (let i = 0; i < spheres.length - 1; i++) {
        const a = spheres[i];
        if (a.r <= 0) continue;
        for (let j = i + 1; j < spheres.length; j++) {
            const b = spheres[j];
            if (b.r <= 0) continue;
            const dr = a.r - b.r;
            if (dr * dr > (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) {
                if (dr > 0) b.r = -1; else a.r = -1;
            }
        }
    }
    if (!Number.isInteger(context?.minY) || !Number.isInteger(context?.maxY)) throw new TypeError('Ore feature requires context.minY/maxY (exclusive upper bound)');
    const ensureCanWrite = requireContext(context, 'ensureCanWrite');
    const hasSection = requireContext(context, 'hasWritableSection');
    const writeSection = requireContext(context, 'setBlockInSection');
    const visited = new Set();
    let count = 0;
    for (const sphere of spheres) {
        if (sphere.r < 0) continue;
        const lo = { x: Math.max(Math.floor(sphere.x - sphere.r), base.x), y: Math.max(Math.floor(sphere.y - sphere.r), base.y), z: Math.max(Math.floor(sphere.z - sphere.r), base.z) };
        const hi = { x: Math.max(Math.floor(sphere.x + sphere.r), lo.x), y: Math.max(Math.floor(sphere.y + sphere.r), lo.y), z: Math.max(Math.floor(sphere.z + sphere.r), lo.z) };
        for (let x = lo.x; x <= hi.x; x++) {
            const dx = ((x + 0.5 - sphere.x) / sphere.r) ** 2;
            if (dx >= 1) continue;
            for (let y = lo.y; y <= hi.y; y++) {
                const dxy = dx + ((y + 0.5 - sphere.y) / sphere.r) ** 2;
                if (dxy >= 1) continue;
                for (let z = lo.z; z <= hi.z; z++) {
                    if (dxy + ((z + 0.5 - sphere.z) / sphere.r) ** 2 >= 1 || y < context.minY || y >= context.maxY) continue;
                    const index = x - base.x + (y - base.y) * width + (z - base.z) * width * height;
                    if (visited.has(index)) continue;
                    visited.add(index);
                    const pos = { x, y, z };
                    if (!ensureCanWrite(pos) || !hasSection(pos)) continue;
                    const state = choose(pos);
                    if (state) { writeSection(state, pos, false); count++; }
                }
            }
        }
    }
    return count > 0;
}
