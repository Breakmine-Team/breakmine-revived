#!/usr/bin/env node
/**
 * Promotes the beta branch to stable.
 *
 * Beta builds show a prerelease number ("1.7.1b-fe11d7c-p3") equal to the commits beta
 * has that main does not, so merging beta into main here is what resets the
 * series: the next beta commit is p1 again.
 *
 *  1. refuses to run from anything but beta (the branch is never guessed)
 *  2. switches to main and merges beta into it
 *  3. pushes main
 *  4. runs the single-file build, which publishes index.html and version.txt;
 *     the beta channel files are only written from a beta checkout, so this
 *     publishes stable without touching index-beta.html
 *  5. switches back to beta, including when a step fails
 *
 * Run it from the repository root: node scripts/publish.js
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BETA_BRANCH = "beta";
const STABLE_BRANCH = "main";
const REMOTE = "origin";

function fail(message) {
    console.error(`\n[publish] ${message}`);
    process.exit(1);
}

function git(args, options = {}) {
    const result = spawnSync("git", args, {
        cwd: ROOT,
        encoding: "utf8",
        ...options,
    });
    if (result.error) fail(`could not run git: ${result.error.message}`);
    return { status: result.status ?? 1, output: (result.stdout || "").trim() };
}

function gitOrFail(args, options = {}) {
    const result = git(args, options);
    if (result.status !== 0) fail(`git ${args.join(" ")} failed`);
    return result.output;
}

function checkout(branch) {
    return git(["checkout", branch], { stdio: "inherit" });
}

const branch = gitOrFail(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== BETA_BRANCH) {
    fail(`this promotes ${BETA_BRANCH} to ${STABLE_BRANCH}; the checkout is on "${branch}"`);
}

if (git(["rev-parse", "--verify", "--quiet", STABLE_BRANCH]).status !== 0) {
    fail(`there is no local ${STABLE_BRANCH} branch to publish from`);
}

const dirty = gitOrFail(["status", "--porcelain", "--untracked-files=no"]);
if (dirty) {
    console.log("[publish] uncommitted changes travel with the branch switch; only committed beta work is published");
}

console.log(`[publish] switching to ${STABLE_BRANCH}`);
if (checkout(STABLE_BRANCH).status !== 0) {
    fail(`could not switch to ${STABLE_BRANCH}`);
}

// Pick up anything merged on the remote since the last publish. Diverged local
// main is left for the push to complain about rather than silently reset.
if (git(["fetch", REMOTE, STABLE_BRANCH]).status === 0) {
    git(["merge", "--ff-only", `${REMOTE}/${STABLE_BRANCH}`]);
}

console.log(`[publish] merging ${BETA_BRANCH} into ${STABLE_BRANCH}`);
if (git(["merge", "--no-edit", BETA_BRANCH], { stdio: "inherit" }).status !== 0) {
    git(["merge", "--abort"]);
    checkout(BETA_BRANCH);
    fail(`merging ${BETA_BRANCH} failed and was aborted; back on ${BETA_BRANCH}`);
}

console.log(`[publish] pushing ${STABLE_BRANCH}`);
if (git(["push", REMOTE, STABLE_BRANCH], { stdio: "inherit" }).status !== 0) {
    checkout(BETA_BRANCH);
    fail(`push failed; back on ${BETA_BRANCH}, nothing was published`);
}

console.log("[publish] building and publishing the stable single-file build");
const npm = process.platform === "win32"
    ? spawnSync("npm.cmd run build:single", { cwd: ROOT, stdio: "inherit", shell: true })
    : spawnSync("npm", ["run", "build:single"], { cwd: ROOT, stdio: "inherit" });
const buildStatus = npm.error ? 1 : npm.status ?? 1;
if (npm.error) console.error(`[publish] could not run npm: ${npm.error.message}`);

console.log(`[publish] switching back to ${BETA_BRANCH}`);
if (checkout(BETA_BRANCH).status !== 0) {
    fail(`could not switch back to ${BETA_BRANCH}; run "git checkout ${BETA_BRANCH}" yourself`);
}

if (buildStatus !== 0) {
    fail(`the single-file build failed with exit code ${buildStatus}; ${STABLE_BRANCH} was already pushed`);
}

const ahead = gitOrFail(["rev-list", "--count", `${STABLE_BRANCH}..${BETA_BRANCH}`]);
console.log(`[publish] done; ${BETA_BRANCH} is ${ahead} commit(s) ahead of ${STABLE_BRANCH}, so the next beta build shows p1`);
