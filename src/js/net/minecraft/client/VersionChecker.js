import { Version } from "../../../../resources/version.js";


export const VERSION_URL =
    "https://raw.githubusercontent.com/Breakmine-Team/breakmine-revived/refs/heads/main/src/resources/version.js";

const REQUEST_TIMEOUT_MS = 10000;

export function stripGitHash(version) {
    if (typeof version !== "string") return "";
    // Beta builds carry the prerelease and channel marker in VERSION itself
    // ("1.7.1b-fe11d7c-p1"); compare releases, so beta does not report itself
    // as older than the stable version it is ahead of.
    return version.trim()
        .replace(/-p\d+$/i, "")
        .replace(/\s*\(beta\)$/i, "")
        .replace(/-[0-9a-f]{7,40}$/i, "");
}

/**
 * Compares two game versions ("1.6.3b-7e24527", "1.6.3b", "1.6.4") component
 * by component. Returns a positive number when `a` is newer than `b`, a
 * negative number when it is older, and 0 when they are the same version.
 * A letter suffix (the "b" in "1.6.3b") counts as newer than no suffix.
 */
export function compareVersions(a, b) {
    const split = (version) => stripGitHash(version).split(".");
    const partsA = split(a);
    const partsB = split(b);
    const length = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < length; i++) {
        const partA = partsA[i] || "0";
        const partB = partsB[i] || "0";
        const matchA = /^(\d*)([a-z]*)$/i.exec(partA) || [partA, "0", partA];
        const matchB = /^(\d*)([a-z]*)$/i.exec(partB) || [partB, "0", partB];

        const numberA = parseInt(matchA[1], 10) || 0;
        const numberB = parseInt(matchB[1], 10) || 0;
        if (numberA !== numberB) return numberA - numberB;

        const suffixA = (matchA[2] || "").toLowerCase();
        const suffixB = (matchB[2] || "").toLowerCase();
        if (suffixA !== suffixB) return suffixA > suffixB ? 1 : -1;
    }

    return 0;
}

export function parseVersionSource(source) {
    if (typeof source !== "string") return "";
    const match = source.match(/static\s+VERSION\s*=\s*["']([^"']+)["']/);
    return match ? match[1].trim() : "";
}

export async function fetchLatestVersion() {
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
        result.available = compareVersions(latest, current) > 0;
    } catch (err) {
        result.error = (err && err.message) || String(err);
    }

    return result;
}

export function isPackagedApp() {
    return !!(window.modsBridge && window.modsBridge.isPackaged);
}

export function isElectronApp() {
    if (typeof window !== "undefined" && window.process && window.process.type === "renderer") {
        return true;
    }
    if (typeof process !== "undefined" && process.versions && process.versions.electron) {
        return true;
    }
    return typeof navigator === "object"
        && typeof navigator.userAgent === "string"
        && navigator.userAgent.indexOf("Electron") >= 0;
}