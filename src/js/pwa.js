// Registers sw.js, the worker that makes the game installable as a web app.
//
// The dev server is skipped on purpose. The worker only answers from its cache
// when the network fails, but it still has to pass every module request
// through, and Firefox fails those inside the worker ("A ServiceWorker
// intercepted the request and encountered an unexpected error"), so the game
// never boots there. The deployed site also serves src/ unbundled, where
// import.meta.env does not exist at all, and registers there as before.
//
// The scheme is checked because a worker cannot be registered from file://,
// which is how the desktop build loads the page.
const SERVICE_WORKER_URL = "./sw.js";

function isDevServer() {
    // Vite replaces import.meta.env in dev and in the build; the raw unbundled
    // deploy leaves it undefined.
    return Boolean(import.meta.env?.DEV);
}

// A worker registered on an earlier dev visit keeps controlling the page even
// though it is no longer wanted, and it is what breaks Firefox. Dropping the
// registration is what gets those browsers working again, after one reload.
function unregisterServiceWorkers() {
    navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .then(removed => {
            if (removed.some(Boolean)) {
                console.info("[pwa] service worker removed: it is not used on the dev server");
            }
        })
        .catch(error => {
            console.warn("[pwa] service worker removal failed:", error);
        });
}

function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;

    if (isDevServer()) {
        unregisterServiceWorkers();
        return;
    }

    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(error => {
        console.warn("[pwa] service worker registration failed:", error);
    });
}

if (document.readyState === "complete") {
    setupServiceWorker();
} else {
    window.addEventListener("load", setupServiceWorker, { once: true });
}
