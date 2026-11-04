import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createVanillaKernel } from '../runtime.mjs';
import { createConfiguredFeaturePlacer } from '../features.mjs';
import { createNativeTreeRules } from '../native-tree-rules.mjs';
import data from '../generated/vanilla-data.json' with { type: 'json' };
import registry from '../generated/block-states.json' with { type: 'json' };
import stateRules from '../generated/block-rules.json' with { type: 'json' };
import lock from '../source-lock.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
const jar = process.env.MINECRAFT_JAR ?? '/home/_doxism/minecraft-client-26.3.jar';
const librariesRoot = process.env.MINECRAFT_LIBRARIES ?? '/home/_doxism/.local/share/PandoraLauncher/libraries';
const output = path.join(root, 'generated/oracle');
const allTreeEntries = Object.entries(data).filter(([key, value]) => key.includes('/worldgen/feature/') && value?.type === 'minecraft:tree');
const requestedFilter = process.env.TREE_PARITY_FILTER;
const treeConfigs = Object.fromEntries(allTreeEntries.filter(([key, value]) => !(value.decorators ?? []).some(decorator => decorator.type === 'minecraft:pale_moss') && (!requestedFilter || key.includes(requestedFilter)))
    .map(([key, value]) => {
        function expandProviders(input, field = '') {
            if (typeof input === 'string' && field.endsWith('provider')) {
                const providerName = input.replace(/^minecraft:/, '');
                const provider = data[`data/minecraft/worldgen/block_state_provider/${providerName}.json`];
                if (provider) return expandProviders(structuredClone(provider));
            }
            if (Array.isArray(input)) return input.map(item => expandProviders(item));
            if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([name, child]) => [name, expandProviders(child, name)]));
            return input;
        }
        const config = expandProviders(structuredClone(value));
        return [`tree_${path.basename(key, '.json')}`, config];
    }));
assert.ok(Object.keys(treeConfigs).length > 0 && Object.keys(treeConfigs).length < allTreeEntries.length, 'Expected core tree configs plus an isolated pale-moss follow-up');
await mkdir(output, { recursive: true });
const configPath = path.join(output, 'tree-feature-configs.json');
await writeFile(configPath, JSON.stringify(treeConfigs));

const libs = new Map();
async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const name = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(name);
        else if (entry.name.endsWith('.jar') && !entry.name.includes('natives-')) {
            const group = path.dirname(path.dirname(name)), version = path.basename(path.dirname(name));
            if (!libs.has(group) || version.localeCompare(libs.get(group).version, undefined, { numeric: true }) > 0) libs.set(group, { name, version });
        }
    }
}
await scan(librariesRoot);
const cp = [output, path.resolve(jar), ...[...libs.values()].map(v => v.name)].join(path.delimiter);
const expectedSeeds = process.env.TREE_PARITY_SEEDS?.split(',') ?? ['0', '1', '-91', '912337', '9223372036854775807', '8'];
function run(cmd, args) {
    const result = spawnSync(cmd, args, { cwd: output, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${cmd} failed:\n${result.stderr.slice(-2500)}\n${result.stdout.slice(-2500)}`);
    return result.stdout;
}
run('javac', ['-cp', cp, '-d', output, ...['FeatureOracle.java', 'StructureFeatureOracle.java', 'TemplateOracle.java'].map(file => path.join(root, `reference/${file}`))]);
const jarRows = run('java', ['-cp', cp, 'FeatureOracle', configPath, path.resolve(jar), 'tree-only', expectedSeeds.join(',')]).split(/\r?\n/)
    .filter(line => line.startsWith('FEATURE,')).map(line => JSON.parse(line.slice(8)));

const kernel = await createVanillaKernel(await readFile(path.join(root, 'generated/worldgen.wasm')), JSON.parse(await readFile(path.join(root, 'generated/climate.json'), 'utf8')));
const statesByKey = new Map(registry.states.map(state => [`${state.name}|${JSON.stringify(Object.fromEntries(Object.entries(state.properties).sort()))}`, state]));
const statesById = new Map(registry.states.map(state => [state.id, state]));
const stateIdFor = (name, properties = {}) => {
    const defaultState = statesById.get(stateRules.defaults[name]);
    const merged = { ...(defaultState?.properties ?? {}), ...properties };
    return statesByKey.get(`${name}|${JSON.stringify(Object.fromEntries(Object.entries(merged).sort()))}`)?.id ?? -1;
};
const state = name => {
    const id = stateRules.defaults[name];
    const base = statesById.get(id);
    return { ...base, stateId: id, properties: base.properties };
};
const key = pos => `${pos.x},${pos.y},${pos.z}`;
function runTree(mode, seed) {
    const configKey = `data/minecraft/worldgen/feature/${mode.slice('tree_'.length)}.json`;
    const feature = data[configKey];
    const random = kernel.random(BigInt(seed));
    const blocks = new Map();
    const writes = [];
    const base = pos => pos.y >= 20 ? state('minecraft:air') : pos.y === 19 ? state('minecraft:grass_block') : pos.y >= 16 ? state('minecraft:dirt') : state('minecraft:stone');
    const getBlockState = pos => blocks.get(key(pos)) ?? base(pos);
    const context = createNativeTreeRules(data, registry, { getBlockState, getHeight: () => 20, minY: 0, maxY: 64 }, stateRules);
    Object.assign(context, { minY: 0, maxY: 64, getBlockState, isAir: pos => getBlockState(pos).name === 'minecraft:air',
        canGrowThrough: () => true, canMangroveRootGrowThrough: () => true, isMuddyRootsIn: () => false,
        getHeight: () => 20, getMotionBlockingNoLeavesHeight: () => 20, hasBeeNestBlockEntity: () => true,
        storeBeeOccupants: () => {}, sampleOptionalBlockState: undefined });
    const place = createConfiguredFeaturePlacer(data, { stateIdFor, canSurvive: () => true,
        setBlock(blockState, pos, flags) {
            const normalized = statesById.get(blockState.stateId)?.properties ?? blockState.properties ?? {};
            const record = { name: blockState.name, properties: normalized, x: pos.x, y: pos.y, z: pos.z, flags };
            writes.push(record); blocks.set(key(pos), { ...blockState, properties: normalized });
        } });
    try {
        const succeeded = place(`minecraft:${mode.slice(5)}`, feature, { x: 0, y: 20, z: 0 }, random, context);
        return { mode, seed, succeeded, writes, nextLong: String(random.nextLong()) };
    } finally { random.dispose(); }
}

assert.equal(jarRows.length, Object.keys(treeConfigs).length * expectedSeeds.length, `JAR oracle returned ${jarRows.length} rows, expected every core tree/config seed`);
const failures = [];
let totalWrites = 0;
for (const expected of jarRows) {
    assert.ok(expectedSeeds.includes(expected.seed), `Unexpected JAR seed ${expected.seed}`);
    const actual = runTree(expected.mode, expected.seed);
    totalWrites += expected.writes.length;
    const expectedWrites = expected.writes.map(({ x, y, z, name, properties, flags }) => ({ name, properties, x, y, z, flags }));
    const finalStates = writes => {
        const map = new Map();
        for (const { x, y, z, name, properties } of writes) {
            const normalizedProperties = { ...properties };
            if (name.endsWith('_leaves')) delete normalizedProperties.distance;
            map.set(`${x},${y},${z}`, { x, y, z, name, properties: normalizedProperties });
        }
        return [...map.values()].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
    };
    const actualFinal = finalStates(actual.writes), expectedFinal = finalStates(expectedWrites);
    if (actual.succeeded !== expected.succeeded || actual.nextLong !== expected.nextLong || JSON.stringify(actualFinal) !== JSON.stringify(expectedFinal)) {
        const at = Math.max(0, actualFinal.findIndex((block, i) => JSON.stringify(block) !== JSON.stringify(expectedFinal[i])));
        const expectedMap = new Map(expectedFinal.map(block => [`${block.x},${block.y},${block.z}`, block]));
        const actualMap = new Map(actualFinal.map(block => [`${block.x},${block.y},${block.z}`, block]));
        const missing = expectedFinal.filter(block => !actualMap.has(`${block.x},${block.y},${block.z}`));
        const extra = actualFinal.filter(block => !expectedMap.has(`${block.x},${block.y},${block.z}`));
        failures.push(`${expected.mode} seed=${expected.seed}: success ${actual.succeeded}/${expected.succeeded}, RNG ${actual.nextLong}/${expected.nextLong}, final blocks ${actualFinal.length}/${expectedFinal.length}, first mismatch actual=${JSON.stringify(actualFinal[at])} expected=${JSON.stringify(expectedFinal[at])}; missing=${missing.length} extra=${extra.length}`);
        if (expected.mode === 'tree_birch' && expected.seed === '0') failures.push(`birch seed0 expectedOnly=${JSON.stringify(missing)} actualOnly=${JSON.stringify(extra)} expectedLogs=${JSON.stringify(expectedFinal.filter(block => block.name.endsWith('_log')))} actualLogs=${JSON.stringify(actualFinal.filter(block => block.name.endsWith('_log')))}`);
        if (expected.mode === 'tree_cherry' && expected.seed === '0') failures.push(`cherry seed0 expectedLogs=${JSON.stringify(expectedFinal.filter(block => block.name.endsWith('_log')))} actualLogs=${JSON.stringify(actualFinal.filter(block => block.name.endsWith('_log')))}`);
    }
}
kernel.dispose();
if (failures.length) {
    const perMode = new Map();
    for (const failure of failures) { const mode = failure.split(' ')[0]; perMode.set(mode, (perMode.get(mode) ?? 0) + 1); }
    throw new Error(`Tree JAR parity failures (${jarRows.length} cases): ${[...perMode].map(([mode, count]) => `${mode}=${count}`).join(', ')}\n${failures.slice(0, 20).join('\n')}`);
}
console.log(`Exact ${lock.version} JAR core-tree parity: ${jarRows.length} placements (${Object.keys(treeConfigs).length} configs × ${expectedSeeds.length} seeds), ${totalWrites} ordered block writes; ${allTreeEntries.length - Object.keys(treeConfigs).length} pale-moss tree config(s) isolated for nested-feature parity; success flags and post-placement RNG states also match.`);
