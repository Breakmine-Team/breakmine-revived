import { Version } from "../../../../resources/version.js";

/*
 *  Update check
 *
 *  Compares the version baked into this build against the one committed to
 *  `main`, so the main menu can offer an update.
 *
 *  The version string carries the git hash that produced it, e.g.
 *  "4.8.5a-1109693". That hash is noise in the UI, so it is stripped for
 *  display; the raw string is still used for the comparison itself, because
 *  two builds of the same release have different hashes.
 */

export const VERSION_URL =
    "https://raw.githubusercontent.com/Breakmine-Team/breakmine-revived/refs/heads/main/src/resources/version.js";

const REQUEST_TIMEOUT_MS = 10000;

/**
 * Drop the trailing git hash: "4.8.5a-1109693" -> "4.8.5a".
 *
 * Requires 7-40 hex digits so that legitimate dashes survive, e.g. Patchwork's
 * "1.4.0-beta" is left alone ("beta" is not hex).
 */
export function stripGitHash(version) {
    if (typeof version !== "string") return "";
    return version.trim().replace(/-[0-9a-f]{7,40}$/i, "");
}

/** Pull `static VERSION = "..."` out of a version.js source string. */
export function parseVersionSource(source) {
    if (typeof source !== "string") return "";
    const match = source.match(/static\s+VERSION\s*=\s*["']([^"']+)["']/);
    return match ? match[1].trim() : "";
}

/**
 * Ask GitHub for the newest committed version.
 * @returns {Promise<string>} e.g. "4.8.5a-1109693"
 */
export async function fetchLatestVersion() {
    // Cache-bust: raw.githubusercontent.com caches hard, and a stale answer here
    // means the button silently never appears.
    const url = `${VERSION_URL}?t=${Date.now()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            cache: "no-store",
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const parsed = parseVersionSource(await response.text());
        if (!parsed) {
            throw new Error("no VERSION found in version.js");
        }
        return parsed;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @returns {Promise<{current: string, currentClean: string, latest: string,
 *                    latestClean: string, available: boolean, error: ?string}>}
 *          Never rejects — a failed check just reports `error`, because a
 *          missing update prompt must not break the main menu.
 */
export async function checkForUpdate() {
    const current = Version.VERSION;
    const result = {
        current,
        currentClean: stripGitHash(current),
        latest: "",
        latestClean: "",
        available: false,
        error: null
    };

    try {
        const latest = await fetchLatestVersion();
        result.latest = latest;
        result.latestClean = stripGitHash(latest);
        result.available = latest !== current;
    } catch (err) {
        result.error = (err && err.message) || String(err);
    }

    return result;
}

/** True when running as a packaged install rather than a dev checkout. */
export function isPackagedApp() {
    return !!(window.modsBridge && window.modsBridge.isPackaged);
}