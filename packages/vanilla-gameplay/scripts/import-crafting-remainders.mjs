import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const [jar, libraryRoot] = process.argv.slice(2);
if (!jar || !libraryRoot) throw new Error('Pass the reference JAR and launcher libraries directory');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(new URL('../../vanilla-worldgen/source-lock.json', import.meta.url)));
if (createHash('sha256').update(await readFile(jar)).digest('hex') !== source.sha256) throw new Error('Remainder source mismatch');
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
const cp = [output, path.resolve(jar), ...[...libraries.values()].map(x => x.name)].join(path.delimiter);
function run(cmd, args) {
    const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: output });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${cmd}: ${result.stderr}\n${result.stdout}`);
    return result.stdout;
}
run('javac', ['-cp', cp, '-d', output, path.join(root, 'scripts/CraftingRemainderOracle.java')]);
const items = {};
for (const line of run('java', ['-cp', cp, 'CraftingRemainderOracle']).split(/\r?\n/)) {
    const [kind, name, result, rawCount] = line.split(',');
    if (kind !== 'REMAINDER') continue;
    const count = Number(rawCount);
    if (!name || !result || !Number.isInteger(count) || count < 1) throw new Error(`Invalid remainder: ${line}`);
    items[name] = { id: result, count };
}
await writeFile(path.join(root, 'generated/crafting-remainders.json'), JSON.stringify({ source, items }));
console.log(`Imported crafting remainders for ${Object.keys(items).length} items`);
