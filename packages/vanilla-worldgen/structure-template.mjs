import { requireContext, relative } from './feature-world.mjs';
import { createJavaLegacyRandom } from './java-legacy-random.mjs';
import { structurePositionSeed, processStructureBlocks } from './structure-processors.mjs';

export const STRUCTURE_ROTATIONS = Object.freeze(['none', 'clockwise_90', 'clockwise_180', 'counterclockwise_90']);
export const STRUCTURE_MIRRORS = Object.freeze(['none', 'left_right', 'front_back']);
const zero = { x: 0, y: 0, z: 0 };
export function transformStructurePosition(pos, { rotation = 'none', mirror = 'none', rotationPivot = zero } = {}) {
    if (!STRUCTURE_ROTATIONS.includes(rotation) || !STRUCTURE_MIRRORS.includes(mirror)) throw new TypeError('Invalid structure transform');
    if (![pos, rotationPivot].every(p => p && [p.x, p.y, p.z].every(Number.isInteger))) throw new TypeError('Expected integer structure positions');
    let { x, y, z } = pos;
    if (mirror === 'left_right') z = 0 - z;
    if (mirror === 'front_back') x = 0 - x;
    const px = rotationPivot.x, pz = rotationPivot.z;
    switch (rotation) {
        case 'clockwise_90': return { x: px + pz - z, y, z: pz - px + x };
        case 'clockwise_180': return { x: px * 2 - x, y, z: pz * 2 - z };
        case 'counterclockwise_90': return { x: px - pz + z, y, z: px + pz - x };
        default: return { x, y, z };
    }
}
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export function structureBounds(template, origin, settings = {}) {
    const [x, y, z] = template.size;
    const a = add(origin, transformStructurePosition(zero, settings));
    const b = add(origin, transformStructurePosition({ x: x - 1, y: y - 1, z: z - 1 }, settings));
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), minZ: Math.min(a.z, b.z), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y), maxZ: Math.max(a.z, b.z) };
}
export function structureZeroPosition(template, corner, settings = {}) {
    const box = structureBounds(template, zero, { ...settings, rotationPivot: zero });
    return add(corner, { x: -box.minX, y: 0, z: -box.minZ });
}
export function rotatedStructureSize(template, rotation = 'none') {
    if (!STRUCTURE_ROTATIONS.includes(rotation)) throw new TypeError('Invalid structure rotation');
    const [x, y, z] = template.size;
    return rotation === 'clockwise_90' || rotation === 'counterclockwise_90' ? [z, y, x] : [x, y, z];
}
export function insideStructureBounds(pos, box) {
    return !box || pos.x >= box.minX && pos.x <= box.maxX && pos.y >= box.minY && pos.y <= box.maxY && pos.z >= box.minZ && pos.z <= box.maxZ;
}

export function orderedTemplatePaletteBlocks(template, palette, classify) {
    const groups = [[], [], []];
    for (const block of template.blocks) {
        const entry = { pos:block.pos, state:palette[block.state], nbt:block.nbt };
        groups[block.nbt ? 2 : classify(entry.state) ? 0 : 1].push(entry);
    }
    const order = (a,b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x || a.pos.z - b.pos.z;
    return groups.flatMap(group => group.sort(order));
}

export function placeStructureTemplate(template, origin, { context, directState, setBlock, random,
    rotation = 'none', mirror = 'none', rotationPivot = zero, processorPivot = origin,
    processors = [], boundingBox, flags = 2, knownShape = false, ignoreEntities = false, applyWaterlogging = true } = {}) {
    if (!template?.palettes?.length) return false;
    const settings = { rotation, mirror, rotationPivot };
    transformStructurePosition(zero, settings);
    const rng = random ?? createJavaLegacyRandom(structurePositionSeed(origin));
    const palette = template.palettes[rng.nextInt(template.palettes.length)];
    if ((!template.blocks.length && (ignoreEntities || !template.entities.length)) || template.size.some(v => v < 1)) return false;
    const classify = requireContext(context, 'isStaticFullTemplateBlock');
    const transformState = requireContext(context, 'transformStructureState');
    const resolvedPalette = palette.map(state => directState({id:state.name,properties:state.properties}));
    const entirePiece = processors.some(p => p.processor_type === 'minecraft:capped');
    const blocks = orderedTemplatePaletteBlocks(template, resolvedPalette, classify).map(b => ({ ...b, local:b.pos, pos:add(origin,transformStructurePosition(b.pos,settings)) }))
        .filter(b => entirePiece || insideStructureBounds(b.pos, boundingBox));
    const processed = processStructureBlocks(blocks, processors, origin, processorPivot, { context, random, directState });
    const placed = [], pendingFluids = [], createdSources = new Set();
    const posKey = p => `${p.x},${p.y},${p.z}`;
    const getFluid = applyWaterlogging ? requireContext(context, 'getFluidState') : null;
    const liquidContainer = applyWaterlogging ? requireContext(context, 'isTemplateLiquidContainer') : null;
    if (!knownShape) { requireContext(context, 'updateStructureBlockShape'); requireContext(context, 'notifyStructureBlockNeighbors'); }
    if (!ignoreEntities && template.entities.length) requireContext(context, 'placeTemplateEntities');
    if (processed.some(b => b.nbt)) {
        requireContext(context, 'loadTemplateBlockEntity');
        requireContext(context, 'markTemplateBlockEntityChanged');
    }
    for (const info of processed) {
        if (!insideStructureBounds(info.pos, boundingBox)) continue;
        const fluid = getFluid?.(info.pos);
        const state = transformState(info.state, mirror, rotation);
        if (info.nbt) setBlock(directState('minecraft:barrier'), info.pos, 820);
        const written = setBlock(state, info.pos, flags);
        if (typeof written !== 'boolean') throw new TypeError('Template setBlock must return actual write success');
        if (!written) continue;
        placed.push({ ...info, state });
        if (info.nbt) {
            const nbt = structuredClone(info.nbt);
            if (context.hasLootContainer?.(info.pos)) nbt.LootTableSeed = rng.nextLong();
            context.loadTemplateBlockEntity(info.pos, nbt);
        }
        if (applyWaterlogging) {
            if (getFluid(info.pos).source) createdSources.add(posKey(info.pos));
            else if (liquidContainer(state)) {
                requireContext(context, 'placeTemplateLiquid')(info.pos, state, fluid);
                if (!fluid.source) pendingFluids.push(info.pos);
            }
        }
    }
    for (let progress = true; progress && pendingFluids.length;) {
        progress = false;
        for (let index = 0; index < pendingFluids.length;) {
            const pos = pendingFluids[index]; let fluid = getFluid(pos);
            for (const direction of ['up','north','east','south','west']) {
                if (fluid.source) break;
                const neighbor = relative(pos, direction), candidate = getFluid(neighbor);
                if (candidate.source && !createdSources.has(posKey(neighbor))) fluid = candidate;
            }
            const state = requireContext(context, 'getBlockState')(pos);
            if (fluid.source && liquidContainer(state)) {
                requireContext(context, 'placeTemplateLiquid')(pos, state, fluid);
                pendingFluids.splice(index, 1); progress = true;
            } else index++;
        }
    }
    if (!knownShape && placed.length) updateStructureNeighborShapes(placed.map(b => b.pos), { context, setBlock, flags });
    for (const info of placed) if (info.nbt) context.markTemplateBlockEntityChanged(info.pos);
    if (!ignoreEntities && template.entities.length) context.placeTemplateEntities(template.entities, origin, { ...settings, boundingBox });
    return true;
}

function sameState(a, b) {
    return a === b || a.name === b.name && Object.keys(a.properties ?? {}).length === Object.keys(b.properties ?? {}).length && Object.entries(a.properties ?? {}).every(([k,v]) => b.properties?.[k] === v);
}
export function updateStructureNeighborShapes(positions, { context, setBlock, flags }) {
    if (!positions.length) return;
    const read = requireContext(context, 'getBlockState'), update = requireContext(context, 'updateStructureBlockShape');
    const notify = requireContext(context, 'notifyStructureBlockNeighbors');
    const key = p => `${p.x},${p.y},${p.z}`, occupied = new Set(positions.map(key));
    const axes = ['x','y','z'];
    const min = {x:Infinity,y:Infinity,z:Infinity}, max = {x:-Infinity,y:-Infinity,z:-Infinity};
    for (const pos of positions) for (const axis of axes) { min[axis]=Math.min(min[axis],pos[axis]);max[axis]=Math.max(max[axis],pos[axis]); }
    const sizes = Object.fromEntries(axes.map(a => [a,max[a]-min[a]+1]));
    if (sizes.x * sizes.y * sizes.z > 2000000) throw new RangeError('Template shape-update volume exceeds limit');
    const opposite = { north:'south',south:'north',west:'east',east:'west',up:'down',down:'up' };
    function edge(pos, direction) {
        const neighbor = relative(pos, direction), a = read(pos), b = read(neighbor);
        const nextA = update(a, pos, direction, neighbor, b);
        if (!sameState(a, nextA)) setBlock(nextA, pos, flags & ~1);
        const nextB = update(b, neighbor, opposite[direction], pos, nextA);
        if (!sameState(b, nextB)) setBlock(nextB, neighbor, flags & ~1);
    }
    for (const [u,v,w,negative,positive] of [['x','y','z','north','south'],['z','x','y','down','up'],['y','z','x','west','east']]) {
        for (let a=0; a<sizes[u]; a++) for (let b=0; b<sizes[v]; b++) {
            let previous = false;
            for (let c=0; c<=sizes[w]; c++) {
                const pos = { ...min, [u]:min[u]+a,[v]:min[v]+b,[w]:min[w]+c };
                const full = c < sizes[w] && occupied.has(key(pos));
                if (!previous && full) edge(pos, negative);
                if (previous && !full) edge({ ...pos, [w]:pos[w]-1 }, positive);
                previous = full;
            }
        }
    }
    for (const pos of positions) {
        const before = read(pos); let after = before;
        for (const direction of ['west','east','north','south','down','up']) {
            const neighbor = relative(pos,direction);
            after = update(after,pos,direction,neighbor,read(neighbor));
        }
        if (!sameState(before,after)) setBlock(after,pos,(flags & ~1) | 16);
        notify(pos,after);
    }
}
