import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const jarPath = process.argv[2] ?? '/home/_doxism/minecraft-client-26.3.jar';
const expectedHash = '4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d';
const jarBytes = await readFile(jarPath);
const jarHash = createHash('sha256').update(jarBytes).digest('hex');
if (jarHash !== expectedHash) throw new Error(`Unexpected Minecraft source JAR: ${jarHash}`);

const zip = await JSZip.loadAsync(jarBytes);
const outputDirectory = path.resolve('src/resources/entities/mobs');
await mkdir(outputDirectory, { recursive: true });
const textures = {
    zombie: 'assets/minecraft/textures/entity/zombie/zombie.png',
    husk: 'assets/minecraft/textures/entity/zombie/husk.png',
    drowned: 'assets/minecraft/textures/entity/zombie/drowned.png',
    drowned_outer_layer: 'assets/minecraft/textures/entity/zombie/drowned_outer_layer.png',
    skeleton: 'assets/minecraft/textures/entity/skeleton/skeleton.png',
    stray: 'assets/minecraft/textures/entity/skeleton/stray.png',
    stray_overlay: 'assets/minecraft/textures/entity/skeleton/stray_overlay.png',
    wither_skeleton: 'assets/minecraft/textures/entity/skeleton/wither_skeleton.png'
};
for (const [name, resourcePath] of Object.entries(textures)) {
    const resource = zip.file(resourcePath);
    if (!resource) throw new Error(`Missing pinned JAR texture ${resourcePath}`);
    const png = await resource.async('nodebuffer');
    await writeFile(path.join(outputDirectory, `${name}.png`), png);
}
console.log(`Imported ${Object.keys(textures).length} undead textures from the reference client (${jarHash})`);
