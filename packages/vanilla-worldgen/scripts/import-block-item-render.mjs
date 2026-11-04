import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';

const jar = process.argv[2];
if (!jar) throw new Error('Pass the pinned client JAR');
const root = new URL('../', import.meta.url);
const source = JSON.parse(await readFile(new URL('source-lock.json', root)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(jar);
if (hash(bytes) !== source.sha256) throw new Error('Feature render source mismatch');
const zip = await JSZip.loadAsync(bytes);
const registry = JSON.parse(await readFile(new URL('generated/block-states.json', root)));
const blockRules = JSON.parse(await readFile(new URL('generated/block-rules.json', root)));
const data = JSON.parse(await readFile(new URL('generated/vanilla-data.json', root)));
const resources = {}, textures = {}, blocks = [];
const qualify = name => name.includes(':') ? name : `minecraft:${name}`;
async function json(path) {
    const bytes = await zip.file(path)?.async('nodebuffer');
    if (!bytes) throw new Error(`Missing native resource ${path}`);
    resources[path] = hash(bytes);
    return JSON.parse(bytes);
}
async function model(name, active = new Set()) {
    name = qualify(name);
    if (active.has(name)) throw new Error('Native model cycle');
    active.add(name);
    const [namespace, path] = name.split(':');
    const own = await json(`assets/${namespace}/models/${path}.json`);
    const parent = own.parent ? await model(own.parent, active) : {};
    active.delete(name);
    return { ...parent, ...own, textures: { ...parent.textures, ...own.textures } };
}
function matches(when, properties) {
    if (!when) return true;
    if (when.OR) return when.OR.some(w => matches(w, properties));
    if (when.AND) return when.AND.every(w => matches(w, properties));
    return Object.entries(when).every(([key, value]) => value.split('|').includes(properties[key]));
}
async function texture(ref, definitions) {
    const active = new Set();
    while (true) {
        if (ref && typeof ref === 'object') ref = ref.sprite;
        if (typeof ref !== 'string') throw new Error('Unresolved native texture');
        if (!ref.startsWith('#')) break;
        if (active.has(ref)) throw new Error('Native texture cycle');
        active.add(ref); ref = definitions[ref.slice(1)];
        if (!ref) throw new Error('Unresolved native texture');
    }
    const name = qualify(ref);
    if (!textures[name]) {
        const [namespace, path] = name.split(':');
        const file = `assets/${namespace}/textures/${path}.png`;
        const png = await zip.file(file)?.async('nodebuffer');
        if (!png) throw new Error(`Missing native texture ${file}`);
        const metadata = await sharp(png).metadata();
        const mcmetaFile = zip.file(`assets/${namespace}/textures/${path}.png.mcmeta`);
        const mcmetaBytes = await mcmetaFile?.async('nodebuffer');
        if (mcmetaBytes) resources[`assets/${namespace}/textures/${path}.png.mcmeta`] = hash(mcmetaBytes);
        const animation = mcmetaBytes ? JSON.parse(mcmetaBytes.toString('utf8')).animation ?? {} : null;
        const frameWidth = animation?.width ?? metadata.width;
        const frameHeight = animation?.height ?? frameWidth;
        if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || frameWidth <= 0 || frameHeight <= 0 ||
            metadata.width % frameWidth || metadata.height % frameHeight) throw new Error(`Unsupported native animation frame dimensions: ${name}`);
        const frameCount = metadata.width / frameWidth * (metadata.height / frameHeight);
        const frames = [];
        for (let index = 0; index < frameCount; index++) {
            const columns = metadata.width / frameWidth;
            const frame = await sharp(png).extract({ left: (index % columns) * frameWidth, top: Math.floor(index / columns) * frameHeight, width: frameWidth, height: frameHeight }).resize(16, 16, { kernel: 'nearest' }).png().toBuffer();
            frames.push(`data:image/png;base64,${frame.toString('base64')}`);
        }
        const sequence = Array.isArray(animation?.frames) ? animation.frames.map(frame => typeof frame === 'number' ? frame : frame.index) : frames.map((_, index) => index);
        if (sequence.some(index => !Number.isInteger(index) || index < 0 || index >= frames.length)) throw new Error(`Invalid native animation sequence: ${name}`);
        const cutout = metadata.hasAlpha && (await sharp(png).stats()).channels.at(-1).min < 255;
        textures[name] = { source: file, sha256: hash(png), cutout, ...(mcmetaBytes ? { mcmeta: `assets/${namespace}/textures/${path}.png.mcmeta`, mcmetaSha256: hash(mcmetaBytes) } : {}),
            animation: mcmetaBytes ? { frames: sequence.map((index, i) => ({ index, time: typeof animation.frames?.[i] === 'object' ? animation.frames[i].time ?? animation.frametime ?? 1 : animation.frametime ?? 1 })), frametime: animation.frametime ?? 1, interpolate: animation.interpolate === true } : null,
            dataUrl: frames[0], frames };
    }
    return name;
}
async function chestTexture(name, region) {
    const source = 'assets/minecraft/textures/entity/chest/normal.png';
    const png = await zip.file(source)?.async('nodebuffer');
    if (!png) throw new Error(`Missing native texture ${source}`);
    resources[source] = hash(png);
    const data = await sharp(png).extract(region).resize(16, 16, { kernel: 'nearest' }).png().toBuffer();
    const textureName = `minecraft:block/vanillith_chest_${name}`;
    textures[textureName] = { source, sha256: hash(png), crop: region, derivedSha256: hash(data), dataUrl: `data:image/png;base64,${data.toString('base64')}` };
    return textureName;
}
const chestTextures = {
    front: await chestTexture('front', { left: 14, top: 14, width: 28, height: 29 }),
    side: await chestTexture('side', { left: 0, top: 14, width: 14, height: 29 }),
    top: await chestTexture('top', { left: 14, top: 0, width: 28, height: 14 })
};
const plants = new Set(['short_grass', 'fern', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'sugar_cane', 'glow_lichen', 'vine', 'firefly_bush', 'tall_grass', 'large_fern', 'sculk_vein', 'dead_bush', 'short_dry_grass', 'tall_dry_grass', 'brown_mushroom', 'red_mushroom', 'shelf_mushroom', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'open_eyeblossom', 'closed_eyeblossom', 'pink_petals', 'wildflowers', 'bush', 'sweet_berry_bush', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'pale_oak_sapling']);
const imported = (await Promise.all(['terrain-render', 'decoration-render', 'feature-render'].map(async name =>
    JSON.parse(await readFile(new URL(`generated/${name}.json`, root))).blocks))).flat();
const importedNames = new Set(imported.map(block => block.name));
const importedStates = new Set(imported.flatMap(block => [block.stateId, ...(block.stateIds ?? [])]));
const excludedNames = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:water', 'minecraft:lava']);
// Render IDs are currently limited to 12 bits. Prioritize complete state
// models for common building blocks until native state IDs can be separated
// from renderer IDs.
const cornerStairs = new Set(['oak', 'spruce', 'birch', 'dark_oak', 'cobblestone', 'stone_brick', 'brick', 'quartz', 'cobbled_deepslate'].map(name => `minecraft:${name}_stairs`));
const hingedDoors = new Set(['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'iron'].map(name => `minecraft:${name}_door`));
const trapdoors = new Set(['oak', 'spruce', 'birch', 'jungle', 'iron', 'copper'].map(name => `minecraft:${name}_trapdoor`));
const gates = new Set(['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'].map(name => `minecraft:${name}_fence_gate`));
const selected = registry.states.filter(state => {
    if (importedStates.has(state.id) || excludedNames.has(state.name)) return false;
    if (blockRules.defaults[state.name] === state.id && !importedNames.has(state.name)) return true;
    const p = state.properties ?? {};
    return state.name.endsWith('_slab') && p.waterlogged === 'false' ||
        state.name.endsWith('_stairs') && p.waterlogged === 'false' && (p.shape === 'straight' || cornerStairs.has(state.name)) ||
        state.name.endsWith('_door') && p.powered === 'false' && (p.hinge === 'left' || hingedDoors.has(state.name)) ||
        trapdoors.has(state.name) && p.waterlogged === 'false' && p.powered === 'false' ||
        gates.has(state.name) && p.powered === 'false' && p.in_wall === 'false';
});
const extraNames = new Set(selected.map(state => state.name));
const requiredNames = new Set(extraNames);
const unsupported = [];
const sharedExtraModels = new Map();
for (const state of selected) {
    try {
    const definition = await json(`assets/minecraft/blockstates/${state.name.slice(10)}.json`);
    if (state.name === 'minecraft:chest') {
        const facing = state.properties.facing;
        const y = { north: 0, east: 90, south: 180, west: 270 }[facing];
        if (y === undefined) throw new Error(`Unsupported chest facing ${facing}`);
        const face = (texture, name) => ({ texture, uv: [0, 0, 16, 16], cullface: name });
        const faces = {
            down: face(chestTextures.top, 'down'), up: face(chestTextures.top, 'up'),
            north: face(chestTextures.front, 'north'), south: face(chestTextures.side, 'south'),
            east: face(chestTextures.side, 'east'), west: face(chestTextures.side, 'west')
        };
        blocks.push({ name: state.name, stateId: state.id, properties: state.properties,
            parts: [{ x: 0, y, uvlock: true, elements: [{ from: [1, 0, 1], to: [15, 14, 15], faces }] }],
            cutout: false, solid: true, blockEntityApproximation: 'static_chest' });
        continue;
    }
    const choices = definition.multipart
        ? definition.multipart.filter(part => matches(part.when, state.properties)).map(part => part.apply)
        : [Object.entries(definition.variants).find(([key]) => !key || matches(Object.fromEntries(key.split(',').map(pair => pair.split('='))), state.properties))?.[1]];
    const parts = [];
    for (let choice of choices) {
        if (!choice) throw new Error(`Missing native model variant ${state.name}`);
        if (Array.isArray(choice)) choice = choice[0];
        const resolved = await model(choice.model);
        if (!resolved.elements) throw new Error(`No native model elements ${state.name}`);
        const elements = [];
        for (const element of resolved.elements) {
            const faces = {};
            for (const [name, face] of Object.entries(element.faces)) faces[name] = { ...face, texture: await texture(face.texture, resolved.textures) };
            elements.push({ ...element, faces });
        }
        parts.push({ x: choice.x ?? 0, y: choice.y ?? 0, uvlock: choice.uvlock ?? false, elements });
    }
    const rule = blockRules.states[state.id];
    const hasCutoutTexture = parts.some(part => part.elements.some(element => Object.values(element.faces).some(face => textures[face.texture]?.cutout)));
    const descriptor = { name: state.name, stateId: state.id, properties: state.properties, parts,
        tintType: state.name === 'minecraft:leaf_litter' || state.name.endsWith('_leaves') ? 'foliage' : undefined,
        cutout: hasCutoutTexture || plants.has(state.name.slice(10)) || state.name === 'minecraft:leaf_litter',
        solid: extraNames.has(state.name) ? rule.solid : !plants.has(state.name.slice(10)) && state.name !== 'minecraft:leaf_litter' };
    if (extraNames.has(state.name)) {
        const key = JSON.stringify([state.name, parts, rule.solid, rule.solidRender, rule.canOcclude, rule.faces, rule.lightEmission]);
        const existing = sharedExtraModels.get(key);
        if (existing) { existing.stateIds.push(state.id); continue; }
        descriptor.stateIds = [state.id];
        sharedExtraModels.set(key, descriptor);
    }
    blocks.push(descriptor);
    } catch (error) {
        unsupported.push({ name: state.name, reason: error.message });
    }
}
for (const name of ['minecraft:block/water_still', 'minecraft:block/lava_still', 'minecraft:block/water_flow', 'minecraft:block/lava_flow']) await texture(name, {});
await writeFile(new URL('generated/block-item-render.json', root), JSON.stringify({ source, resources, textures, blocks, requiredNames: [...requiredNames].sort(),
    unsupported, limitations: ['Weighted models use their first variant', 'Dungeon chest uses a static native-texture approximation without lid animation or inventory contents', 'Model lighting uses the existing BreakMine light engine, not full native smooth-light parity'] }));
console.log(`${blocks.length} native feature states, ${Object.keys(textures).length} original textures`);
