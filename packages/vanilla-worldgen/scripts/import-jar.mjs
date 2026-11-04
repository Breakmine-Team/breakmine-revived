import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';

const root = fileURLToPath(new URL('../', import.meta.url));
const jarPath = process.argv[2] || process.env.MINECRAFT_JAR;
if (!jarPath) throw new Error('Usage: node scripts/import-jar.mjs <reference-client.jar>');
const lock = JSON.parse(await readFile(path.join(root, 'source-lock.json'), 'utf8'));
const bytes = await readFile(jarPath);
const sha256 = value => createHash('sha256').update(value).digest('hex');
if (sha256(bytes) !== lock.sha256) throw new Error('JAR hash differs from source-lock.json; refusing to mix versions.');
const zip = await JSZip.loadAsync(bytes);
const version = JSON.parse(await zip.file('version.json').async('string'));
if (version.id !== lock.version || version.world_version !== lock.worldVersion) throw new Error('JAR version mismatch');

const resources = {};
const entries = {};
const registries = {};
const typeUsage = {};
const addTypes = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.type === 'string') typeUsage[value.type] = (typeUsage[value.type] || 0) + 1;
    for (const child of Object.values(value)) addTypes(child);
};

// Preserve the entire data pack, including templates, tags, loot and processor lists.
for (const name of Object.keys(zip.files).sort()) {
    const file = zip.files[name];
    if (file.dir || !name.startsWith('data/minecraft/')) continue;
    const content = await file.async('nodebuffer');
    const json = name.endsWith('.json');
    resources[name] = json ? JSON.parse(content.toString('utf8')) : content.toString('base64');
    entries[name] = { sha256: sha256(content), bytes: content.length, encoding: json ? 'json' : 'base64' };
    const match = /^data\/minecraft\/worldgen\/([^/]+)\/(.+)\.json$/.exec(name);
    if (match) (registries[match[1]] ||= []).push(`minecraft:${match[2]}`);
    if (json && name.includes('/worldgen/')) addTypes(resources[name]);
}
const dimensions = {};
for (const name of Object.keys(resources)) {
    if (/^data\/minecraft\/dimension_type\/[^/]+\.json$/.test(name)) {
        const value = resources[name];
        dimensions[name.split('/').at(-1).replace('.json', '')] = { minY: value.min_y, height: value.height, logicalHeight: value.logical_height };
    }
}
const manifest = { source: lock, entries, registries, dimensions, typeUsage };
await mkdir(path.join(root, 'generated'), { recursive: true });
await writeFile(path.join(root, 'generated/vanilla-data.json'), JSON.stringify(resources));
await writeFile(path.join(root, 'generated/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ version: version.id, resources: Object.keys(entries).length, registries: Object.fromEntries(Object.entries(registries).map(([k,v]) => [k,v.length])), dimensions }, null, 2));
