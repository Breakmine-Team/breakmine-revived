import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';

const [jar, librariesRoot] = process.argv.slice(2);
if (!jar || !librariesRoot) throw new Error('Pass the reference JAR and launcher libraries');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(new URL('../../vanilla-worldgen/source-lock.json', import.meta.url)));
const bytes = await readFile(jar);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(bytes) !== source.sha256) throw new Error('Gameplay source mismatch');
const libraries = new Map();
async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(file);
        else if (entry.name.endsWith('.jar') && !/natives-|sources|javadoc/.test(entry.name)) {
            const key = path.dirname(dir), version = path.basename(dir);
            if (!libraries.has(key) || version.localeCompare(libraries.get(key).version, undefined, { numeric: true }) > 0)
                libraries.set(key, { file, version });
        }
    }
}
await scan(librariesRoot);
const output = path.join(root, 'generated');
await mkdir(output, { recursive: true });
const classpath = [output, path.resolve(jar), ...[...libraries.values()].map(entry => entry.file)].join(path.delimiter);
function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', cwd: output, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr + result.stdout);
    return result.stdout;
}
run('javac', ['-cp', classpath, '-d', output, path.join(root, 'reference/GameplayOracle.java')]);
const items = {}, temperatures = [];
for (const line of run('java', ['-cp', classpath, 'GameplayOracle']).split(/\r?\n/)) {
    const [type, ...values] = line.split(',');
    if (type === 'ITEM') {
        const [name, damage, speed, nutrition, saturation, maxStackSize, durability, useDurationTicks, canAlwaysEat, hasConsumeEffects, attackDurabilityDamage, swingType, swingDuration, equipmentSlot, armor, armorToughness, knockbackResistance, damageOnHurt] = values;
        items[name] = { attackDamage: +damage, attackSpeed: +speed, nutrition: +nutrition, saturation: +saturation,
            maxStackSize: +maxStackSize, durability: +durability, useDurationTicks: +useDurationTicks,
            canAlwaysEat: canAlwaysEat === 'true', hasConsumeEffects: hasConsumeEffects === 'true',
            attackDurabilityDamage: +attackDurabilityDamage, attackAnimation: { type: swingType, duration: +swingDuration },
            ...(equipmentSlot ? { equipmentSlot, armor: +armor, armorToughness: +armorToughness, knockbackResistance: +knockbackResistance, damageOnHurt: damageOnHurt === 'true' } : {}) };
    } else if (type === 'TOOL') {
        const [name, encoded] = values;
        if (!items[name]) throw new Error(`Tool emitted before its item: ${name}`);
        items[name].tool = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } else if (type === 'TEMP') temperatures.push(values.map(Number));
}
if (!items['minecraft:diamond_sword'] || temperatures.length !== 4) throw new Error('Incomplete gameplay oracle');
const zip = await JSZip.loadAsync(bytes), sprites = {};
for (const name of ['heart/container', 'heart/container_blinking', 'heart/full', 'heart/half', 'heart/full_blinking', 'heart/half_blinking', 'food_empty', 'food_full', 'food_half', 'hotbar', 'hotbar_selection']) {
    const resource = `assets/minecraft/textures/gui/sprites/hud/${name}.png`;
    const png = await zip.file(resource)?.async('nodebuffer');
    if (!png) throw new Error(`Missing HUD sprite ${resource}`);
    const target = new URL(`../../../src/resources/gui/sprites/hud/${name}.png`, import.meta.url);
    await mkdir(path.dirname(fileURLToPath(target)), { recursive: true });
    await writeFile(target, png);
    sprites[name] = { resource, sha256: hash(png), dataUrl: `data:image/png;base64,${png.toString('base64')}` };
}
await writeFile(path.join(output, 'gameplay.json'), JSON.stringify({ source, items, temperatures, sprites }));
console.log(`Imported ${Object.keys(items).length} item attributes/foods, ${Object.keys(sprites).length} native HUD sprites and temperature oracle`);
