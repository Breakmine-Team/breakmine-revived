/**
 * Beta channel version info, evaluated while Vite loads its config.
 *
 * A build made from the "beta" branch is a beta build, and its prerelease
 * number is the number of commits beta has that main does not. scripts/publish.js
 * merges beta into main, which empties that set, so the next beta commit starts
 * the series over at p1 - no counter file to keep in sync.
 *
 * The values are handed to the bundle through `define` (see the vite configs)
 * and read back in src/js/net/minecraft/client/BetaVersion.js, and
 * betaVersionPlugin makes Version.VERSION itself ("1.7.1b-fe11d7c-p1") in the
 * module the bundler loads. The file on disk is never rewritten: it stays the
 * release version the updater compares against and appbuild.js tags releases from.
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

/**
 * "1.7.1b-fe11d7c" -> "1.7.1b-fe11d7c-p1". The build commit is kept, unlike a
 * display-only suffix, and an existing -pN is left alone so applying this twice
 * is harmless. A "(beta)" channel marker some version.js revisions carry is
 * dropped: the prerelease is the beta marker in the version string.
 */
export function betaDisplayVersion(version, prerelease = 1) {
    const base = String(version || "").trim().replace(/\s*\(beta\)$/i, "");
    if (/-p\d+$/i.test(base)) return base;
    return `${base}-p${Math.max(1, Number(prerelease) || 1)}`;
}

/**
 * Build-time rewrite of src/resources/version.js on the beta branch: Version.VERSION
 * becomes the beta string itself ("1.7.1b-fe11d7c-p1"), so everything that
 * imports version.js - window.GAME_VERSION, bug reports, the main menu, the F3
 * overlay - shows the same version.
 *
 * Only the module handed to Vite (dev server or bundle) is transformed. Writing
 * the file would dirty the checkout on every build, and scripts/publish.js merges
 * beta into main, so a committed prerelease would ship in the stable version too.
 */
export function betaVersionPlugin(cwd = process.cwd()) {
    const { isBeta, prerelease } = betaVersionInfo(cwd);

    return {
        name: "beta-version",
        enforce: "pre",
        transform(code, id) {
            if (!isBeta) return null;
            if (!id.split("?")[0].replace(/\\/g, "/").endsWith("/src/resources/version.js")) return null;

            let replaced = false;
            const output = code.replace(
                /(static\s+VERSION\s*=\s*["'])([^"']+)(["'])/,
                (match, open, version, close) => {
                    replaced = true;
                    return `${open}${betaDisplayVersion(version, prerelease)}${close}`;
                }
            );

            return replaced ? { code: output, map: null } : null;
        },
    };
}
