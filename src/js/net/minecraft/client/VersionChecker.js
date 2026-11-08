import { Version } from "../../../../resources/version.js";


export const VERSION_URL =
    "https://raw.githubusercontent.com/Breakmine-Team/breakmine-revived/refs/heads/main/src/resources/version.js";

const REQUEST_TIMEOUT_MS = 10000;

export function stripGitHash(version) {
    if (typeof version !== "string") return "";
    return version.trim().replace(/-[0-9a-f]{7,40}$/i, "");
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
        result.available = latest !== current;
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