import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import sharp from 'sharp';
import { terrainStateIds } from '../chunk-service.mjs';

const jar = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const decoration = process.argv.includes('--decoration');
if (!jar) throw new Error('Pass the reference client JAR');
const lock = JSON.parse(await readFile(new URL('../source-lock.json', import.meta.url)));
const bytes = await readFile(jar);
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(bytes) !== lock.sha256) throw new Error('Render JAR does not match source lock');
const zip = await JSZip.loadAsync(bytes);
const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url)));
const registry = JSON.parse(await readFile(new URL('../generated/block-states.json', import.meta.url)));
if (registry.source.sha256 !== lock.sha256) throw new Error('Registry source mismatch');
const defaults = terrainStateIds(registry);
const blockTag = name => data[`data/minecraft/tags/block/${name.slice('minecraft:'.length)}.json`];
function resolveBlockTag(name, seen = new Set()) {
    if (seen.has(name)) throw new Error(`Block tag cycle while importing log models: ${name}`);
    const tag = blockTag(name);
    if (!tag) throw new Error(`Missing block tag while importing log models: ${name}`);
    seen.add(name);
    const values = tag.values.flatMap(value => {
        const entry = typeof value === 'string' ? value : value.id;
        if (!entry.startsWith('#')) return [entry];
        try { return resolveBlockTag(entry.slice(1), seen); }
        catch (error) {
            if (typeof value === 'object' && value.required === false) return [];
            throw error;
        }
    });
    seen.delete(name);
    return [...new Set(values)];
}
const logNames = new Set(resolveBlockTag('minecraft:logs').filter(name => /(?:_log|_wood)$/.test(name)));
const names = new Set(['minecraft:stone', 'minecraft:netherrack', 'minecraft:end_stone',
    'minecraft:cobblestone', 'minecraft:oak_planks', 'minecraft:bricks',
    'minecraft:mossy_cobblestone', 'minecraft:clay']);
for (const [path, rule] of Object.entries(data)) if (path.includes('/material_rule/')) {
    JSON.stringify(rule, (key, value) => { if (['result_state', 'ore_block', 'raw_ore_block', 'filler_block'].includes(key)) names.add(value); return value; });
}
for (const color of ['orange', 'yellow', 'brown', 'red', 'white', 'light_gray']) names.add(`minecraft:${color}_terracotta`);
for (const name of logNames) if (registry.states.some(state => state.name === name && ['x', 'y', 'z'].includes(state.properties.axis))) names.add(name);
if (decoration) {
    names.clear();
    for (const wood of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']) {
        names.add(`minecraft:${wood}_log`);
        names.add(`minecraft:${wood}_leaves`);
    }
    names.add('minecraft:azalea_leaves');
    names.add('minecraft:flowering_azalea_leaves');
}
const resources = {}, textures = {}, blocks = [], unsupported = [];
const id = name => name.includes(':') ? name : `minecraft:${name}`;
async function json(path) {
    const file = zip.file(path);
    if (!file) throw new Error(`Missing JAR resource ${path}`);
    const raw = await file.async('nodebuffer');
    resources[path] = hash(raw);
    return JSON.parse(raw);
}
async function model(name, seen = new Set()) {
    name = id(name);
    if (seen.has(name)) throw new Error(`Model parent cycle ${name}`);
    seen.add(name);
    const [namespace, path] = name.split(':');
    const own = await json(`assets/${namespace}/models/${path}.json`);
    const parent = own.parent ? await model(own.parent, seen) : {};
    return { ...parent, ...own, textures: { ...parent.textures, ...own.textures } };
}
function texture(value, definitions) {
    const seen = new Set();
    while (value?.startsWith('#')) {
        if (seen.has(value)) throw new Error('Texture reference cycle');
        seen.add(value); value = definitions[value.slice(1)];
    }
    if (typeof value !== 'string') throw new Error('Unresolved model texture');
    return id(value);
}
for (const name of [...names].sort()) {
    if (['minecraft:air', 'minecraft:water', 'minecraft:lava'].includes(name)) continue;
    const axisLog = logNames.has(name);
    const aliases = decoration ? registry.states.filter(state => state.name === name &&
        (name.endsWith('_leaves') || axisLog && ['x', 'y', 'z'].includes(state.properties.axis))) : [];
    // Snow-covered soil has a different cube model from its default state.
    // Import those explicit aliases as well, so chunks containing snowy
    // podzol/mycelium/grass do not fail the whole render mapping check.
    const states = axisLog ? registry.states.filter(state => state.name === name && ['x', 'y', 'z'].includes(state.properties.axis)) :
        decoration ? [aliases[0]].filter(Boolean) : [
            registry.states.find(state => state.id === defaults[name]),
            ...registry.states.filter(state => state.name === name && state.properties.snowy === 'true')
        ].filter(Boolean);
    if (!states.length) { unsupported.push({ name, reason: 'No explicit terrain default state' }); continue; }
    const path = `assets/minecraft/blockstates/${name.slice(10)}.json`;
    const definition = await json(path);
    for (const state of states) {
    const variant = Object.entries(definition.variants ?? {}).find(([key]) => !key || key.split(',').every(pair => {
        const [property, value] = pair.split('='); return state.properties[property] === value;
    }))?.[1];
    if (!variant) { unsupported.push({ name, reason: 'Multipart model requires a dedicated renderer' }); continue; }
    const choices = Array.isArray(variant) ? variant : [variant];
    const choice = choices[0];
    const resolved = await model(choice.model);
    const element = resolved.elements?.[0];
    const leaves = decoration && name.endsWith('_leaves');
    const special = leaves || ['minecraft:grass_block', 'minecraft:powder_snow'].includes(name);
    if (decoration && (choices.length !== 1 || resolved.elements?.length !== 1 ||
        JSON.stringify(element?.from) !== '[0,0,0]' || JSON.stringify(element?.to) !== '[16,16,16]')) {
        throw new Error(`Decoration cube model needs explicit support: ${name}`);
    }
    if (!special && !axisLog && (choice.x || choice.y || resolved.elements?.length !== 1 || element.rotation ||
        JSON.stringify(element.from) !== '[0,0,0]' || JSON.stringify(element.to) !== '[16,16,16]' ||
        Object.keys(element.faces ?? {}).length !== 6 || Object.values(element.faces).some(face => face.tintindex !== undefined || face.rotation || face.uv && JSON.stringify(face.uv) !== '[0,0,16,16]'))) {
        unsupported.push({ name, reason: 'Layered/tinted/non-cube/rotated model requires a dedicated renderer' }); continue;
    }
    const faces = {};
    const faceRotations = {};
    const elements = [];
    for (const part of resolved.elements) {
      if (!axisLog && (part.rotation || choice.x || choice.y)) throw new Error(`Unsupported special model rotation ${name}`);
        const entries = {};
        for (const [face, entry] of Object.entries(part.faces)) {
        const name = texture(entry.texture, resolved.textures);
        const [namespace, path] = name.split(':');
        const source = `assets/${namespace}/textures/${path}.png`;
        if (!textures[name]) {
            const png = await zip.file(source)?.async('nodebuffer');
            if (!png) throw new Error(`Missing JAR texture ${source}`);
            textures[name] = { source, sha256: hash(png), dataUrl: `data:image/png;base64,${png.toString('base64')}` };
        }
            if (!faces[face]) faces[face] = name;
            faceRotations[face] = (entry.rotation ?? 0) / 90;
            entries[face] = { ...entry, texture: name };
      }
      elements.push({ from: part.from, to: part.to, faces: entries });
    }
    if (axisLog) {
        const end = texture('#end', resolved.textures), side = texture('#side', resolved.textures);
        const endFaces = state.properties.axis === 'x' ? ['east', 'west'] :
            state.properties.axis === 'y' ? ['up', 'down'] : ['north', 'south'];
        for (const face of ['up', 'down', 'north', 'south', 'east', 'west']) {
            faces[face] = endFaces.includes(face) ? end : side;
            faceRotations[face] = state.properties.axis === 'x' && ['up', 'down', 'north', 'south'].includes(face) ||
                state.properties.axis === 'z' && ['east', 'west'].includes(face) ? 1 : 0;
        }
    }
    blocks.push({ name, stateId: state.id, properties: state.properties, faces,
        ...(axisLog ? { faceRotations } : {}),
        ...(decoration ? { stateIds: axisLog ? [state.id] : aliases.map(entry => entry.id) } : {}),
        ...(leaves ? { cutout: true, foliage: true,
            ...(name === 'minecraft:spruce_leaves' ? { constantTint: 0x619961 } : name === 'minecraft:birch_leaves' ? { constantTint: 0x80a755 } : {}) } : {}),
        ...(special ? { elements } : {}),
        translucent: name === 'minecraft:ice', alternatives: choices });
    }
}
const colorSource = `assets/minecraft/textures/colormap/${decoration ? 'foliage' : 'grass'}.png`;
const colorBytes = await zip.file(colorSource).async('nodebuffer');
const { data: pixels, info } = await sharp(colorBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.width !== 256 || info.height !== 256 || info.channels !== 3) throw new Error('Invalid grass colormap');
const biomeTints = [];
for (const path of Object.keys(data).filter(path => path.startsWith('data/minecraft/worldgen/biome/')).sort()) {
    const biome = await json(path);
    biomeTints.push({ name: `minecraft:${path.split('/').pop().slice(0, -5)}`, temperature: biome.temperature,
        downfall: biome.downfall, effects: biome.effects });
}
const result = { source: lock, blocks, textures, resources, unsupported,
    [decoration ? 'foliageColors' : 'grassColors']: { source: colorSource, sha256: hash(colorBytes), pixelsBase64: pixels.toString('base64') }, biomeTints,
    limitations: ['Weighted model selection for non-log blocks is not yet applied', 'Non-log states with properties are not expanded into terrain mappings', 'Swamp grass-color noise modifier remains pending'] };
if (decoration) result.limitations = ['Native leaf lighting is adapted, not ported'];
await writeFile(new URL(decoration ? '../generated/decoration-render.json' : '../generated/terrain-render.json', import.meta.url), JSON.stringify(result));
console.log(`${blocks.length} terrain states, ${Object.keys(textures).length} original JAR textures; ${unsupported.length} models explicitly pending`);
if (!decoration) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), jar, '--decoration'], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Decoration render import failed');
    const features = spawnSync(process.execPath, [fileURLToPath(new URL('./import-feature-render.mjs', import.meta.url)), jar], { stdio: 'inherit' });
    if (features.error || features.status !== 0) throw new Error('Feature render import failed');
}
