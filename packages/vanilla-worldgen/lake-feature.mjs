import { createBlockPredicateTester, requireContext, relative, blockName, sameBlockState } from './feature-world.mjs';

export function placeLake(feature, origin, random, { context, sampleState, directState, setBlock, scheduleTick }) {
    if (!Number.isInteger(context?.minY)) throw new TypeError('Lake placement requires context.minY');
    if (origin.y <= context.minY + 4) return false;
    const base = { x: origin.x - 8, y: origin.y - 4, z: origin.z - 8 };
    const index = (x, y, z) => (x * 16 + z) * 8 + y;
    const mask = new Uint8Array(2048);
    const ellipsoids = random.nextInt(4) + 4;
    for (let i = 0; i < ellipsoids; i++) {
        const sx = random.nextDouble() * 6 + 3, sy = random.nextDouble() * 4 + 2, sz = random.nextDouble() * 6 + 3;
        const cx = random.nextDouble() * (16 - sx - 2) + 1 + sx / 2;
        const cy = random.nextDouble() * (8 - sy - 4) + 2 + sy / 2;
        const cz = random.nextDouble() * (16 - sz - 2) + 1 + sz / 2;
        for (let x = 1; x < 15; x++) for (let z = 1; z < 15; z++) for (let y = 1; y < 7; y++) {
            const dx = (x - cx) / (sx / 2), dy = (y - cy) / (sy / 2), dz = (z - cz) / (sz / 2);
            if (dx * dx + dy * dy + dz * dz < 1) mask[index(x, y, z)] = 1;
        }
    }
    const fluid = sampleState(feature.fluid, base);
    const read = requireContext(context, 'getBlockState');
    const test = context?.testBlockPredicate?.bind(context) ?? createBlockPredicateTester(context);
    const position = (x, y, z) => ({ x: base.x + x, y: base.y + y, z: base.z + z });
    const boundary = (x, y, z) => !mask[index(x, y, z)] && (
        x < 15 && mask[index(x + 1, y, z)] || x > 0 && mask[index(x - 1, y, z)] ||
        z < 15 && mask[index(x, y, z + 1)] || z > 0 && mask[index(x, y, z - 1)] ||
        y < 7 && mask[index(x, y + 1, z)] || y > 0 && mask[index(x, y - 1, z)]
    );
    const markAbove = pos => {
        for (let i = 0; i < 2; i++) {
            pos = relative(pos, 'up');
            if (requireContext(context, 'isAir')(pos)) break;
            requireContext(context, 'markPosForPostProcessing')(pos);
        }
    };
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
        if (!boundary(x, y, z)) continue;
        const pos = position(x, y, z);
        if (y >= 4 && requireContext(context, 'isLiquid')(pos)) return false;
        if (y < 4 && !requireContext(context, 'isSolid')(pos) && !sameBlockState(read(pos), fluid)) return false;
        if (!test(feature.can_place_feature, pos)) return false;
    }
    const caveAir = directState('minecraft:cave_air');
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
        if (!mask[index(x, y, z)]) continue;
        const pos = position(x, y, z);
        if (!test(feature.can_replace_with_air_or_fluid, pos)) continue;
        setBlock(y >= 4 ? caveAir : fluid, pos, 2);
        if (y >= 4) {
            if (typeof scheduleTick !== 'function') throw new TypeError('Lake air placement requires scheduleTick');
            scheduleTick(caveAir, pos, 0); markAbove(pos);
        }
    }
    const barrier = sampleState(feature.barrier, base);
    if (!['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(barrier))) {
        for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
            if (!boundary(x, y, z) || y >= 4 && random.nextInt(2) === 0) continue;
            const pos = position(x, y, z);
            if (!requireContext(context, 'isSolid')(pos) || !test(feature.can_replace_with_barrier, pos)) continue;
            setBlock(barrier, pos, 2); markAbove(pos);
        }
    }
    if (requireContext(context, 'blockFluidIsInTag')(fluid, 'minecraft:water')) {
        for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
            const pos = position(x, 4, z);
            if (requireContext(context, 'shouldFreeze')(pos, false, pos) && test(feature.can_replace_with_air_or_fluid, pos)) setBlock(directState('minecraft:ice'), pos, 2);
        }
    }
    return true;
}
