import { relative, DIRECTIONS } from './feature-world.mjs';
import { createSpeleothemTools, SPELEOTHEM_HORIZONTAL, isEmptyOrWater, f32 } from './speleothem-utils.mjs';

export function placeSpeleothem(feature, origin, random, options) {
    const { read, isBase, placeBase, grow } = createSpeleothemTools(feature, options);
    const ceiling = isBase(read(relative(origin, 'up'))), floor = isBase(read(relative(origin, 'down')));
    const direction = ceiling && floor ? random.nextBoolean() ? 'down' : 'up' : ceiling ? 'down' : floor ? 'up' : null;
    if (direction == null) return false;
    const base = relative(origin, direction === 'up' ? 'down' : 'up');
    placeBase(base);
    for (const side of SPELEOTHEM_HORIZONTAL) {
        if (random.nextFloat() > f32(feature.chance_of_directional_spread ?? 0.7)) continue;
        const first = relative(base, side); placeBase(first);
        if (random.nextFloat() > f32(feature.chance_of_spread_radius2 ?? 0.5)) continue;
        const second = relative(first, DIRECTIONS[random.nextInt(6)]); placeBase(second);
        if (random.nextFloat() > f32(feature.chance_of_spread_radius3 ?? 0.5)) continue;
        placeBase(relative(second, DIRECTIONS[random.nextInt(6)]));
    }
    const height = random.nextFloat() < f32(feature.chance_of_taller_generation ?? 0.2) && isEmptyOrWater(read(relative(origin, direction))) ? 2 : 1;
    grow(origin, direction, height, false);
    return true;
}
