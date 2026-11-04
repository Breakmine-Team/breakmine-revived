import { spawnSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('cargo', ['build', '--manifest-path', path.join(root, 'Cargo.toml'), '--release', '--target', 'wasm32-unknown-unknown'], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await mkdir(path.join(root, 'generated'), { recursive: true });
await copyFile(path.join(root, 'target/wasm32-unknown-unknown/release/breakmine_vanilla_worldgen.wasm'), path.join(root, 'generated/worldgen.wasm'));
console.log('Built generated/worldgen.wasm');
