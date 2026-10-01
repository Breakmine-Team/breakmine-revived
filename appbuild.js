#!/usr/bin/env node
/**
 * Builds the desktop distributables.
 *
 * scripts/install.sh downloads what this produces, so the artifacts are named
 * deterministically (electron-builder.yml pins linux.artifactName) and every
 * artifact gets a .sha256 sibling that the installer verifies after the
 * download.
 *
 * Usage:
 *   node appbuild.js                Linux AppImage into release/
 *   node appbuild.js --win          Windows NSIS installer into release/
 *   node appbuild.js --linux --win  both
 *   node appbuild.js --out ~/tmp    copy the artifacts somewhere else as well
 *   node appbuild.js --skip-assets  reuse the existing src/resources.js
 *   node appbuild.js --publish always  hand the artifacts to electron-builder's
 *                                      publisher (CI uploads the AppImage to a
 *                                      release; see scripts/install.sh)
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const RELEASE_DIR = path.join(ROOT, 'release');
const RENDERER_ENTRY = path.join(ROOT, 'dist', 'index.html');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith('--')));

function optionValue(name) {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1];
}

if (flags.has('--help') || flags.has('-h')) {
    console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n')
        .filter((line) => line.startsWith(' * '))
        .map((line) => line.slice(3))
        .join('\n'));
    process.exit(0);
}

// Linux is the default because it is the only target scripts/install.sh knows
// how to fetch; Windows has to be asked for explicitly.
const targets = [];
if (!flags.has('--win') || flags.has('--linux')) targets.push('linux');
if (flags.has('--win')) targets.push('win');

const publish = optionValue('--publish') ?? 'never';
const outDir = optionValue('--out');

// electron-builder leaves whatever was in release/ last time alone, so files
// from an earlier build would otherwise be reported (and uploaded) as new.
const buildStartedAt = Date.now();

function fail(message) {
    console.error(`\n[appbuild] ${message}`);
    process.exit(1);
}

function localBin(name) {
    const suffix = process.platform === 'win32' ? '.cmd' : '';
    const binPath = path.join(ROOT, 'node_modules', '.bin', name + suffix);
    if (!fs.existsSync(binPath)) {
        fail(`node_modules/.bin/${name} is missing. Run "npm install" first.`);
    }
    return binPath;
}

function run(label, command, args) {
    console.log(`\n[appbuild] ${label}`);
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (result.error) fail(`${label}: ${result.error.message}`);
    if (result.status !== 0) fail(`${label} failed with exit code ${result.status}`);
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function formatSize(bytes) {
    return `${(bytes / 1048576).toFixed(1)} MiB`;
}

if (!flags.has('--skip-assets')) {
    run('embedding textures and sounds', process.execPath, ['scripts/build-assets.js']);
}

run('building the renderer bundle', localBin('vite'), ['build']);

if (!fs.existsSync(RENDERER_ENTRY)) {
    fail('the vite build finished but dist/index.html is missing.');
}

// --linux AppImage / --win nsis mirror the npm run dist:* scripts.
const targetArgs = [];
for (const target of targets) {
    targetArgs.push(`--${target}`, target === 'linux' ? 'AppImage' : 'nsis');
}
run(`packaging ${targets.join(' and ')}`, localBin('electron-builder'), [...targetArgs, '--publish', publish]);

if (!fs.existsSync(RELEASE_DIR)) fail(`electron-builder wrote nothing to ${RELEASE_DIR}.`);

const artifacts = fs.readdirSync(RELEASE_DIR)
    .map((name) => path.join(RELEASE_DIR, name))
    .filter((file) => fs.statSync(file).isFile())
    // Fresh files only: an unchanged rebuild overwrites the old artifact
    // instead of adding a new one.
    .filter((file) => fs.statSync(file).mtimeMs >= buildStartedAt)
    .filter((file) => /\.(AppImage|exe|deb|rpm|zip|dmg)$/i.test(file));

if (artifacts.length === 0) {
    fail('electron-builder reported success but produced no artifact in release/.');
}

console.log('\n[appbuild] artifacts');
const checksums = [];
for (const artifact of artifacts) {
    const digest = sha256(artifact);
    const checksumFile = `${artifact}.sha256`;
    // sha256sum format, so `sha256sum -c` works on the release asset too.
    fs.writeFileSync(checksumFile, `${digest}  ${path.basename(artifact)}\n`);
    checksums.push(checksumFile);
    console.log(`  ${path.relative(ROOT, artifact)}  ${formatSize(fs.statSync(artifact).size)}`);
    console.log(`  sha256 ${digest}`);
}

if (outDir) {
    const destination = path.resolve(outDir);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of [...artifacts, ...checksums]) {
        fs.copyFileSync(file, path.join(destination, path.basename(file)));
    }
    console.log(`\n[appbuild] copied to ${destination}`);
}

console.log('\n[appbuild] upload both files to the release scripts/install.sh downloads:');
for (const artifact of artifacts) {
    const tag = process.env.BREAKMINE_RELEASE_TAG ?? '<tag>';
    console.log(`  gh release upload ${tag} ${path.relative(ROOT, artifact)} ${artifact}.sha256`);
}