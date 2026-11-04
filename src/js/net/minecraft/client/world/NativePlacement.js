import Block from './block/Block.js';
import { nativeStairShape, nativeDoorHinge } from './NativeBlockShapes.js';

// Resolve the state that the player is placing while preserving the item ID
// used for inventory consumption. Unknown blocks retain their existing path.
export function resolvePlacement(world, hit, heldType, yaw = 0) {
    const target = Block.getById(world.getBlockAt(hit.x, hit.y, hit.z));
    const targetState = world.getNativeBlockStateAt?.(hit.x, hit.y, hit.z);
    const initial = world.getNativeRenderVariant?.(heldType, {});
    const name = initial?.state.name;
    const isSlab = name?.endsWith('_slab');
    const clickHeight = (hit.vector?.y ?? hit.y) - hit.y;
    const currentHalf = targetState?.properties?.type;
    const doubleSlab = isSlab && world.getNativeRenderVariant(heldType, { type: 'double' });
    const merge = !!(doubleSlab && targetState?.name === name && currentHalf !== 'double' &&
        ((currentHalf === 'bottom' && (hit.face.y === 1 || hit.face.y === 0 && clickHeight > .5)) ||
         (currentHalf === 'top' && (hit.face.y === -1 || hit.face.y === 0 && clickHeight <= .5))));
    const replaceTarget = merge || !!target?.isReplaceable(world, hit.x, hit.y, hit.z);
    const x = hit.x + (replaceTarget ? 0 : hit.face.x);
    const y = hit.y + (replaceTarget ? 0 : hit.face.y);
    const z = hit.z + (replaceTarget ? 0 : hit.face.z);
    let selected = null;
    const topHalf = hit.face.y === -1 || (hit.face.y === 0 && clickHeight > .5);
    const facing = ['south', 'west', 'north', 'east'][Math.floor(yaw * 4 / 360 + .5) & 3];
    const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
    if (isSlab) {
        selected = world.getNativeRenderVariant(heldType, { type: merge ? 'double' : topHalf ? 'top' : 'bottom' });
    } else if (name?.endsWith('_stairs')) {
        const half = topHalf ? 'top' : 'bottom';
        selected = world.getNativeRenderVariant(heldType, { facing, half, shape: nativeStairShape(world, x, y, z, facing, half) }) ??
            world.getNativeRenderVariant(heldType, { facing, half, shape: 'straight' });
    } else if (name?.endsWith('_door')) {
        const properties = { facing, half: 'lower', open: 'false', hinge: nativeDoorHinge(world, x, y, z, facing, hit), powered: 'false' };
        selected = world.getNativeRenderVariant(heldType, properties) ?? world.getNativeRenderVariant(heldType, { ...properties, hinge: 'left' });
    } else if (name?.endsWith('_trapdoor')) {
        const side = hit.face.x ? (hit.face.x > 0 ? 'east' : 'west') : hit.face.z ? (hit.face.z > 0 ? 'south' : 'north') : null;
        selected = world.getNativeRenderVariant(heldType, { facing: side ?? opposite[facing], half: topHalf ? 'top' : 'bottom' });
    } else if (name?.endsWith('_fence_gate')) {
        selected = world.getNativeRenderVariant(heldType, { facing });
    } else if (initial?.state.properties?.axis) {
        selected = world.getNativeRenderVariant(heldType, { axis: hit.face.x ? 'x' : hit.face.z ? 'z' : 'y' });
    }
    return { x, y, z, typeId: selected?.typeId ?? heldType, data: selected?.data ?? 0, merge };
}
