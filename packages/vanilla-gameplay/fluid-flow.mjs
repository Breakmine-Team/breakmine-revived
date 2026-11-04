import reference from './generated/fluid-flow.json' with { type: 'json' };
import { isFluidType } from '../vanilla-worldgen/fluid-state.mjs';

const blockers = new Set(reference.blockingBlocks);
const directions = [[0, -1, 2], [1, 0, 5], [0, 1, 3], [-1, 0, 4]];
const zero = Object.freeze({ x: 0, y: 0, z: 0 });
const ownHeight = fluid => !fluid || fluid.empty ? 0 : Math.fround((8 - ((fluid.level ?? 0) >= 8 ? 0 : fluid.level ?? 0)) / 9);

// FlowingFluid.getFlow and isSolidFace. The world supplies the already
// imported native states/face masks; this does not run fluid simulation.
export function nativeFluidFlow(world, x, y, z, fluid) {
    let vx = 0, vy = 0, vz = 0;
    const height = ownHeight(fluid);
    const solidFace = (bx, by, bz, face) => {
        if (isFluidType(world.getFluidState(bx, by, bz), fluid.name)) return false;
        const state = world.getNativeBlockStateAt?.(bx, by, bz);
        if (state?.name === 'minecraft:ice' || state?.name === 'minecraft:frosted_ice') return false;
        return Boolean((world.getSpawnBlockRulesAt?.(bx, by, bz)?.faces?.sturdy ?? 0) & (1 << face));
    };
    for (const [dx, dz] of directions) {
        const nx = x + dx, nz = z + dz;
        const neighbor = world.getFluidState(nx, y, nz);
        if (neighbor && !neighbor.empty && !isFluidType(neighbor, fluid.name)) continue;
        const neighborHeight = ownHeight(neighbor);
        let difference = 0;
        if (neighborHeight === 0) {
            if (blockers.has(world.getNativeBlockStateAt?.(nx, y, nz)?.name)) continue;
            const below = world.getFluidState(nx, y - 1, nz);
            if (isFluidType(below, fluid.name) && ownHeight(below) > 0)
                difference = Math.fround(height - Math.fround(ownHeight(below) - Math.fround(8 / 9)));
        } else difference = Math.fround(height - neighborHeight);
        vx += dx * difference;
        vz += dz * difference;
    }
    if (fluid.falling || (fluid.level ?? 0) >= 8) {
        for (const [dx, dz, face] of directions) {
            if (!solidFace(x + dx, y, z + dz, face) && !solidFace(x + dx, y + 1, z + dz, face)) continue;
            const length = Math.hypot(vx, vz);
            if (length > 1e-4) { vx /= length; vz /= length; }
            vy = -6;
            break;
        }
    }
    const length = Math.hypot(vx, vy, vz);
    const result = length < 1e-4 ? zero : { x: vx / length, y: vy / length, z: vz / length };
    return result;
}
