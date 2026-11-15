// Registers sw.js, the worker that makes the game installable as a web app.
//
// Only production builds register it: the worker caches what it fetches, which
// would hand the dev server's stale modules back to the browser while editing.
// A worker also cannot be registered from file://, which is how the desktop
// build loads the page, so the scheme is checked as well.
const SERVICE_WORKER_URL = "./sw.js";

function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;

    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(error => {
        console.warn("[pwa] service worker registration failed:", error);
    });
}

if (import.meta.env.PROD) {
    if (document.readyState === "complete") {
        registerServiceWorker();
    } else {
        window.addEventListener("load", registerServiceWorker, { once: true });
    }
}
