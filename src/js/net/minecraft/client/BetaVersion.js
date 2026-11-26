/**
 * The version the game shows on the beta channel.
 *
 * src/resources/version.js on disk keeps the release version plus build commit,
 * and the updater and version checker compare against it, so it is never
 * rewritten there. A build made from beta gets Version.VERSION itself rewritten
 * by the Vite plugin in scripts/beta-version.js - "1.7.1b-fe11d7c-p1" - counting
 * the commits on beta that main does not have yet. scripts/publish.js merges beta
 * into main, so publishing stable is what starts the next series back at p1;
 * nothing has to store a counter.
 *
 * A build is a beta build when Vite ran from the beta branch (the two values
 * below are injected by scripts/beta-version.js through `define`), or when the
 * game is served from beta.breakmine.com.
 */

const BUILD_IS_BETA = typeof __BETA_BUILD__ !== "undefined" && __BETA_BUILD__ === true;
const BUILD_PRERELEASE = typeof __BETA_PRERELEASE__ !== "undefined" ? Number(__BETA_PRERELEASE__) : 0;

const PAGE_HOST = typeof window !== "undefined" && window.location ? window.location.hostname : "";

export function isBetaHost(hostname = PAGE_HOST) {
    const host = String(hostname || "").toLowerCase();
    return host === "beta.breakmine.com" || host.startsWith("beta.");
}

export const IS_BETA_CHANNEL = BUILD_IS_BETA || isBetaHost();

// A beta host serving a build that was not made from beta has no count to show;
// it is still the first prerelease of that version.
export const PRERELEASE = BUILD_PRERELEASE > 0 ? BUILD_PRERELEASE : 1;

/**
 * "1.6.9b-2a0b993" -> "1.6.9b-2a0b993-p1" on the beta channel. A beta build
 * already carries that in version.js (the Vite plugin rewrites it), so it is
 * returned as-is; the suffix here covers a release build served from a beta host.
 */
export function getDisplayVersion(version) {
    const current = String(version || "");
    if (!IS_BETA_CHANNEL) return current;
    if (/-p\d+$/i.test(current)) return current;

    const release = current.replace(/\s*\(beta\)$/i, "");
    return `${release}-p${PRERELEASE}`;
}
