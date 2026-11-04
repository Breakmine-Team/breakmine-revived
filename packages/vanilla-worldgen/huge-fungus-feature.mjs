import { blockName, relative, requireContext, createBlockPredicateTester } from './feature-world.mjs';

export function placeHugeFungus(feature, origin, random, { context, directState, setBlock }) {
    const read = requireContext(context, 'getBlockState');
    const air = pos => requireContext(context, 'isAir')(pos);
    const replaceable = pos => requireContext(context, 'isReplaceable')(pos);
    const test = context?.testBlockPredicate?.bind(context) ?? createBlockPredicateTester(context);
    const planted = feature.planted ?? false;
    if (blockName(read(relative(origin, 'down'))) !== blockName(feature.valid_base_block)) return false;
    let height = random.nextInt(10) + 4;
    if (random.nextInt(12) === 0) height *= 2;
    if (!planted) {
        if (!Number.isInteger(context?.generationDepth)) throw new TypeError('Huge fungus requires generator generationDepth');
        if (origin.y + height + 1 >= context.generationDepth) return false;
    }
    const huge = !planted && random.nextFloat() < Math.fround(0.06);
    const decode = value => {
        if (typeof value !== 'string') return directState(value);
        const state = requireContext(context, 'getDefaultBlockState')(blockName(value));
        return directState({ id: blockName(state), properties: state.properties ?? {} });
    };
    const stem = decode(feature.stem_state), hat = decode(feature.hat_state), decor = decode(feature.decor_state);
    const crimson = hat.name === 'minecraft:nether_wart_block';
    const canReplace = (pos, allowConfigured) => replaceable(pos) || allowConfigured && test(feature.replaceable_blocks, pos);
    const clear = pos => {
        if (planted && !air(relative(pos, 'down'))) requireContext(context, 'destroyBlock')(pos, true);
    };
    const weeping = pos => {
        let cursor = relative(pos, 'down');
        if (!air(cursor)) return;
        let length = random.nextInt(5) + 1;
        if (random.nextInt(7) === 0) length *= 2;
        for (let i = 0; i <= length; i++, cursor = relative(cursor, 'down')) {
            if (!air(cursor)) continue;
            if (i === length || !air(relative(cursor, 'down'))) {
                setBlock(directState({ id: 'minecraft:weeping_vines', properties: { age: String(random.nextInt(3) + 23) } }), cursor, 2);
                break;
            }
            setBlock(directState('minecraft:weeping_vines_plant'), cursor, 2);
        }
    };
    const hatBlock = (pos, decorChance, hatChance, vineChance) => {
        if (random.nextFloat() < Math.fround(decorChance)) setBlock(decor, pos, 3);
        else if (random.nextFloat() < Math.fround(hatChance)) {
            setBlock(hat, pos, 3);
            if (random.nextFloat() < Math.fround(vineChance)) weeping(pos);
        }
    };
    const drop = pos => {
        if (blockName(read(relative(pos, 'down'))) === hat.name) setBlock(hat, pos, 3);
        else if (random.nextFloat() < 0.15) {
            setBlock(hat, pos, 3);
            if (crimson && random.nextInt(11) === 0) weeping(pos);
        }
    };
    setBlock(directState('minecraft:air'), origin, 260);
    const stemRadius = huge ? 1 : 0;
    for (let x = -stemRadius; x <= stemRadius; x++) for (let z = -stemRadius; z <= stemRadius; z++) for (let y = 0; y < height; y++) {
        const pos = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
        if (!canReplace(pos, true)) continue;
        const corner = huge && Math.abs(x) === stemRadius && Math.abs(z) === stemRadius;
        if (planted) { clear(pos); setBlock(stem, pos, 3); }
        else if (!corner || random.nextFloat() < Math.fround(0.1)) setBlock(stem, pos, 3);
    }
    const capHeight = Math.min(random.nextInt(1 + Math.trunc(height / 3)) + 5, height), bottom = height - capHeight;
    for (let y = bottom; y <= height; y++) {
        let radius = y < height - random.nextInt(3) ? 2 : 1;
        if (capHeight > 8 && y < bottom + 4) radius = 3;
        if (huge) radius++;
        for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
            const pos = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
            if (!canReplace(pos, false)) continue;
            clear(pos);
            const edgeX = Math.abs(x) === radius, edgeZ = Math.abs(z) === radius;
            const interior = !edgeX && !edgeZ && y !== height;
            if (y < bottom + 3) { if (!interior) drop(pos); }
            else if (interior) hatBlock(pos, 0.1, 0.2, crimson ? 0.1 : 0);
            else if (edgeX && edgeZ) hatBlock(pos, 0.01, 0.7, crimson ? 0.083 : 0);
            else hatBlock(pos, 0.0005, 0.98, crimson ? 0.07 : 0);
        }
    }
    return true;
}
