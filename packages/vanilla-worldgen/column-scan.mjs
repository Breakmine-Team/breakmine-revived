import { relative } from './feature-world.mjs';

export function scanWorldgenColumn(origin, searchRange, read, passable, boundary) {
    if (!Number.isInteger(searchRange) || searchRange < 1 || searchRange > 512) throw new RangeError('Column search range must be 1..512');
    if (!passable(read(origin), origin)) return null;
    const scan = direction => {
        let pos = { ...origin };
        for (let distance = 1; distance < searchRange && passable(read(pos), pos); distance++) pos = relative(pos, direction);
        return boundary(read(pos), pos) ? pos.y : null;
    };
    const ceiling = scan('up'), floor = scan('down');
    return { ceiling, floor, height: ceiling == null || floor == null ? null : ceiling - floor - 1 };
}
