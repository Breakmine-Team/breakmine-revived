import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const jarPath = process.argv[2] ?? '/home/_doxism/minecraft-client-26.3.jar';
const bytes = await readFile(jarPath);
const jar = await JSZip.loadAsync(bytes);
const render = JSON.parse(await readFile(new URL('../packages/vanilla-worldgen/generated/terrain-render.json', import.meta.url)));
// EnvironmentAttributes defaults verified from the same JAR bytecode.
const defaults = { color: (-16448205 & 0xffffff), start: -8, end: 96 };
const biomes = {};
const value = (attribute, fallback) => {
    if (attribute === undefined) return fallback;
    if (typeof attribute === 'number') return attribute;
    if (attribute.modifier === 'multiply') return fallback * attribute.argument;
    throw new Error(`Unsupported water fog attribute: ${JSON.stringify(attribute)}`);
};
for (const [id, biome] of Object.entries(render.biomeTints)) {
    const entry = jar.file(`data/minecraft/worldgen/biome/${biome.name.replace('minecraft:', '')}.json`);
    if (!entry) throw new Error(`Missing JAR biome ${biome.name}`);
    const attrs = JSON.parse(await entry.async('string')).attributes ?? {};
    const color = attrs['minecraft:visual/water_fog_color'];
    biomes[id] = {
        name: biome.name,
        color: color === undefined ? defaults.color : Number.parseInt(color.replace('#', ''), 16),
        start: value(attrs['minecraft:visual/water_fog_start_distance'], defaults.start),
        end: value(attrs['minecraft:visual/water_fog_end_distance'], defaults.end)
    };
}
await writeFile(new URL('../packages/vanilla-gameplay/generated/water-view.json', import.meta.url),
    JSON.stringify({ sourceSha256: createHash('sha256').update(bytes).digest('hex'), defaults, biomes }, null, 2) + '\n');
async function blockTag(name) {
    const tag = JSON.parse(await jar.file(`data/minecraft/tags/block/${name}.json`).async('string'));
    const blocks = [];
    for (const value of tag.values) {
        const id = typeof value === 'string' ? value : value.id;
        if (id.startsWith('#minecraft:')) blocks.push(...await blockTag(id.slice(11)));
        else blocks.push(id);
    }
    return blocks;
}
await writeFile(new URL('../packages/vanilla-gameplay/generated/fluid-flow.json', import.meta.url),
    JSON.stringify({ sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        blockingBlocks: [...new Set(await blockTag('blocks_fluid_flow'))].sort() }, null, 2) + '\n');
await writeFile(new URL('../src/resources/misc/underwater.png', import.meta.url),
    await jar.file('assets/minecraft/textures/misc/underwater.png').async('nodebuffer'));
