#!/usr/bin/env node
/**
 * Usage:
 *   node appbuild.js                Linux AppImage into release/
 *   node appbuild.js --win          Windows NSIS installer into release/
 *   node appbuild.js --linux --win  both
 *   node appbuild.js --out ~/tmp    copy the artifacts somewhere else as well
 *   node appbuild.js --skip-assets  reuse the existing src/resources.js
 *   node appbuild.js --publish always  hand the artifacts to electron-builder's
 *                                      publisher (CI uploads the AppImage to a
 *                                      release; see scripts/install.sh)
 *   node appbuild.js --no-release    build, but do not touch GitHub
 *   node appbuild.js --no-git        do not commit or push before building
 *   node appbuild.js --message "..." commit message (default: New)
 *   node appbuild.js --prerelease    publish the release as a pre-release
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const RELEASE_DIR = path.join(ROOT, 'release');
const RENDERER_ENTRY = path.join(ROOT, 'dist', 'index.html');
const VERSION_FILE = path.join(ROOT, 'src', 'resources', 'version.js');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const PACKAGE_LOCK = path.join(ROOT, 'package-lock.json');

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

const targets = [];
if (!flags.has('--win') || flags.has('--linux')) targets.push('linux');
if (flags.has('--win')) targets.push('win');

const publish = optionValue('--publish') ?? 'never';
const outDir = optionValue('--out');
const COMMIT_MESSAGE = optionValue('--message') ?? 'New';

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

if (!flags.has('--no-git')) {
    gitCommitAndPush();
}
const game = readGameVersion();
console.log(`\n[appbuild] building Breakmine ${game.tag}`);

if (!flags.has('--skip-assets')) {
    run('embedding textures and sounds', process.execPath, ['scripts/build-assets.js']);
}

run('building the renderer bundle', localBin('vite'), ['build']);

if (!fs.existsSync(RENDERER_ENTRY)) {
    fail('the vite build finished but dist/index.html is missing.');
}

function gitCommitAndPush() {
    const git = (args) => {
        const result = spawnSync('git', args, {
            cwd: ROOT,
            stdio: 'inherit',
        });
        if (result.error) {
            fail(`could not run git: ${result.error.message} (or pass --no-git)`);
        }
        return result.status;
    };

    // stdout has to be piped: `stdio: 'ignore'` yields null, not "".
    const status = spawnSync('git', ['status', '--porcelain'], {
        cwd: ROOT, encoding: 'utf8',
    }).stdout.trim();

    if (status) {
        console.log('\n[appbuild] committing working tree');
        run('git add .', 'git', ['add', '.']);
        if (git(['commit', '-m', COMMIT_MESSAGE]) !== 0) {
            fail('git commit failed; not building or publishing.');
        }
    } else {
        console.log('\n[appbuild] nothing to commit');
    }

    console.log('[appbuild] pushing');
    // "Everything up-to-date" exits 0, so a no-op push is fine.
    if (git(['push']) !== 0) {
        fail('git push failed; not publishing a release from an unpushed tree.');
    }
}

function withGameVersion(version, fn) {
    const manifests = [PACKAGE_JSON, PACKAGE_LOCK]
        .filter((file) => fs.existsSync(file))
        .map((file) => [file, fs.readFileSync(file)]);

    try {
        for (const [file, original] of manifests) {
            const json = JSON.parse(original.toString());
            if (json.version) json.version = version;
            if (json.packages && json.packages['']) json.packages[''].version = version;
            fs.writeFileSync(file, `${JSON.stringify(json, null, 4)}\n`);
        }
        return fn();
    } finally {
        for (const [file, original] of manifests) {
            fs.writeFileSync(file, original);
        }
    }
}

// --linux AppImage / --win nsis mirror the npm run dist:* scripts.
const targetArgs = [];
for (const target of targets) {
    targetArgs.push(`--${target}`, target === 'linux' ? 'AppImage' : 'nsis');
}
withGameVersion(game.tag, () => {
    run(`packaging ${targets.join(' and ')}`, localBin('electron-builder'), [...targetArgs, '--publish', publish]);
});

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

function readGameVersion() {
    if (!fs.existsSync(VERSION_FILE)) {
        fail(`cannot find ${path.relative(ROOT, VERSION_FILE)}`);
    }
    const source = fs.readFileSync(VERSION_FILE, 'utf8');
    const version = source.match(/static\s+VERSION\s*=\s*["']([^"']+)["']/)?.[1];
    const timestamp = source.match(/static\s+TIMESTAMP\s*=\s*["']([^"']+)["']/)?.[1];
    if (!version) {
        fail('could not read static VERSION out of src/resources/version.js');
    }
    return {
        full: version.trim(),
        tag: version.trim().replace(/-[0-9a-f]{7,40}$/i, ''),
        timestamp: timestamp ? timestamp.trim() : ''
    };
}

function publishRelease(tag, files) {
    const ghArgs = (args) => {
        const result = spawnSync('gh', args, {
            cwd: ROOT,
            stdio: 'inherit',
            shell: process.platform === 'win32',
        });
        if (result.error) {
            fail(`could not run gh: ${result.error.message}\n`
                + '         Install the GitHub CLI from https://cli.github.com '
                + '(or pass --no-release to skip this step).');
        }
        return result.status;
    };

    if (spawnSync('gh', ['auth', 'status'], { cwd: ROOT, stdio: 'ignore' }).status !== 0) {
        fail('gh is not authenticated. Run "gh auth login", or pass --no-release.');
    }

    const dirty = spawnSync('git', ['status', '--porcelain'], {
        cwd: ROOT, encoding: 'utf8',
    }).stdout.trim();
    if (dirty) {
        console.log('\n[appbuild] warning: the working tree has uncommitted changes, so this');
        console.log('[appbuild]          release will not match what is checked out.');
    }

    const notes = [
        `Breakmine ${tag}.`,
        game.timestamp ? `Built from a tree stamped ${game.timestamp}.` : '',
        '',
        ...files.map((file) => `- \`${path.basename(file)}\``),
        '',
        'Verify a download with: `sha256sum -c *.sha256`',
    ].filter(Boolean).join('\n');

    const exists = spawnSync('gh', ['release', 'view', tag, '--json', 'tagName'], {
        cwd: ROOT, stdio: 'ignore',
    }).status === 0;

    console.log(`\n[appbuild] publishing release ${tag}`);
    if (exists) {
        console.log(`[appbuild] release ${tag} already exists; uploading the new artifacts to it`);
        if (ghArgs(['release', 'upload', tag, '--clobber', ...files]) !== 0) {
            fail(`could not upload to the existing ${tag} release.`);
        }
    } else {
        const create = ['release', 'create', tag, '--title', tag, '--notes', notes];
        if (flags.has('--prerelease')) create.push('--prerelease');
        if (ghArgs([...create, ...files]) !== 0) {
            fail(`could not create the ${tag} release.`);
        }
    }

    console.log(`[appbuild] release ${tag} is live`);
}

if (outDir) {
    const destination = path.resolve(outDir);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of [...artifacts, ...checksums]) {
        fs.copyFileSync(file, path.join(destination, path.basename(file)));
    }
    console.log(`\n[appbuild] copied to ${destination}`);
}

if (flags.has('--no-release')) {
    console.log('\n[appbuild] --no-release given; skipping GitHub.');
    for (const file of [...artifacts, ...checksums]) {
        console.log(`  ${path.relative(ROOT, file)}`);
    }
} else {
    publishRelease(game.tag, [...artifacts, ...checksums]);
}