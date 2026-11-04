import { readFile, readdir, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { VanillaChunk } from '../chunk.mjs';
import { carveConfiguredCanyon, carveConfiguredCave, isCarverStartChunk, largeFeatureRandom } from '../carvers.mjs';
import { CarvingMask, createCarverOutput, createWorldgenCarvingMask } from '../carving-mask.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [jar, libraryRoot] = process.argv.slice(2);
if (!jar || !libraryRoot) throw new Error('Usage: node scripts/verify-carvers.mjs <reference-client.jar> <launcher-libraries-directory>');
const libraries = new Map();
async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const name = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(name);
        else if (entry.name.endsWith('.jar') && !entry.name.includes('natives-')) {
            const group = path.dirname(path.dirname(name)), version = path.basename(path.dirname(name));
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
run('javac', ['-cp', classpath, '-d', output, path.join(root, 'reference/CarverOracle.java')]);
const oracleOutput = path.join(output, 'carver-oracle.csv');
const sinOutput = path.join(output, 'carver-sin.bin');
const traceOutput = path.join(output, 'carver-draw-trace.txt');
run('java', ['-cp', classpath, 'CarverOracle', path.resolve(jar), oracleOutput, sinOutput, traceOutput]);
const jarSin = new Int32Array(await readFile(sinOutput).then(buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)));
const jsSinBuffer = new ArrayBuffer(65536 * 4), jsSin = new Float32Array(jsSinBuffer), jsSinBits = new Int32Array(jsSinBuffer);
for (let i = 0; i < jsSin.length; i++) jsSin[i] = Math.sin(i / 10430.378350470453);
const sinMismatches = [];
for (let i = 0; i < jarSin.length; i++) if (jarSin[i] !== jsSinBits[i]) sinMismatches.push(i);
const rows = (await readFile(oracleOutput, 'utf8')).trim().split(/\r?\n/);
const jarDrawTrace = (await readFile(traceOutput, 'utf8')).trim().split(/\r?\n/);
const traceRandomBase = largeFeatureRandom(13n, -1, -1, 1);
const jsDrawTrace = [];
const traceRandom = new Proxy(traceRandomBase, { get(target, key) {
    const method = Reflect.get(target, key, target);
    if (typeof method !== 'function' || !String(key).startsWith('next')) return method;
    return (...args) => {
        const value = method.apply(target, args);
        const encoded = typeof value === 'bigint' ? value.toString() : key === 'nextFloat' ? new Int32Array(new Float32Array([value]).buffer)[0].toString() : String(value);
        jsDrawTrace.push(`${String(key)}${args.length ? `:${args[0]}` : ''}=${encoded}`);
        return value;
    };
} });
{
    const config = JSON.parse(await readFile(path.join(root, 'generated/vanilla-data.json'), 'utf8'))['data/minecraft/worldgen/carver/cave.json'];
    if (isCarverStartChunk(config, traceRandom)) {
        const context = { minY: -64, maxY: 320, seaLevel: 63 };
        const chunk = new VanillaChunk(-1, -1, -64, 384);
        const mask = createWorldgenCarvingMask(context);
        carveConfiguredCave(createCarverOutput(chunk, mask), { chunkX: -1, chunkZ: -1 }, context, traceRandom, config, (x, y, z) => mask.carve(x, y, z));
    }
}
const drawTraceParity = JSON.stringify(jsDrawTrace) === JSON.stringify(jarDrawTrace);
const data = JSON.parse(await readFile(path.join(root, 'generated/vanilla-data.json'), 'utf8'));
let starts = 0, carved = 0;
const mismatches = [];
for (const line of rows) {
    const [id, seedText, indexText, oxText, ozText, txText, tzText, minText, maxText, seaText, expectedStart, expectedMask] = line.split(',');
    const seed = BigInt(seedText), index = +indexText, ox = +oxText, oz = +ozText;
    const tx = +txText, tz = +tzText, minY = +minText, maxY = +maxText, seaLevel = +seaText;
    const config = data[`data/minecraft/worldgen/carver/${id.slice('minecraft:'.length)}.json`];
    assert.ok(config, `missing imported config for ${id}`);
    const random = largeFeatureRandom(seed, ox, oz, index);
    const actualStart = isCarverStartChunk(config, random);
    assert.equal(actualStart, expectedStart === 'true', `start ${id} seed=${seed} index=${index} origin=${ox},${oz}`);
    const chunk = new VanillaChunk(tx, tz, minY, maxY - minY);
    const context = { minY, maxY, seaLevel };
    const mask = createWorldgenCarvingMask(context);
    const output = createCarverOutput(chunk, mask);
    if (actualStart) {
        const carve = id === 'minecraft:canyon' ? carveConfiguredCanyon : carveConfiguredCave;
        carve(output, { chunkX: ox, chunkZ: oz }, context, random, config, (x, y, z) => mask.carve(x, y, z));
        starts++;
    }
    const actualBytes = Buffer.from(mask.bits), expectedBytes = Buffer.from(expectedMask, 'base64');
    if (!actualBytes.equals(expectedBytes)) {
        let bit = 0;
        while (bit < actualBytes.length * 8 && !!(actualBytes[bit >>> 3] & (1 << (bit & 7))) === !!(expectedBytes[bit >>> 3] & (1 << (bit & 7)))) bit++;
        const height = mask.maxY - mask.minY + 1;
        const describe = value => [Math.floor(value / height / 16), Math.floor(value / height) % 16, mask.minY + value % height];
        const count = bytes => { let n = 0; for (const byte of bytes) n += byte.toString(2).replaceAll('0', '').length; return n; };
        const differences = [];
        for (let i = 0; i < actualBytes.length * 8; i++) if (!!(actualBytes[i >>> 3] & (1 << (i & 7))) !== !!(expectedBytes[i >>> 3] & (1 << (i & 7)))) differences.push({ xyz: describe(i), js: !!(actualBytes[i >>> 3] & (1 << (i & 7))), jar: !!(expectedBytes[i >>> 3] & (1 << (i & 7))) });
        mismatches.push({ id, seed: seedText, index, origin: [ox, oz], target: [tx, tz], js: count(actualBytes), jar: count(expectedBytes), diff: differences.length, first: differences.slice(0, 4) });
    }
    if (!mask.isEmpty()) carved++;
}
assert.equal(rows.length, 960, 'Expected all fixed native carver probes');
if (mismatches.length) throw new Error(`${mismatches.length}/${rows.length} carving masks differ from the JAR; ${JSON.stringify(mismatches.slice(0, 12))}; SIN table differences=${sinMismatches.length} first=${sinMismatches.slice(0, 12)}; debug draw parity=${drawTraceParity}; Java draws=${jarDrawTrace.length}, JS draws=${jsDrawTrace.length}, first Java=${jarDrawTrace.slice(0, 30)}, first JS=${jsDrawTrace.slice(0, 30)}`);
console.log(`${rows.length} JAR comparisons passed (${starts} starts, ${carved} non-empty masks): exact start RNG and every carving-mask bit across cave, extra cave, canyon, Nether cave, eight seeds, two indices, and three origin/target offsets.`);
