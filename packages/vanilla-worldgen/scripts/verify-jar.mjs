import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createVanillaKernel } from '../runtime.mjs';
import { createNoiseRegistry } from '../noise-registry.mjs';
import { createClimateRouter } from '../density.mjs';
import { createNoiseTerrainSampler } from '../chunk.mjs';
import { createEndIslandSampler } from '../end-islands.mjs';
import { createLegacyBlockStateMap, createLegacyStateIdMap } from '../legacy-adapter.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [jar, libraryRoot] = process.argv.slice(2);
if (!jar || !libraryRoot) throw new Error('Usage: node scripts/verify-jar.mjs <reference-client.jar> <launcher-libraries-directory>');
const lock = JSON.parse(await readFile(path.join(root, 'source-lock.json'), 'utf8'));
assert.equal(createHash('sha256').update(await readFile(jar)).digest('hex'), lock.sha256, 'Oracle JAR hash');
const libraries = new Map();
async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const name = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(name);
        else if (entry.name.endsWith('.jar') && !entry.name.includes('natives-')) {
            const group = path.dirname(path.dirname(name));
            const version = path.basename(path.dirname(name));
            const current = libraries.get(group);
            if (!current || version.localeCompare(current.version, undefined, { numeric: true }) > 0) libraries.set(group, { name, version });
        }
    }
}
await scan(libraryRoot);
const output = path.join(root, 'generated/oracle');
await mkdir(output, { recursive: true });
const classpath = [output, path.resolve(jar), ...[...libraries.values()].map(v => v.name)].join(path.delimiter);
function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: output });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command}: ${result.stderr}\n${result.stdout}`);
    return result.stdout;
}
run('javac', ['-cp', classpath, '-d', output, ...['WorldgenOracle', 'ClimateOracle', 'NoiseOracle', 'DensityOracle', 'EndIslandOracle', 'BlockStateRegistryOracle'].map(name => path.join(root, `reference/${name}.java`))]);
const oracle = run('java', ['-cp', classpath, 'WorldgenOracle']);
const { instance } = await WebAssembly.instantiate(await readFile(path.join(root, 'generated/worldgen.wasm')));
const wasm = instance.exports;
assert.equal(wasm.worldgen_abi_version(), 1);
assert.equal(wasm.worldgen_capabilities(), 63);
const handles = new Map();
const bits = new DataView(new ArrayBuffer(8));
let count = 0;
for (const line of oracle.split(/\r?\n/)) {
    const [type, seed, ...values] = line.split(',');
    if (!['LONG', 'INT', 'DOUBLE', 'PERLIN', 'SMEAR', 'PAIR'].includes(type)) continue;
    const key = `${type}:${seed}`;
    let ptr = handles.get(key);
    if (!ptr) {
        ptr = type === 'PAIR' ? wasm.rng_create_pair(0n, 0n)
            : ['PERLIN', 'SMEAR'].includes(type) ? wasm.perlin_create(BigInt(seed)) : wasm.rng_create(BigInt(seed));
        handles.set(key, ptr);
    }
    let actual;
    let expected;
    if (type === 'LONG' || type === 'PAIR') {
        actual = wasm.rng_next_long(ptr).toString(); expected = values.at(-1);
    } else if (type === 'INT') {
        actual = String(wasm.rng_next_int(ptr, +values[0])); expected = values[1];
    } else if (type === 'DOUBLE') {
        bits.setFloat64(0, wasm.rng_next_double(ptr));
        actual = bits.getBigUint64(0).toString(); expected = values[0];
    } else {
        const numbers = values.slice(0, -1).map(Number);
        bits.setFloat32(0, type === 'PERLIN' ? wasm.perlin_sample(ptr, ...numbers) : wasm.smeared_perlin_sample(ptr, ...numbers));
        actual = String(bits.getInt32(0)); expected = values.at(-1);
    }
    assert.equal(actual, expected, line);
    count++;
}
for (const [key, ptr] of handles) {
    if (key.startsWith('PERLIN:') || key.startsWith('SMEAR:')) wasm.perlin_free(ptr);
    else wasm.rng_free(ptr);
}
assert.ok(count > 2800, 'Oracle produced too few cases');
console.log(`${count} WASM outputs match the actual ${lock.version} JAR bit for bit.`);

const climateOutput = run('java', ['-cp', classpath, 'ClimateOracle']);
const climate = JSON.parse(climateOutput.split(/\r?\n/).find(line => line.startsWith('CLIMATE:')).slice(8));
const exported = {};
for (const [dimension, { nodes, queries, biomes, parameterCount }] of Object.entries(climate)) {
    const tree = wasm.climate_create(nodes.length);
    for (const [index, node] of nodes.entries()) {
        const ptr = wasm.climate_bounds(tree, index);
        new BigInt64Array(wasm.memory.buffer, ptr, 14).set(node.bounds.flat().map(BigInt));
        wasm.climate_set_biome(tree, index, node.biome);
        for (const child of node.children) wasm.climate_add_child(tree, index, child);
    }
    for (const query of queries) {
        assert.equal(wasm.climate_sample(tree, ...query.point.map(BigInt)), query.biome, `${dimension} climate ${query.point}`);
    }
    wasm.climate_free(tree);
    exported[dimension] = { nodes, biomes, parameterCount };
    console.log(`${dimension}: ${biomes.length} biomes, ${parameterCount} parameter entries, ${queries.length} JAR climate comparisons passed.`);
}
const noiseOutput = run('java', ['-cp', classpath, 'NoiseOracle', path.resolve(jar)]);
const noiseCases = JSON.parse(noiseOutput.split(/\r?\n/).find(line => line.startsWith('NOISE:')).slice(6));
const kernel = await createVanillaKernel(await readFile(path.join(root, 'generated/worldgen.wasm')), { source: lock, presets: exported });
let noiseCount = 0;
const definitions = new Set();
const noiseData = {};
const registries = new Map();
try {
    for (const row of noiseCases) {
        const random = kernel.random(row.seed);
        if (row.kind === 'normal') {
            let factory, source = random;
            if (row.identifier) {
                factory = random.forkPositional();
                source = factory.fromHashOf(row.identifier);
                noiseData[row.id] = row.parameters;
                if (!registries.has(row.seed)) registries.set(row.seed, createNoiseRegistry(kernel, row.seed, noiseData));
            }
            const noise = source.normalNoise(row.parameters);
            for (const { position, bits: expected } of row.samples) {
                bits.setFloat32(0, noise.sample(...position));
                assert.equal(bits.getInt32(0), expected, `${row.id} seed=${row.seed} at ${position}`);
                if (row.identifier) {
                    bits.setFloat32(0, registries.get(row.seed).sample(row.identifier, ...position));
                    assert.equal(bits.getInt32(0), expected, `Named registry ${row.identifier} seed=${row.seed} at ${position}`);
                }
                noiseCount++;
            }
            assert.equal(source.nextLong().toString(), row.nextLong, 'Noise constructor RNG consumption');
            if (factory) { source.dispose(); factory.dispose(); }
            definitions.add(row.id);
            noise.dispose();
        } else {
            const factory = random.forkPositional();
            const child = row.kind === 'at' ? factory.at(...row.position) : row.kind === 'hash' ? factory.fromHashOf(row.name) : factory.fromSeed(row.child);
            for (const value of row.values) {
                assert.equal(child.nextLong().toString(), value, JSON.stringify(row));
                noiseCount++;
            }
            child.dispose(); factory.dispose();
        }
        random.dispose();
    }
    assert.equal([...definitions].filter(id => id.startsWith('data/')).length, 64);
    assert.equal(definitions.size, 73);
    assert.equal(noiseCount, 37611, 'Oracle must exercise every seed, definition and coordinate');
    console.log(`${noiseCount} positional RNG/normal noise outputs match JAR bits; all 64 noise definitions and 9 normalization fixtures verified.`);
} finally { for (const registry of registries.values()) registry.dispose(); kernel.dispose(); }
const densityOutput = run('java', ['-cp', classpath, 'DensityOracle', path.resolve(jar), path.join(root, 'reference/density-fixtures.json')]);
const densityCases = JSON.parse(densityOutput.split(/\r?\n/).find(line => line.startsWith('DENSITY:')).slice(8));
const densityKernel = await createVanillaKernel(await readFile(path.join(root, 'generated/worldgen.wasm')), { source: lock, presets: exported });
const data = JSON.parse(await readFile(path.join(root, 'generated/vanilla-data.json'), 'utf8'));
const fixtures = JSON.parse(await readFile(path.join(root, 'reference/density-fixtures.json'), 'utf8'));
let densityCount = 0, biomeCount = 0;
try {
    for (const row of densityCases) {
        const router = createClimateRouter(densityKernel, row.seed, data, row.settings);
        try {
            for (const sample of row.samples) {
                const values = router.sampleBlock(...sample.position);
                for (let i=0; i<6; i++) {
                    bits.setFloat32(0, values[i]);
                    assert.equal(bits.getInt32(0), sample.bits[i], `${row.settings} seed=${row.seed} ${router.fields[i]} at ${sample.position}`);
                    densityCount++;
                }
                assert.equal(router.biomeAtQuart(...sample.position.map(v => v >> 2)), sample.biome, `${row.settings} biome seed=${row.seed} at ${sample.position}`);
                biomeCount++;
            }
        } finally { router.dispose(); }
    }
    assert.equal(densityCount, 58128);
    assert.equal(biomeCount, 9688);
    console.log(`${densityCount} climate density values match JAR bits; ${biomeCount} coordinate-to-biome results match across four settings and seven seeds.`);
    const primitiveCases = JSON.parse(densityOutput.split(/\r?\n/).find(line => line.startsWith('DENSITY_OPS:')).slice(12));
    let primitiveCount = 0;
    for (const row of primitiveCases) {
        const graph = densityKernel.density(row.seed, data, { [row.name]: fixtures[row.name] });
        try {
            for (const sample of row.samples) {
                bits.setFloat32(0, graph.sample(row.name, ...sample.position));
                assert.equal(bits.getInt32(0), sample.bits, `Density op ${row.name} seed=${row.seed} at ${sample.position}`);
                primitiveCount++;
            }
        } finally { graph.dispose(); }
    }
    assert.equal(primitiveCount, 2002);
    console.log(`${primitiveCount} density operator/spline boundary comparisons match JAR bits.`);
    const terrainCases = JSON.parse(densityOutput.split(/\r?\n/).find(line => line.startsWith('DENSITY_TERRAIN:')).slice(16));
    let terrainCount = 0;
    for (const row of terrainCases) {
        const graph = densityKernel.density(row.seed, data, row.roots, {legacyRandom:row.legacy});
        try {
            for (const sample of row.samples) {
                for (const [i,name] of graph.fields.entries()) {
                    bits.setFloat32(0, graph.sample(name,...sample.position));
                    assert.equal(bits.getInt32(0), sample.bits[i], `Terrain ${row.settings}/${name} seed=${row.seed} at ${sample.position}`);
                    terrainCount++;
                }
            }
        } finally { graph.dispose(); }
    }
    assert.equal(terrainCount,46018);
    console.log(`${terrainCount} final-density/base-terrain/sloped-cheese/factor/jaggedness values match JAR bits across all five settings, including End.`);
    const volumeCases = JSON.parse(densityOutput.split(/\r?\n/).find(line => line.startsWith('DENSITY_VOLUMES:')).slice(16));
    let volumeCount = 0;
    let aquiferCount = 0;
    let pressureCount = 0, updateCount = 0;
    const substances = [0,0,0,0];
    for (const row of volumeCases) {
        const fields=row.aquifers ? Object.fromEntries(Object.keys(row.aquifers).map(key=>[key,`aquifer/${key}`])) : null;
        const roots={final:row.root};
        if (fields) for (const [key,name] of Object.entries(fields)) roots[name]=row.aquifers[key];
        const graph = densityKernel.density(row.seed,data,roots,{legacyRandom:row.legacy});
        try {
            const values = graph.sampleVolume('final',...row.origin,16,384,16);
            const actual = new Int32Array(values.buffer);
            for (let i=0;i<actual.length;i++) assert.equal(actual[i],row.bits[i],`Volume ${row.settings} seed=${row.seed} origin=${row.origin} index=${i}`);
            volumeCount += actual.length;
            const fluids=graph.sampleAquiferVolume('final',...row.origin,16,384,16,{fields,seaLevel:row.sea,defaultFluid:row.fluid});
            const expected=Buffer.from(row.substances,'base64');
            const carvingFluids=graph.sampleCarvingAquiferVolume('final',...row.origin,16,384,16,{fields,seaLevel:row.sea,defaultFluid:row.fluid});
            const expectedCarving=Buffer.from(row.carvingSubstances,'base64');
            assert.equal(fluids.length,expected.length);
            assert.equal(carvingFluids.length,expectedCarving.length);
            for (let i=0;i<fluids.length;i++) {
                assert.equal(fluids[i],expected[i],`Aquifer ${row.settings} seed=${row.seed} origin=${row.origin} index=${i}`);
                assert.equal(carvingFluids[i],expectedCarving[i],`Carving aquifer ${row.settings} seed=${row.seed} origin=${row.origin} index=${i}`);
                substances[fluids[i]&15]++;
                if ((fluids[i]&15)===0 && values[i]<=0) pressureCount++;
                if (fluids[i]&16) updateCount++;
            }
            aquiferCount+=fluids.length;
            if (row.origin[0]===0) {
                const dimension=row.settings==='nether' ? 'nether' : 'overworld';
                const biomeIds=Object.fromEntries(exported[dimension].biomes.map((name,i)=>[name,i]));
                const states=[70000,5,500,900];
                const terrain=createNoiseTerrainSampler(densityKernel,row.seed,data,{settings:row.settings,solidState:states[0],airState:states[1],waterState:states[2],lavaState:states[3],biomeIds});
                try {
                    const chunk=terrain.sampleChunk(0,0);
                    for (let z=0;z<16;z++) for (let x=0;x<16;x++) for (let y=0;y<chunk.height;y++) {
                        const code=expected[(z*16+x)*384+y+chunk.minY-row.origin[1]];
                        const index=y*256+z*16+x;
                        assert.equal(chunk.blocks[index],states[code&15],`Terrain block ${row.settings} ${row.seed} ${x},${y},${z}`);
                        assert.equal(chunk.fluidUpdates[index],(code&15)>=2 && (code&16) ? 1 : 0,`Terrain fluid tick ${row.settings} ${row.seed} ${x},${y},${z}`);
                    }
                } finally { terrain.dispose(); }
            }
        } finally { graph.dispose(); }
    }
    assert.equal(volumeCount,1572864);
    console.log(`${volumeCount} full chunk density volume values match JAR bits.`);
    assert.equal(aquiferCount,1572864);
    assert.ok(substances.every(value=>value>0));
    assert.ok(pressureCount>0 && updateCount>0,'Aquifer fixtures must exercise pressure walls and update flags');
    console.log(`${aquiferCount} aquifer substances and fluid update flags match JAR; solid/air/water/lava counts: ${substances}.`);
    console.log(`${pressureCount} pressure-wall blocks and ${updateCount} update flags verified.`);
    console.log(`${aquiferCount} density=0 carving-aquifer substances and fluid update flags match the JAR.`);
} finally { densityKernel.dispose(); }

const endOutput = run('java', ['-cp', classpath, 'EndIslandOracle']);
const endKernel = await createVanillaKernel(await readFile(path.join(root, 'generated/worldgen.wasm')), { source: lock, presets: exported });
const endGraphs = new Map();
let endIslandCount = 0;
for (const line of endOutput.split(/\r?\n/)) {
    const row = line.match(/(-?\d+,-?\d+,-?\d+,-?\d+,-?\d+,-?\d+,-?\d+)$/)?.[1];
    if (!row) continue;
    const [seed, x, y, z, expectedDensity, expectedHeight, expectedGraph] = row.split(',');
    const sampler = createEndIslandSampler(seed);
    const point = [+x,+y,+z];
    bits.setFloat32(0, sampler.outerIslands(...point));
    assert.equal(bits.getInt32(0), +expectedDensity, `End island density seed=${seed} at ${point}`);
    bits.setFloat32(0, sampler.heightValue(Math.trunc(+x / 8), Math.trunc(+z / 8)));
    assert.equal(bits.getInt32(0), +expectedHeight, `End island outer sampler seed=${seed} at ${point}`);
    let graph = endGraphs.get(seed);
    if (!graph) {
        graph = endKernel.density(seed, data, { islands: 'minecraft:end/islands' });
        endGraphs.set(seed, graph);
    }
    bits.setFloat32(0, graph.sample('islands', ...point));
    assert.equal(bits.getInt32(0), +expectedGraph, `End/islands graph seed=${seed} at ${point}`);
    endIslandCount += 3;
}
for (const graph of endGraphs.values()) graph.dispose();
assert.equal(endIslandCount, 126);
console.log(`${endIslandCount} End island sampler, simplex-height, and end/islands graph values match actual JAR bits.`);
const endChunkCases = JSON.parse(densityOutput.split(/\r?\n/).find(line => line.startsWith('DENSITY_END_CHUNKS:')).slice(19));
let endChunkCount = 0;
for (const row of endChunkCases) {
    const graph = endKernel.density(row.seed, data, { final: row.root }, { legacyRandom: true });
    try {
        const values = graph.sampleVolume('final', ...row.origin, 16, 128, 16);
        const actual = new Int32Array(values.buffer);
        assert.equal(actual.length, row.bits.length);
        for (let i=0;i<actual.length;i++) assert.equal(actual[i], row.bits[i], `End chunk density seed=${row.seed} origin=${row.origin} index=${i}`);
        endChunkCount += actual.length;
    } finally { graph.dispose(); }
}
endKernel.dispose();
assert.equal(endChunkCount, 131072);
console.log(`${endChunkCount} End full-chunk final-density values match JAR bits.`);
const stateOutput = run('java', ['-cp', classpath, 'BlockStateRegistryOracle']);
const blockStates = [];
const seenStateIds = new Set();
for (const line of stateOutput.split(/\r?\n/)) {
    if (!line.startsWith('STATE,')) continue;
    const [, idText, name, propertiesText = ''] = line.split(',');
    const id = Number(idText);
    assert.ok(Number.isSafeInteger(id) && id >= 0 && name?.includes(':'), `Malformed JAR block state: ${line}`);
    assert.ok(!seenStateIds.has(id), `Duplicate JAR block-state ID ${id}`);
    seenStateIds.add(id);
    const properties = Object.fromEntries(propertiesText.split(';').filter(Boolean).map(property => {
        const separator = property.indexOf('=');
        assert.ok(separator > 0, `Malformed block-state property: ${line}`);
        return [property.slice(0, separator), property.slice(separator + 1)];
    }));
    blockStates.push({ id, name, properties });
}
assert.ok(blockStates.length > 10000, `JAR block-state registry unexpectedly small: ${blockStates.length}`);
blockStates.sort((a, b) => a.id - b.id);
await writeFile(path.join(root, 'generated/block-states.json'), JSON.stringify({ source: lock, states: blockStates }));
console.log(`${blockStates.length} block-state IDs exported from the pinned JAR registry.`);
const legacyStateIds = createLegacyStateIdMap(blockStates);
const legacyBlockStates = createLegacyBlockStateMap(blockStates);
const legacyStateMappings = blockStates
    .filter(({ id }) => legacyStateIds.has(id))
    .map(({ id, name, properties }) => {
        const packedState = legacyBlockStates.get(id);
        return { stateId: id, name, properties, blockId: packedState >> 4, metadata: packedState & 15, packedState };
    });
assert.equal(legacyStateMappings.length, 77);
assert.equal(new Set(legacyStateMappings.map(({ name }) => name)).size, 17);
await writeFile(path.join(root, 'reference/legacy-block-state-map.json'), JSON.stringify({
    source: lock,
    registryStateCount: blockStates.length,
    mappings: legacyStateMappings
}, null, 2) + '\n');
console.log(`${legacyStateMappings.length} vanilla-state to legacy block/metadata mappings saved with the JAR reference.`);
await writeFile(path.join(root, 'generated/climate.json'), JSON.stringify({ source: lock, presets: exported }));
