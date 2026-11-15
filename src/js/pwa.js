// Registers sw.js, the worker that makes the game installable as a web app.
//
// Registration is deliberately not gated on the build: the deployed site also
// serves src/ unbundled, where import.meta.env does not exist. There is nothing
// to protect either way - the worker is network-first, so it only ever answers
// from its cache when the network itself fails.
//
// The scheme is checked because a worker cannot be registered from file://,
// which is how the desktop build loads the page.
const SERVICE_WORKER_URL = "./sw.js";

function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;

    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(error => {
        console.warn("[pwa] service worker registration failed:", error);
    });
}

if (document.readyState === "complete") {
    registerServiceWorker();
} else {
    window.addEventListener("load", registerServiceWorker, { once: true });
}
