#!/usr/bin/env node
/**
 * Publishes the single-file build to the data-store CDN repo.
 *
 * The build output keeps its name (index.html); the server serves index.html
 * for "/". version.txt records the release version (without the build commit
 * hash). The commit is always "new version".
 *
 * When this repository is on the "beta" branch the same build is also shipped
 * as index-beta.html plus version-beta.txt, so the beta channel is addressable
 * at /index-beta.html without replacing the stable index.html.
 *
 * Each publish also ships:
 *  - server.js, the canonical data-store server from scripts/data-store-server.js,
 *    which serves older builds at /build/<commit>/index.html and
 *    /<version>/index.html by reading them from the repo's git history.
 *  - builds.json, a version -> commit index, rebuilt from the checkout's history
 *    so every published version is addressable.
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
const SERVER_SOURCE = path.join(ROOT, 'scripts', 'data-store-server.js');
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

function gitOutput(args) {
    return git(args, { stdio: 'pipe', encoding: 'utf8' }).stdout.trim();
}

// The branch of this repository (breakmine-revived), not the data-store branch:
// publishing from "beta" also ships the beta channel files.
function readRepoBranch() {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
    });
    if (result.error || result.status !== 0) return null;
    const branch = (result.stdout || '').trim();
    return branch && branch !== 'HEAD' ? branch : null;
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
    // VERSION carries the build commit and, on beta, the prerelease and channel
    // marker ("1.7.1b-fe11d7c-p1", "1.7.1b-fe11d7c (beta)"); version.txt is the
    // release version only.
    return version.trim()
        .replace(/-p\d+$/i, '')
        .replace(/\s*\(beta\)$/i, '')
        .replace(/-[0-9a-f]{7,40}$/i, '');
}

function readVersionAtCommit(sha) {
    const result = spawnSync('git', ['show', `${sha}:version.txt`], {
        cwd: CHECKOUT_DIR,
        encoding: 'utf8',
    });
    if (result.status !== 0) return null;

    const version = (result.stdout || '').trim().split(/\s+/)[0];
    return version || null;
}

function commitDate(sha) {
    return gitOutput(['log', '-1', '--format=%cI', sha]);
}

// Every published build is a commit that changed index.html. Older commits may
// predate version.txt; they are simply not addressable by version (the exact
// /build/<commit>/ route still works for them).
function writeBuildManifest(currentSha, currentVersion) {
    const shas = gitOutput(['log', '--format=%H', '--', 'index.html'])
        .split('\n')
        .filter(Boolean);

    const versions = {};
    for (const sha of shas) {
        const version = readVersionAtCommit(sha);
        if (!version || versions[version]) continue;
        versions[version] = { sha, published: commitDate(sha) };
    }

    versions[currentVersion] = { sha: currentSha, published: commitDate(currentSha) };

    fs.writeFileSync(
        path.join(CHECKOUT_DIR, 'builds.json'),
        JSON.stringify({ versions }, null, 2) + '\n'
    );

    return Object.keys(versions).length;
}

if (!fs.existsSync(BUILD_FILE)) {
    fail('dist-single/index.html is missing. Run the single-file build first.');
}

// The server is only re-shipped when its source is present; otherwise the
// checkout's committed server.js is left as-is.
const shipServer = fs.existsSync(SERVER_SOURCE);
if (!shipServer) {
    console.log('[data-store] no scripts/data-store-server.js; keeping the committed server.js');
}

const repoBranch = readRepoBranch();
const isBeta = repoBranch === 'beta';

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
if (shipServer) {
    fs.copyFileSync(SERVER_SOURCE, path.join(CHECKOUT_DIR, 'server.js'));
}

const gameVersion = readGameVersion();
fs.writeFileSync(path.join(CHECKOUT_DIR, 'version.txt'), `${gameVersion}\n`);

const buildFiles = ['index.html', 'version.txt'];
if (isBeta) {
    fs.copyFileSync(BUILD_FILE, path.join(CHECKOUT_DIR, 'index-beta.html'));
    fs.writeFileSync(path.join(CHECKOUT_DIR, 'version-beta.txt'), `${gameVersion}\n`);
    buildFiles.push('index-beta.html', 'version-beta.txt');
}

const tracked = [...buildFiles, ...(shipServer ? ['server.js'] : [])];
const status = gitOutput(['status', '--porcelain', '--', ...tracked]);
const buildChanged = Boolean(gitOutput(['status', '--porcelain', '--', ...buildFiles]));

if (status) {
    git(['add', ...tracked]);
    if (buildChanged) {
        console.log(`[data-store] committing new version ${gameVersion}`);
    } else {
        console.log('[data-store] committing server update');
    }
    git(['commit', '-m', buildChanged ? COMMIT_MESSAGE : 'update server']);
}

const headSha = gitOutput(['rev-parse', 'HEAD']);
const indexedVersions = writeBuildManifest(headSha, gameVersion);

if (gitOutput(['status', '--porcelain', '--', 'builds.json'])) {
    console.log('[data-store] committing builds.json');
    git(['add', 'builds.json']);
    git(['commit', '-m', 'record builds']);
}

const ahead = Number(gitOutput(['rev-list', '--count', `origin/${BRANCH}..HEAD`]) || '0');
if (ahead === 0) {
    console.log('[data-store] already up to date; nothing to push');
    process.exit(0);
}

console.log('[data-store] pushing');
git(['push', 'origin', `HEAD:${BRANCH}`]);
console.log(`[data-store] published dist-single/index.html (${gameVersion}, ${indexedVersions} version(s) indexed)`);
console.log(`[data-store] version page: https://datastore.breakmine.com/${gameVersion}/index.html`);
if (isBeta) {
    console.log('[data-store] beta branch: also shipped index-beta.html and version-beta.txt');
    console.log('[data-store] beta page: https://datastore.breakmine.com/index-beta.html');
}
