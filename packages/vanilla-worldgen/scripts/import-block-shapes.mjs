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
if (createHash('sha256').update(await readFile(jar)).digest('hex') !== source.sha256 || registry.source.sha256 !== source.sha256) throw new Error('Native block shape source mismatch');
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
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, cwd: output });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command}: ${result.stderr}\n${result.stdout}`);
    return result.stdout;
}
run('javac', ['-cp', classpath, '-d', output, path.join(root, 'reference/BlockShapesOracle.java')]);
const lines = run('java', ['-cp', classpath, 'BlockShapesOracle']);
const shapes = [], shapeIds = new Map(), states = [], failures = [];
function shapeId(value) {
    if (shapeIds.has(value)) return shapeIds.get(value);
    const boxes = value ? value.split(';').map(box => box.split(',').map(Number)) : [];
    if (boxes.some(box => box.length !== 6 || box.some(n => !Number.isFinite(n)))) throw new Error('Malformed shape');
    const id = shapes.length; shapes.push(boxes); shapeIds.set(value, id); return id;
}
for (const line of lines.split(/\r?\n/)) {
    const parts = line.split('|');
    if (parts.length !== 3 || !/^\d+$/.test(parts[0])) continue;
    const id = Number(parts[0]);
    if (parts[1] === 'ERROR') { failures.push({ id, error: parts[2] }); states[id] = null; }
    else states[id] = [shapeId(parts[1]), shapeId(parts[2])];
}
if (states.length !== registry.states.length || registry.states.some(state => states[state.id] === undefined)) throw new Error('Native shape registry coverage mismatch');
await writeFile(path.join(root, 'generated/block-shapes.json'), JSON.stringify({ source, shapes, states, failures }));
console.log(`Imported ${states.length} states, ${shapes.length} shapes; ${failures.length} states need contextual fallback`);
