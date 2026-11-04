import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Bake the menu cubemap into one lightweight loading-screen still.
// This runs offline; startup needs no cubemap renderer or 3D DOM layers.
const root = new URL('../src/resources/gui/', import.meta.url);
const faces = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    return sharp(fileURLToPath(new URL(`title/background/alt/panorama_${index}.png`, root)))
        .removeAlpha().raw().toBuffer({ resolveWithObject: true });
}));
const width = 1280, height = 720;
const output = Buffer.alloc(width * height * 3);
const yaw = 18 * Math.PI / 180, pitch = 8 * Math.PI / 180;
const scale = Math.tan(70 * Math.PI / 360);
for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
        const vx = (2 * (column + .5) / width - 1) * scale * width / height;
        const vy = (1 - 2 * (row + .5) / height) * scale;
        const py = vy * Math.cos(pitch) + Math.sin(pitch);
        const pz = Math.cos(pitch) - vy * Math.sin(pitch);
        const x = vx * Math.cos(yaw) + pz * Math.sin(yaw);
        const y = py;
        const z = pz * Math.cos(yaw) - vx * Math.sin(yaw);
        const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
        let face, u, v;
        if (az >= ax && az >= ay) {
            face = z >= 0 ? 0 : 2;
            u = (z >= 0 ? x : -x) / az;
            v = -y / az;
        } else if (ax >= ay) {
            face = x >= 0 ? 1 : 3;
            u = (x >= 0 ? -z : z) / ax;
            v = -y / ax;
        } else {
            face = y >= 0 ? 4 : 5;
            u = x / ay;
            v = (y >= 0 ? z : -z) / ay;
        }
        const { data, info } = faces[face];
        const sx = Math.max(0, Math.min(info.width - 1, Math.floor((u + 1) * .5 * info.width)));
        const sy = Math.max(0, Math.min(info.height - 1, Math.floor((v + 1) * .5 * info.height)));
        const source = (sy * info.width + sx) * 3;
        const target = (row * width + column) * 3;
        data.copy(output, target, source, source + 3);
    }
}
await sharp(output, { raw: { width, height, channels: 3 } })
    .webp({ quality: 80 }).toFile(fileURLToPath(new URL('loading/panorama.webp', root)));
