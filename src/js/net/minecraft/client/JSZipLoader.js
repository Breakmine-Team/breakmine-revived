

let pending = null;

function loadFromScriptTag() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'libraries/jszip.min.js';
        script.onload = () => {
            if (window.JSZip) resolve(window.JSZip);
            else reject(new Error('JSZip script tag loaded but window.JSZip is undefined'));
        };
        script.onerror = () => reject(new Error('Failed to load libraries/jszip.min.js'));
        document.head.appendChild(script);
    });
}

export function loadJSZip() {
    if (typeof window !== 'undefined' && window.JSZip) return Promise.resolve(window.JSZip);
    if (pending) return pending;

    pending = (async () => {
        try {
            const mod = await import('jszip');
            const JSZip = mod.default || mod;
            if (typeof JSZip !== 'function') throw new Error('jszip module has no constructor export');
            if (typeof window !== 'undefined') window.JSZip = JSZip;
            return JSZip;
        } catch (bundleError) {
            console.warn('[JSZip] bundled import failed, falling back to script tag:', bundleError);
            return loadFromScriptTag();
        }
    })().catch((error) => {
        pending = null;
        throw new Error(
            'JSZip is unavailable, so ZIP operations (mod install, texture packs, ' +
            'world export) cannot run. ' + (error && error.message ? error.message : error)
        );
    });

    return pending;
}

export default loadJSZip;
