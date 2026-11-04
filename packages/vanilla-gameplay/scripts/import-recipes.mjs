import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const jar = process.argv[2];
if (!jar) throw new Error('Pass the reference client JAR');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(await readFile(path.resolve(root, '../vanilla-worldgen/source-lock.json'), 'utf8'));
const blockRegistry = JSON.parse(await readFile(path.resolve(root, '../vanilla-worldgen/generated/block-states.json'), 'utf8'));
const bytes = await readFile(jar);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== source.sha256) throw new Error(`Recipe source mismatch: ${sha256}`);

const zip = await JSZip.loadAsync(bytes);
const recipes = {};
const itemTags = {};
const blockTags = {};
const blockLootTables = {};
for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (/^data\/[^/]+\/recipe\/.*\.json$/.test(name)) {
        recipes[name.slice('data/'.length, -'.json'.length).replace('/recipe/', ':')] = JSON.parse(await entry.async('string'));
    } else if (/^data\/[^/]+\/tags\/item\/.*\.json$/.test(name)) {
        itemTags[name.slice('data/'.length, -'.json'.length).replace('/tags/item/', ':')] = JSON.parse(await entry.async('string'));
    } else if (/^data\/[^/]+\/tags\/block\/.*\.json$/.test(name)) {
        blockTags[name.slice('data/'.length, -'.json'.length).replace('/tags/block/', ':')] = JSON.parse(await entry.async('string'));
    } else if (/^data\/[^/]+\/loot_table\/blocks\/.*\.json$/.test(name)) {
        blockLootTables[name.slice('data/'.length, -'.json'.length).replace('/loot_table/blocks/', ':')] = JSON.parse(await entry.async('string'));
    }
}
if (Object.keys(recipes).length < 1000 || Object.keys(blockLootTables).length < 1000 || !recipes['minecraft:oak_planks'] || !itemTags['minecraft:oak_logs']) {
    throw new Error('Pinned JAR recipe/tag/block-loot data is incomplete');
}

const output = path.join(root, 'generated');
await mkdir(output, { recursive: true });
const blockNames = [...new Set(blockRegistry.states.map(state => state.name))];
await writeFile(path.join(output, 'recipes-26.3.json'), JSON.stringify({ source, recipes, itemTags, blockTags, blockLootTables, blockNames }));
console.log(`${Object.keys(recipes).length} recipes, ${Object.keys(itemTags).length} item tags, ${Object.keys(blockTags).length} block tags and ${Object.keys(blockLootTables).length} block loot tables imported from the reference JAR`);
