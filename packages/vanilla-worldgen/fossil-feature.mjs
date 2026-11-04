import { requireContext, blockName } from './feature-world.mjs';
import { STRUCTURE_ROTATIONS, rotatedStructureSize, structureZeroPosition, structureBounds, placeStructureTemplate } from './structure-template.mjs';
import { resolveStructureProcessors } from './structure-processors.mjs';

export function placeFossil(feature, origin, random, { context, data, directState, setBlock }) {
    const list = feature.fossil_structures, overlay = feature.overlay_structures;
    if (!Array.isArray(list) || !list.length || !Array.isArray(overlay) || overlay.length !== list.length) throw new TypeError('Fossil structure and overlay lists must be nonempty and aligned');
    const maxEmpty = feature.max_empty_corners_allowed;
    if (!Number.isInteger(maxEmpty) || maxEmpty < 0 || maxEmpty > 7) throw new RangeError('Invalid fossil empty-corner allowance');
    if (!Number.isInteger(context?.minY) || !Number.isInteger(context?.maxY) || context.minY >= context.maxY) throw new TypeError('Fossil placement requires world height bounds');
    const rotation = STRUCTURE_ROTATIONS[random.nextInt(4)], index = random.nextInt(list.length);
    const getTemplate = requireContext(context, 'getStructureTemplate');
    const template = getTemplate(list[index]), other = getTemplate(overlay[index]);
    const [sx, , sz] = rotatedStructureSize(template, rotation);
    const corner = { x: origin.x - Math.trunc(sx / 2), y: origin.y, z: origin.z - Math.trunc(sz / 2) };
    const height = requireContext(context, 'getHeight');
    let lowest = origin.y;
    for (let x = 0; x < sx; x++) for (let z = 0; z < sz; z++) lowest = Math.min(lowest, height('OCEAN_FLOOR_WG', corner.x + x, corner.z + z));
    corner.y = Math.max(lowest - 15 - random.nextInt(10), context.minY + 10);
    const position = structureZeroPosition(template, corner, { rotation });
    const bounds = structureBounds(template, position, { rotation });
    const read = requireContext(context, 'getBlockState');
    let empty = 0;
    for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY, bounds.maxY]) for (const z of [bounds.minZ, bounds.maxZ]) {
        if (['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:water', 'minecraft:lava'].includes(blockName(read({ x, y, z })))) empty++;
    }
    if (empty > maxEmpty) return false;
    const chunkX = Math.floor(origin.x / 16) * 16, chunkZ = Math.floor(origin.z / 16) * 16;
    const options = { context, directState, setBlock, random, rotation, flags: 260,
        boundingBox: { minX: chunkX - 16, minZ: chunkZ - 16, maxX: chunkX + 31, maxZ: chunkZ + 31, minY: context.minY, maxY: context.maxY - 1 } };
    placeStructureTemplate(template, position, { ...options, processors: resolveStructureProcessors(data, feature.fossil_processors) });
    placeStructureTemplate(other, position, { ...options, processors: resolveStructureProcessors(data, feature.overlay_processors) });
    return true;
}
