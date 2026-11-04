import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [jar, libraryRoot] = process.argv.slice(2);
if (!jar || !libraryRoot) throw new Error('Pass the reference JAR and launcher libraries directory');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(path.join(root, 'source-lock.json')));
const registry = JSON.parse(await readFile(path.join(root, 'generated/block-states.json')));
if (createHash('sha256').update(await readFile(jar)).digest('hex') !== source.sha256 || registry.source.sha256 !== source.sha256) throw new Error('Native block rules source mismatch');
const libraries = new Map();
async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const name = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(name);
        else if (entry.name.endsWith('.jar') && !/natives-|sources|javadoc/.test(entry.name)) {
            const group = path.dirname(path.dirname(name)), version = path.basename(path.dirname(name));
            const current = libraries.get(group);
            if (!current || version.localeCompare(current.version, undefined, { numeric: true }) > 0) libraries.set(group, { name, version });
        }
    }
}
await scan(libraryRoot);
const output = path.join(root, 'generated/oracle');
await mkdir(output, { recursive: true });
const classpath = [output, path.resolve(jar), ...[...libraries.values()].map(entry => entry.name)].join(path.delimiter);
function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: output });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command}: ${result.stderr}\n${result.stdout}`);
    return result.stdout;
}
run('javac', ['-cp', classpath, '-d', output, path.join(root, 'reference/BlockRulesOracle.java')]);
const lines = run('java', ['-cp', classpath, 'BlockRulesOracle']);
const defaults = {}, states = [], survival = {}, faces = [], occlusionShapes = [];
for (const line of lines.split(/\r?\n/)) {
    const [type, id, ...values] = line.split(',');
    if (type === 'DEFAULT') defaults[id] = Number(values[0]);
    if (type === 'FACE') {
        const stateId = Number(id), masks = values.map(Number);
        if (!Number.isInteger(stateId) || faces[stateId] || masks.length !== 10 || masks.slice(0, 4).some(value => !Number.isInteger(value) || value < 0 || value > 63) || masks.slice(4).some(value => !Number.isInteger(value) || value < 0 || value >= 1024)) throw new Error('Malformed native face row');
        faces[stateId] = { support: masks[0], collision: masks[1], sturdy: masks[2], occlusion: masks[3], occlusionShapes: masks.slice(4) };
    }
    if (type === 'SHAPE') {
        const shapeId = Number(id), mask = values[0];
        if (!Number.isInteger(shapeId) || shapeId !== occlusionShapes.length || values.length !== 1 || !/^[0-9a-f]{64}$/.test(mask)) throw new Error('Malformed native light occlusion shape');
        occlusionShapes.push(mask);
    }
    if (type === 'SURVIVAL') {
        if (!['vegetation', 'double_vegetation'].includes(values[0]) || values.length !== 1) throw new Error('Malformed native survival row');
        survival[id] = values[0];
    }
    if (type !== 'RULE') continue;
    const stateId = Number(id);
    if (!Number.isInteger(stateId) || states[stateId] || values.length !== 15) throw new Error('Malformed native rule row');
    const booleans = values.slice(0, 7).map(value => {
        if (!['true', 'false'].includes(value)) throw new Error('Malformed native rule predicate');
        return value === 'true';
    });
    const [solid, solidRender, canOcclude, replaceable, fluidEmpty, sourceWater, liquid] = booleans;
    if (!['true', 'false'].includes(values[8])) throw new Error('Malformed native support predicate');
    if (!['true', 'false'].includes(values[9])) throw new Error('Malformed native fluid source predicate');
    if (!['true', 'false'].includes(values[10])) throw new Error('Malformed native full collision predicate');
    const lightEmission = Number(values[11]), lightDampening = Number(values[12]);
    if (!Number.isInteger(lightEmission) || lightEmission < 0 || lightEmission > 15 || !Number.isInteger(lightDampening) || lightDampening < 0 || lightDampening > 15) throw new Error('Malformed native light rule');
    if (!['true', 'false'].includes(values[13])) throw new Error('Malformed native light shape predicate');
    const destroySpeed = Number(values[14]);
    if (!Number.isFinite(destroySpeed) || destroySpeed < -1) throw new Error('Malformed native destroy speed');
    states[stateId] = { id: stateId, solid, solidRender, canOcclude, replaceable, fluidEmpty, sourceWater, liquid, fluid: values[7], sturdyUp: values[8] === 'true', fluidSource: values[9] === 'true', collisionFullBlock: values[10] === 'true', lightEmission, lightDampening, useShapeForLightOcclusion: values[13] === 'true', destroySpeed };
}
if (states.length !== registry.states.length || registry.states.some(state => !states[state.id])) throw new Error('Native rule registry coverage mismatch');
if (faces.length !== registry.states.length || registry.states.some(state => !faces[state.id])) throw new Error('Native face registry coverage mismatch');
for (const state of states) {
    const shapeIds = faces[state.id].occlusionShapes;
    if (shapeIds.some(shapeId => shapeId >= occlusionShapes.length)) throw new Error('Native light occlusion shape reference is out of range');
    Object.assign(state, { faces: faces[state.id] });
}
for (const [name, id] of Object.entries(defaults)) if (registry.states.find(state => state.id === id)?.name !== name) throw new Error('Native default-state registry mismatch');
await writeFile(path.join(root, 'generated/block-rules.json'), JSON.stringify({ source, defaults, states, survival, occlusionShapes }));
console.log(`${states.length} native block-state rules, ${Object.keys(defaults).length} exact default states, ${occlusionShapes.length} interned light occlusion shapes`);
