import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createVanillaKernel } from '../runtime.mjs';
import { runFeatureFixture } from '../test/feature-fixtures.mjs';
import { STRUCTURE_FEATURE_MODES, structureFeature } from '../test/structure-feature-fixtures.mjs';
import { createJavaLegacyRandom } from '../java-legacy-random.mjs';
import { endSpikesForSeed } from '../end-spike-feature.mjs';
import { transformStructurePosition } from '../structure-template.mjs';
import { compareJarTemplates } from '../test/template-comparison.mjs';
import { fossilData } from '../test/fossil-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [jar, libraryRoot] = process.argv.slice(2);
if (!jar || !libraryRoot) throw new Error('Usage: node scripts/verify-features.mjs <reference-client.jar> <launcher-libraries-directory>');
const lock = JSON.parse(await readFile(path.join(root, 'source-lock.json'), 'utf8'));
assert.equal(createHash('sha256').update(await readFile(jar)).digest('hex'), lock.sha256, 'Feature oracle JAR hash');
const libraries = new Map();
async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const name = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(name);
        else if (entry.name.endsWith('.jar') && !entry.name.includes('natives-')) {
            const group = path.dirname(path.dirname(name)), version = path.basename(path.dirname(name));
            if (!libraries.has(group) || version.localeCompare(libraries.get(group).version, undefined, { numeric: true }) > 0) libraries.set(group, { name, version });
        }
    }
}
await scan(libraryRoot);
const output = path.join(root, 'generated/oracle');
await mkdir(output, { recursive: true });
const classpath = [output, path.resolve(jar), ...[...libraries.values()].map(value => value.name)].join(path.delimiter);
function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: output });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command}: ${result.stderr.slice(-4000)}\n${result.stdout.split(/\r?\n/).filter(line => !/^(FEATURE|STRUCTURE|BEARD|TRANSFORM|TEMPLATES),/.test(line)).join('\n').slice(-6000)}`);
    return result.stdout;
}
const expanded = path.join(output, 'structure-feature-configs.json');
await writeFile(expanded, JSON.stringify(Object.fromEntries(STRUCTURE_FEATURE_MODES.map(mode => [mode, structureFeature(mode)]))));
run('javac', ['-cp', classpath, '-d', output, ...['FeatureOracle.java','StructureFeatureOracle.java','TemplateOracle.java'].map(name => path.join(root, 'reference', name))]);
const outputLines = run('java', ['-cp', classpath, 'FeatureOracle', expanded, path.resolve(jar)]).split(/\r?\n/);
const lines = outputLines.filter(line => line.startsWith('FEATURE,'));
const metadata = outputLines.filter(line => line.startsWith('STRUCTURE,')).map(line => JSON.parse(line.slice(10)));
const beardCases = JSON.parse(outputLines.find(line => line.startsWith('BEARD,')).slice(6));
const transforms = JSON.parse(outputLines.find(line => line.startsWith('TRANSFORM,')).slice(10));
const templates = JSON.parse(outputLines.find(line => line.startsWith('TEMPLATES,')).slice(10));
const templateStats = await compareJarTemplates(fossilData,templates);
assert.equal(metadata.length, 6, 'Expected independent legacy RNG, noise and spike oracles');
assert.equal(lines.length, 748 + STRUCTURE_FEATURE_MODES.length * 6, 'Expected every feature/seed oracle case');
const cases = lines.map(line => JSON.parse(line.slice(8)));
await writeFile(path.join(output, 'feature-oracle-candidate.json'), JSON.stringify(cases));
const kernel = await createVanillaKernel(await readFile(path.join(root, 'generated/worldgen.wasm')), JSON.parse(await readFile(path.join(root, 'generated/climate.json'), 'utf8')));
try {
    const failures = [];
    const beard = kernel.density('0', {}, { beard: { type: 'minecraft:beardifier' } });
    const bits = new DataView(new ArrayBuffer(4));
    try {
        for (const entry of beardCases) {
            beard.setBeardifier({ pieces: [{ box: { minX:-5,minY:-12,minZ:3,maxX:4,maxY:7,maxZ:11 }, terrainAdjustment: entry.adjustment, groundLevelDelta: entry.ground }],
                junctions: [{ x:-7,groundY:-9,z:13 }], affectedBox: { minX:-32,minY:-40,minZ:-28,maxX:32,maxY:40,maxZ:36 } });
            for (const [x,y,z,expected] of entry.samples) {
                bits.setFloat32(0, beard.sample('beard',x,y,z));
                assert.equal(bits.getInt32(0), expected, `Beardifier ${entry.adjustment} delta=${entry.ground} at ${x},${y},${z}`);
            }
        }
    } finally { beard.dispose(); }
    for (const entry of transforms) {
        const pos = ([x,y,z]) => ({x,y,z});
        const result = transformStructurePosition(pos(entry.pos), { rotation:entry.rotation,mirror:entry.mirror,rotationPivot:pos(entry.pivot) });
        assert.deepEqual([result.x,result.y,result.z], entry.result);
    }
    for (const entry of metadata) {
        assert.deepEqual(endSpikesForSeed(entry.seed), entry.spikes, `End spike layout seed=${entry.seed}`);
        const legacy = createJavaLegacyRandom(entry.seed);
        for (const draw of entry.draws) assert.deepEqual([String(legacy.nextLong()), legacy.nextInt(3), legacy.nextInt(1073741825), legacy.nextFloat(), legacy.nextDouble()], draw, `Legacy draws seed=${entry.seed}`);
        const random = kernel.random(entry.seed), bytes = new DataView(new ArrayBuffer(4));
        try {
            for (const definition of entry.noise) {
                const noise = random.normalNoise(definition.parameters, entry.seed, true);
                try {
                    for (const sample of definition.values) {
                        bytes.setFloat32(0, noise.sample(...sample.position));
                        assert.equal(bytes.getInt32(0), sample.bits, `Legacy positional noise seed=${entry.seed}, position=${sample.position}`);
                    }
                } finally { noise.dispose(); }
            }
            assert.equal(String(random.nextLong()), cases.find(c => c.seed === entry.seed && c.mode === 'single').nextLong, 'Independent noise must not consume feature RNG');
        } finally { random.dispose(); }
    }
    for (const entry of cases) {
        const random = kernel.random(entry.seed);
        try {
            const actual = runFeatureFixture(entry.mode, random, entry.seed);
            const expected = { succeeded: entry.succeeded, writes: entry.writes, marks: entry.marks, ticks: entry.ticks, destroyed: entry.destroyed, gatewayExits: entry.gatewayExits, effects: entry.effects, nextLong: entry.nextLong };
            if (!isDeepStrictEqual(actual, expected)) {
                const field = Object.keys(expected).find(key => !isDeepStrictEqual(actual[key], expected[key]));
                const a = actual[field], e = expected[field];
                let index = null;
                if (Array.isArray(e)) {
                    index = e.findIndex((value, i) => !isDeepStrictEqual(a[i], value));
                    if (index === -1) index = Math.min(a.length, e.length);
                }
                if (!failures.some(value => value.startsWith(`${entry.mode},`))) failures.push(`${entry.mode}, seed=${entry.seed}: ${field}${index == null ? '' : `[${index}], lengths ${a.length}/${e.length}`}; actual=${JSON.stringify(index == null ? a : a[index])}; expected=${JSON.stringify(index == null ? e : e[index])}; nextLong=${actual.nextLong}/${expected.nextLong}`);
            }
        } finally { random.dispose(); }
    }
    if (failures.length) throw new Error(failures.join('\n'));
} finally { kernel.dispose(); }
await writeFile(path.join(root, 'generated/feature-oracle.json'), JSON.stringify({ sourceSha256: lock.sha256, cases }, null, 2) + '\n');
await writeFile(path.join(root, 'generated/structure-oracle.json'), JSON.stringify({ sourceSha256: lock.sha256, cases: metadata }, null, 2) + '\n');
await writeFile(path.join(root, 'generated/template-oracle.json'), JSON.stringify({ sourceSha256: lock.sha256, beardCases, transforms, templates }) + '\n');
console.log(`Verified ${cases.length} original-JAR feature placements, ordered writes, loot/spawner/crystal effects, destruction, gateway exits, ticks, marks and RNG continuations; also independent legacy RNG, positional-noise bits and all ten End spikes for six seeds.`);
console.log(`Verified ${beardCases.reduce((n,c)=>n+c.samples.length,0)} nonempty WASM beardifier float bits and ${transforms.length} JAR template transforms.`);
console.log(`Verified ${templateStats.templates} JAR NBT templates, ${templateStats.palettes} palettes, ${templateStats.blocks} ordered block records and ${templateStats.states} palette states.`);
