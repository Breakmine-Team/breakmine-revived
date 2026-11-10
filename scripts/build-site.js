// Assemble the static site directory served by the Nixpacks deployment.
//
// The client is native ES modules with no bare npm imports, so it is served
// straight from source, exactly like the Docker image serves /app/public.
// There is deliberately no Vite build here: vite is a devDependency and a
// production install omits it, so a fresh deploy has no dist/ to serve (it is
// gitignored and nothing creates it). That is why `serve -s dist` answered
// every request with a 404.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public');

const DIRECTORIES = ['src', 'libraries', '.well-known'];
const FILES = [
    'index.html',
    'style.css',
    'loading.gif',
    'catalog.json',
    'openapi.json',
    'api-docs.html',
    '_headers',
    'CNAME'
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let entries = 0;

for (const dir of DIRECTORIES) {
    const from = path.join(root, dir);
    if (!fs.existsSync(from)) {
        console.warn(`[site] Skipping missing ${dir}/`);
        continue;
    }
    fs.cpSync(from, path.join(outDir, dir), { recursive: true });
    entries++;
}

for (const file of FILES) {
    const from = path.join(root, file);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(outDir, file));
    entries++;
}

if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    throw new Error('index.html is missing, nothing to serve');
}
if (!fs.existsSync(path.join(outDir, 'src', 'resources.js'))) {
    console.warn('[site] src/resources.js is missing - run scripts/build-assets.js first');
}

console.log(`[site] Assembled ${outDir} (${entries} entries)`);
