import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { isExcludedVanillithContent } from '../content-policy.mjs';

const jar = process.argv[2];
if (!jar) throw new Error('Pass the pinned Minecraft client JAR');
const source = JSON.parse(await readFile(new URL('../../vanilla-worldgen/source-lock.json', import.meta.url)));
const bytes = await readFile(jar);
if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('Item visual source mismatch');
const zip = await JSZip.loadAsync(bytes);
const blocks = new Set(JSON.parse(await readFile(new URL('../generated/recipes-26.3.json', import.meta.url))).blockNames);
const models = new Map(), textures = new Set(), items = {}, unsupported = [];
async function model(name, seen = new Set()) {
    if (!name || seen.has(name)) return null;
    if (models.has(name)) return models.get(name);
    const [namespace, path] = name.includes(':') ? name.split(':') : ['minecraft', name];
    const file = zip.file(`assets/${namespace}/models/${path}.json`);
    if (!file) return null;
    const json = JSON.parse(await file.async('string'));
    const parent = await model(json.parent, new Set([...seen, name]));
    const merged = { textures: { ...parent?.textures, ...json.textures }, display: { ...parent?.display, ...json.display } };
    models.set(name, merged);
    return merged;
}
function staticModel(node, context) {
    if (!node) return null;
    if (node.type === 'minecraft:model') return node.model;
    if (node.property === 'minecraft:display_context') {
        const selected = node.cases?.find(entry => (Array.isArray(entry.when) ? entry.when : [entry.when]).includes(context));
        return staticModel(selected?.model ?? node.fallback, context);
    }
    // Resolve idle/default branches, never fabricate special renderers.
    return staticModel(node.on_false, context) ?? staticModel(node.fallback, context);
}
function layersOf(data) {
    return Object.entries(data?.textures ?? {}).filter(([key]) => /^layer\d+$/.test(key))
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([, value]) => value.replace(/^minecraft:/, ''));
}
for (const [path, file] of Object.entries(zip.files)) {
    const match = /^assets\/minecraft\/items\/(.+)\.json$/.exec(path);
    if (!match) continue;
    const name = `minecraft:${match[1]}`;
    if (blocks.has(name) || isExcludedVanillithContent(name)) continue;
    const root = JSON.parse(await file.async('string')).model;
    const data = await model(staticModel(root, 'gui'));
    const held = await model(staticModel(root, 'firstperson_righthand'));
    const layers = layersOf(data), heldLayers = layersOf(held);
    if (!layers.length || layers.some(texture => !texture.startsWith('item/') || !zip.file(`assets/minecraft/textures/${texture}.png`))) {
        unsupported.push(name); continue;
    }
    if (heldLayers.some(texture => !texture.startsWith('item/') || !zip.file(`assets/minecraft/textures/${texture}.png`)))
        throw new Error(`Invalid held texture for ${name}`);
    items[name] = { textures: layers.map(layer => layer.slice(5)),
        heldTextures: heldLayers.map(layer => layer.slice(5)), display: held?.display ?? data.display };
    for (const layer of [...layers, ...heldLayers]) textures.add(layer.slice(5));
}
for (const texture of textures) {
    const target = new URL(`../../../src/resources/terrain/pack/minecraft/textures/items/${texture}.png`, import.meta.url);
    await mkdir(new URL('.', target), { recursive: true });
    await writeFile(target, await zip.file(`assets/minecraft/textures/item/${texture}.png`).async('nodebuffer'));
}
await writeFile(new URL('../generated/item-visuals.json', import.meta.url), JSON.stringify({ source, items, textures: [...textures].sort(), unsupported }));
console.log(`Imported ${Object.keys(items).length} sprite item models and ${textures.size} textures; ${unsupported.length} special/dynamic item models remain unsupported.`);
