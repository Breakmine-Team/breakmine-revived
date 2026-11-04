import { readFile } from 'node:fs/promises';
import { createStructureTemplateRegistry } from '../structure-nbt.mjs';
import { resolveStructureProcessors } from '../structure-processors.mjs';
import { createConfiguredFeaturePlacer } from '../features.mjs';

export const fossilData = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));
const names = ['spine_1','spine_2','spine_3','spine_4','skull_1','skull_2','skull_3','skull_4'];
export const FOSSIL_MODES = Object.freeze([...names.flatMap(name => [`fossil_${name}_coal`,`fossil_${name}_diamonds`]),
    'fossil_air','fossil_water','fossil_water_allowed','fossil_lava_allowed','fossil_protected','fossil_negative','fossil_uneven','fossil_clip','fossil_rot_zero','fossil_rot_full','fossil_capped','fossil_capped_variable','fossil_random_rule','fossil_pos_rule']);
export const fossilTemplates = await createStructureTemplateRegistry(fossilData, names.flatMap(n => [`minecraft:fossil/${n}`,`minecraft:fossil/${n}_coal`]));
export function fossilFeature(mode) {
    const diamond = mode.endsWith('_diamonds');
    const source = fossilData[`data/minecraft/worldgen/feature/fossil_${diamond ? 'diamonds' : 'coal'}.json`];
    const single = names.find(n => mode.includes(n));
    const result = { ...source, fossil_processors: { processors: resolveStructureProcessors(fossilData, source.fossil_processors) },
        overlay_processors: { processors: resolveStructureProcessors(fossilData, source.overlay_processors) } };
    if (single) {
        result.fossil_structures = [`minecraft:fossil/${single}`]; result.overlay_structures = [`minecraft:fossil/${single}_coal`];
    }
    if (mode.endsWith('_allowed')) result.max_empty_corners_allowed = 7;
    if (mode === 'fossil_rot_zero' || mode === 'fossil_rot_full') result.fossil_processors = { processors: [{ processor_type: 'minecraft:block_rot', integrity: mode.endsWith('zero') ? 0 : 1 }] };
    if (mode.startsWith('fossil_capped') || mode === 'fossil_random_rule' || mode === 'fossil_pos_rule') {
        const rule = { processor_type: 'minecraft:rule', rules: [{ input_predicate: { predicate_type: mode === 'fossil_random_rule' ? 'minecraft:random_block_match' : 'minecraft:block_match', block: 'minecraft:bone_block', probability: 0.55 },
            location_predicate: { predicate_type: 'minecraft:always_true' }, output_state: 'minecraft:gold_block',
            ...(mode === 'fossil_pos_rule' ? { position_predicate: { predicate_type: 'minecraft:axis_aligned_linear_pos', axis: 'x', min_dist: 0, max_dist: 16, min_chance: 0.1, max_chance: 0.9 } } : {}) }] };
        result.fossil_processors = { processors: mode.startsWith('fossil_capped') ? [{ processor_type: 'minecraft:capped', delegate: rule,
            limit: mode.endsWith('variable') ? { type: 'minecraft:uniform', min_inclusive: 1, max_inclusive: 7 } : 5 }] : [rule] };
    }
    return result;
}
export function fossilOrigin(mode) { return { x: mode === 'fossil_negative' ? -17 : 0, y: 40, z: mode === 'fossil_negative' ? -33 : 0 }; }
export function fossilBase(mode, pos) {
    const name = mode === 'fossil_air' ? 'air' : mode === 'fossil_water' || mode === 'fossil_water_allowed' && pos.x >= 0 ? 'water' : mode === 'fossil_lava_allowed' && pos.x >= 0 ? 'lava'
        : mode === 'fossil_protected' && (pos.x + pos.y + pos.z) % 3 === 0 ? 'bedrock' : 'stone';
    return { name: `minecraft:${name}`, properties: ['water','lava'].includes(name) ? { level: '0' } : {} };
}
export function fossilHeight(mode, x, z) { return mode === 'fossil_uneven' ? 31 + Math.abs(x + z) % 5 : 32; }
export function runFossilFixture(mode, random, seed, createWorld) {
    const w = createWorld(mode, seed, pos => fossilBase(mode, pos));
    w.context.maxY = mode === 'fossil_clip' ? 16 : 64;
    w.context.getStructureTemplate = fossilTemplates.get;
    w.context.getHeight = (type, x, z) => fossilHeight(mode, x, z);
    w.context.isStaticFullTemplateBlock = s => !['minecraft:air','minecraft:structure_void'].includes(s.name);
    w.context.transformStructureState = (s, mirror, rotation) => ({ ...s, properties: s.properties.axis && ['clockwise_90','counterclockwise_90'].includes(rotation)
        ? { ...s.properties, axis: s.properties.axis === 'x' ? 'z' : s.properties.axis === 'z' ? 'x' : 'y' } : s.properties });
    w.context.updateStructureBlockShape = (s,pos,dir,neighbor,other) => {
        if (['minecraft:water','minecraft:lava'].includes(s.name)) w.context.scheduleFluidTick(w.context.getFluidState(pos),pos,s.name === 'minecraft:water' ? 5 : 30);
        return s;
    };
    w.context.notifyStructureBlockNeighbors = () => {};
    w.context.isTemplateLiquidContainer = () => false;
    const ids = new Map();
    const place = createConfiguredFeaturePlacer(fossilData, { stateIdFor: (name, props) => {
        const key = name + JSON.stringify(props); if (!ids.has(key)) ids.set(key, ids.size + 1); return ids.get(key);
    }, setBlock: w.write, canSurvive: w.canSurvive });
    const succeeded = place('<fossil>', fossilFeature(mode), fossilOrigin(mode), random, w.context);
    return { succeeded, writes: w.writes, marks: w.marks, ticks: w.ticks, effects: w.effects, destroyed: [], gatewayExits: [], nextLong: String(random.nextLong()) };
}
