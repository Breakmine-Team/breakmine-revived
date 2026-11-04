import { blockName, relative, requireContext } from './feature-world.mjs';
import { scanWorldgenColumn } from './column-scan.mjs';
import { intProviderBounds, sampleFloatProvider } from './value-providers.mjs';
import { createSpeleothemTools, isEmptyOrWater, isEmptyOrWaterOrLava, speleothemHeight, speleothemSin, speleothemCos, f32, clamp } from './speleothem-utils.mjs';

export function placeLargeDripstone(feature, origin, random, options) {
    const { context, directState, setBlock } = options;
    const tools = createSpeleothemTools({ ...feature, base_block: 'minecraft:dripstone_block', pointed_block: 'minecraft:pointed_dripstone' }, options);
    const { read, isBase } = tools;
    if (!isEmptyOrWater(read(origin))) return false;
    const column = scanWorldgenColumn(origin, feature.floor_to_ceiling_search_range ?? 30, read, isEmptyOrWater, state => isBase(state) || blockName(state) === 'minecraft:lava');
    if (!column || column.height == null || column.height < 4) return false;
    const bounds = intProviderBounds(feature.column_radius);
    if (bounds.min < 1 || bounds.max > 16 || bounds.min > bounds.max) throw new RangeError('Large dripstone radius bounds must be 1..16');
    const maxRadius = clamp(Math.trunc(f32(column.height * f32(feature.max_column_radius_to_cave_height_ratio))), bounds.min, bounds.max);
    const radius = bounds.min + random.nextInt(maxRadius - bounds.min + 1);
    const make = (root, up, bluntness) => ({ root, up, radius, bluntness: sampleFloatProvider(bluntness, random), scale: sampleFloatProvider(feature.height_scale, random) });
    const down = make({ ...origin, y: column.ceiling - 1 }, false, feature.stalactite_bluntness);
    const up = make({ ...origin, y: column.floor + 1 }, true, feature.stalagmite_bluntness);
    let offset = pos => pos;
    if ([down, up].every(v => v.radius >= feature.min_radius_for_wind && v.bluntness >= f32(feature.min_bluntness_for_wind))) {
        const speed = sampleFloatProvider(feature.wind_speed, random), angle = f32(random.nextFloat() * f32(Math.PI));
        const windX = f32(speleothemCos(angle) * speed), windZ = f32(speleothemSin(angle) * speed), maxOffset = 16 - radius;
        offset = pos => ({ x: pos.x + clamp(Math.floor((origin.y - pos.y) * windX), -maxOffset, maxOffset), y: pos.y,
            z: pos.z + clamp(Math.floor((origin.y - pos.y) * windZ), -maxOffset, maxOffset) });
    }
    const heightAt = (drip, distance) => Math.trunc(speleothemHeight(distance, drip.radius, drip.scale, drip.bluntness));
    const embedded = (pos, radius) => {
        if (isEmptyOrWaterOrLava(read(pos))) return false;
        const step = f32(6 / radius);
        for (let angle = 0; angle < f32(Math.PI * 2); angle = f32(angle + step)) {
            const x = Math.trunc(f32(speleothemCos(angle) * radius)), z = Math.trunc(f32(speleothemSin(angle) * radius));
            if (isEmptyOrWaterOrLava(read({ x: pos.x + x, y: pos.y, z: pos.z + z }))) return false;
        }
        return true;
    };
    const moveBack = drip => {
        while (drip.radius > 1) {
            let pos = { ...drip.root };
            const limit = Math.min(10, heightAt(drip, 0));
            for (let i = 0; i < limit; i++, pos = relative(pos, drip.up ? 'down' : 'up')) {
                if (blockName(read(pos)) === 'minecraft:lava') return false;
                if (embedded(offset(pos), drip.radius)) { drip.root = pos; return true; }
            }
            drip.radius = Math.trunc(drip.radius / 2);
        }
        return false;
    };
    const place = drip => {
        for (let x = -drip.radius; x <= drip.radius; x++) for (let z = -drip.radius; z <= drip.radius; z++) {
            const distance = f32(Math.sqrt(f32(x * x + z * z)));
            if (distance > drip.radius) continue;
            let height = heightAt(drip, distance);
            if (height <= 0) continue;
            if (random.nextFloat() < 0.2) {
                const shortening = f32(f32(0.8) + f32(random.nextFloat() * f32(1 - f32(0.8))));
                height = Math.trunc(f32(height * shortening));
            }
            let pos = { x: drip.root.x + x, y: drip.root.y, z: drip.root.z + z }, started = false;
            const maxY = drip.up ? requireContext(context, 'getHeight')('WORLD_SURFACE_WG', pos.x, pos.z) : 0x7fffffff;
            for (let i = 0; i < height; i++, pos = relative(pos, drip.up ? 'up' : 'down')) {
                if (pos.y >= maxY) break;
                const target = offset(pos), state = read(target);
                if (isEmptyOrWaterOrLava(state)) { started = true; setBlock(directState('minecraft:dripstone_block'), target, 2); }
                else if (started && requireContext(context, 'isBlockInTag')(state, 'minecraft:base_stone_overworld', target)) break;
            }
        }
    };
    const downFits = moveBack(down), upFits = moveBack(up);
    if (downFits) place(down);
    if (upFits) place(up);
    return true;
}
