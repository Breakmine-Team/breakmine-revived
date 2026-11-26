/**
 * Beta channel version info, evaluated while Vite loads its config.
 *
 * A build made from the "beta" branch is a beta build, and its prerelease
 * number is the number of commits beta has that main does not. scripts/publish.js
 * merges beta into main, which empties that set, so the next beta commit starts
 * the series over at p1 - no counter file to keep in sync.
 *
 * The values are handed to the bundle through `define` (see the vite configs)
 * and read back in src/js/net/minecraft/client/BetaVersion.js. version.js itself
 * is never rewritten: it stays the release version the updater compares against.
 */
import { execFileSync } from "node:child_process";

const BETA_BRANCH = "beta";
const STABLE_REFS = ["origin/main", "main"];

function git(args, cwd) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function commitsSinceStable(cwd) {
    for (const ref of STABLE_REFS) {
        try {
            const count = Number(git(["rev-list", "--count", `${ref}..HEAD`], cwd));
            if (Number.isFinite(count)) return count;
        } catch {
            // Ref not present in this checkout; try the next one.
        }
    }
    return 0;
}

export function betaVersionInfo(cwd = process.cwd()) {
    let branch = "";
    try {
        branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    } catch {
        // Not a git checkout (tarball, packaged app source): no beta channel.
    }

    const isBeta = branch === BETA_BRANCH;
    const commits = isBeta ? Math.max(1, commitsSinceStable(cwd)) : 0;

    return { branch, isBeta, prerelease: commits };
}

export function betaVersionDefines(cwd = process.cwd()) {
    const { isBeta, prerelease } = betaVersionInfo(cwd);
    return {
        __BETA_BUILD__: JSON.stringify(isBeta),
        __BETA_PRERELEASE__: String(prerelease),
    };
}
