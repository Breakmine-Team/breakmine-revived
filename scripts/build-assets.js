import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    uiTextures,
    atlasBlockTextures,
    atlasItemTextures,
    musicTracks,
    soundPools,
    clickSound,
} from '../src/js/assetManifest.js';

const RESOURCES_DIR = path.resolve('src/resources');
const OUTPUT_FILE = path.resolve('src/resources.js');

// Music is chunked and fetched lazily by MusicManager (URL fallback), so it is
// excluded from the base64 bundle by default. Pass --include-music to embed it
// (used by the offline single-file build).
const includeMusic = process.argv.includes('--include-music');

const MIME_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg'
};

// Every asset the game actually uses, keyed the same way as base64Assets
// (relative to src/resources/). Only these files get embedded.
const wantedKeys = new Set([...uiTextures, clickSound]);
// Keys that must exist on disk (sound pool variants are optional — the game
// gracefully falls back when numbered/unnumbered variants are absent).
const criticalKeys = new Set([...uiTextures, clickSound]);

if (includeMusic) {
    for (const track of Object.values(musicTracks).flat()) {
        wantedKeys.add(track);
        criticalKeys.add(track);
    }
}

for (const pool of soundPools) {
    const rel = pool.replace('.', '/');
    for (let i = 1; i <= 6; i++) {
        wantedKeys.add(`sound/${rel}${i}.ogg`);
    }
    wantedKeys.add(`sound/${rel}.ogg`);
}

for (const name of atlasBlockTextures) {
    wantedKeys.add(`terrain/pack/minecraft/textures/blocks/${name}`);
    criticalKeys.add(`terrain/pack/minecraft/textures/blocks/${name}`);
}
for (const name of atlasItemTextures) {
    wantedKeys.add(`terrain/pack/minecraft/textures/items/${name}`);
    criticalKeys.add(`terrain/pack/minecraft/textures/items/${name}`);
}

function walkDir(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            walkDir(filePath, fileList);
        } else {
            fileList.push(filePath);
        }
    }
    return fileList;
}

const allFiles = walkDir(RESOURCES_DIR);
const availableKeys = new Set();
const assetMap = {};
const hashToKey = {};
const aliases = [];
let dedupedCount = 0;
let dedupedBytes = 0;
let skippedCount = 0;
let skippedBytes = 0;

for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (!MIME_TYPES[ext]) continue;

    // Relativize path to match the game's texture keys (e.g., "gui/font.png")
    const relativePath = path.relative(RESOURCES_DIR, filePath).replace(/\\/g, '/');

    // Only bundle assets the game actually uses (see src/js/assetManifest.js)
    if (!wantedKeys.has(relativePath)) {
        skippedCount++;
        skippedBytes += fs.statSync(filePath).size;
        continue;
    }
    availableKeys.add(relativePath);

    const fileBuffer = fs.readFileSync(filePath);

    // Deduplicate identical file contents: store the base64 once and
    // alias every duplicate key to the first occurrence. Identical files
    // are common (texture packs mirror the vanilla sound/music trees).
    const contentHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    const firstKey = hashToKey[contentHash];
    if (firstKey) {
        aliases.push([relativePath, firstKey]);
        dedupedCount++;
        dedupedBytes += fileBuffer.length;
        continue;
    }
    hashToKey[contentHash] = relativePath;

    const base64 = fileBuffer.toString('base64');
    assetMap[relativePath] = `data:${MIME_TYPES[ext]};base64,${base64}`;
}

// Warn about critical manifest entries that have no file on disk, so list
// drift is visible. (Optional sound pool variants are skipped silently.)
const missingKeys = [...criticalKeys].filter(key => !availableKeys.has(key));
for (const key of missingKeys) {
    console.warn(`[build-assets] Manifest lists asset not found on disk, skipping: ${key}`);
}

const aliasLines = aliases.map(([alias, target]) =>
    `base64Assets[${JSON.stringify(alias)}] = base64Assets[${JSON.stringify(target)}];`
);

const fileContent =
    `// Auto-generated Base64 assets\n` +
    `// Only assets listed in src/js/assetManifest.js are bundled.\n` +
    `// Deduplicated: ${dedupedCount} assets share the same content and reference an existing copy.\n` +
    `export const base64Assets = ${JSON.stringify(assetMap, null, 2)};\n` +
    `\n` +
    aliasLines.join('\n') +
    `\n`;

fs.writeFileSync(OUTPUT_FILE, fileContent);

const totalKeys = Object.keys(assetMap).length + aliases.length;
const outSize = fs.statSync(OUTPUT_FILE).size;
const inSize = allFiles.reduce((sum, f) => {
    return sum + (wantedKeys.has(path.relative(RESOURCES_DIR, f).replace(/\\/g, '/')) ? fs.statSync(f).size : 0);
}, 0);
console.log(`Converted ${totalKeys} of ${wantedKeys.size} wanted assets to Base64 in src/resources.js`);
if (!includeMusic) {
    console.log('Music tracks excluded from bundle (lazy-loaded by URL). Use --include-music to embed them.');
}
console.log(`Skipped ${skippedCount} unused assets (saved ${(skippedBytes / 1048576).toFixed(1)} MB raw)`);
console.log(`Embedded ${(inSize / 1048576).toFixed(1)} MB raw -> ${(outSize / 1048576).toFixed(1)} MB base64 in src/resources.js`);
console.log(`Deduplicated ${dedupedCount} identical files (saved ${(dedupedBytes / 1048576).toFixed(1)} MB raw / ~${(dedupedBytes * 1.333 / 1048576).toFixed(1)} MB base64)`);
