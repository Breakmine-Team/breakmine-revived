#!/usr/bin/env node
/**
 * Publishes the single-file build to the data-store CDN repo.
 *
 * The build output keeps its name (index.html); the data-store server already
 * serves index.html for "/". version.txt records the release version (without
 * the build commit hash). The commit is always "new version".
 *
 * The checkout lives in .data-store/ (gitignored) so this never touches the
 * main repository. Override the remote with DATA_STORE_REPO if needed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUILD_FILE = path.join(ROOT, 'dist-single', 'index.html');
const GAME_VERSION_FILE = path.join(ROOT, 'src', 'resources', 'version.js');
const CHECKOUT_DIR = path.join(ROOT, '.data-store');
const REPO_URL = process.env.DATA_STORE_REPO || 'git@github.com:Breakmine-Team/data-store.git';
const BRANCH = process.env.DATA_STORE_BRANCH || 'main';
const COMMIT_MESSAGE = 'new version';

function fail(message) {
    console.error(`\n[data-store] ${message}`);
    process.exit(1);
}

function git(args, options = {}) {
    const result = spawnSync('git', args, {
        cwd: CHECKOUT_DIR,
        stdio: options.stdio || 'inherit',
        encoding: options.encoding,
    });
    if (result.error) {
        fail(`could not run git: ${result.error.message}`);
    }
    if (result.status !== 0) {
        fail(`git ${args.join(' ')} failed with exit code ${result.status}`);
    }
    return result;
}

function readGameVersion() {
    if (!fs.existsSync(GAME_VERSION_FILE)) {
        fail('src/resources/version.js is missing.');
    }
    const source = fs.readFileSync(GAME_VERSION_FILE, 'utf8');
    const version = source.match(/static\s+VERSION\s*=\s*["']([^"']+)["']/)?.[1];
    if (!version) {
        fail('could not read static VERSION out of src/resources/version.js');
    }
    // VERSION carries the build commit ("5.3.6a-bde33bd"); version.txt is the
    // release version only.
    return version.trim().replace(/-[0-9a-f]{7,40}$/i, '');
}

if (!fs.existsSync(BUILD_FILE)) {
    fail('dist-single/index.html is missing. Run the single-file build first.');
}

if (!fs.existsSync(path.join(CHECKOUT_DIR, '.git'))) {
    console.log(`[data-store] cloning ${REPO_URL}`);
    fs.rmSync(CHECKOUT_DIR, { recursive: true, force: true });
    const clone = spawnSync('git', ['clone', '--branch', BRANCH, REPO_URL, CHECKOUT_DIR], {
        stdio: 'inherit',
    });
    if (clone.error) {
        fail(`could not run git: ${clone.error.message}`);
    }
    if (clone.status !== 0) {
        fail(`git clone failed with exit code ${clone.status}`);
    }
} else {
    console.log('[data-store] updating checkout');
    git(['remote', 'set-url', 'origin', REPO_URL], { stdio: 'ignore' });
    git(['fetch', 'origin', BRANCH]);
    git(['reset', '--hard', `origin/${BRANCH}`]);
}

fs.copyFileSync(BUILD_FILE, path.join(CHECKOUT_DIR, 'index.html'));

const gameVersion = readGameVersion();
fs.writeFileSync(path.join(CHECKOUT_DIR, 'version.txt'), `${gameVersion}\n`);

const status = git(['status', '--porcelain', '--', 'index.html', 'version.txt'], {
    stdio: 'pipe',
    encoding: 'utf8',
}).stdout.trim();

if (!status) {
    console.log('[data-store] index.html and version.txt are unchanged; nothing to commit');
    process.exit(0);
}

console.log(`[data-store] committing new version ${gameVersion}`);
git(['add', 'index.html', 'version.txt']);
git(['commit', '-m', COMMIT_MESSAGE]);

console.log('[data-store] pushing');
git(['push', 'origin', `HEAD:${BRANCH}`]);
console.log(`[data-store] published dist-single/index.html (${gameVersion})`);
