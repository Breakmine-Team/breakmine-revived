// Breakmine service worker.
//
// A registered worker with a fetch handler is what lets Chrome offer "Install
// app", and it also lets the shell open when the network is unavailable.
//
// Strategy: network first. Every successful same-origin GET is mirrored into
// the cache, and the cache is only consulted when the network itself fails.
// Serving from the cache first would pin players to whatever build they first
// loaded, which is wrong for a game that ships updates constantly.
const CACHE_NAME = "breakmine-v1";
const CACHE_PREFIX = "breakmine-";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest"];

// Responses above this size are left out of the cache: a couple of megabytes of
// texture or music is fine to re-download, and quota pressure is not.
const MAX_CACHED_BYTES = 8 * 1024 * 1024;

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // cache.add() rejects on any failure, so each shell entry stands alone.
        await Promise.all(APP_SHELL.map(async url => {
            try {
                await cache.add(new Request(url, { cache: "reload" }));
            } catch (error) {
                // A missing shell entry must not block the install.
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(
            names
                .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
                .map(name => caches.delete(name))
        );
        await self.clients.claim();
    })());
});

function isCacheable(response) {
    if (!response || response.status !== 200 || response.type !== "basic") return false;
    const length = Number(response.headers.get("Content-Length"));
    return !Number.isFinite(length) || length <= MAX_CACHED_BYTES;
}

self.addEventListener("fetch", event => {
    const request = event.request;

    // Only same-origin GETs are handled. Everything else - the API, the tunnel
    // websocket's HTTP probes, anything cross-origin - goes straight to the
    // network untouched.
    if (request.method !== "GET") return;
    if (request.headers.has("Range")) return;
    if (new URL(request.url).origin !== self.location.origin) return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            if (isCacheable(response)) {
                const copy = response.clone();
                caches.open(CACHE_NAME)
                    .then(cache => cache.put(request, copy))
                    .catch(() => {});
            }
            return response;
        } catch (error) {
            const cached = await caches.match(request, { ignoreSearch: true });
            if (cached) return cached;
            if (request.mode === "navigate") {
                const shell = await caches.match("./index.html") || await caches.match("./");
                if (shell) return shell;
            }
            throw error;
        }
    })());
});
