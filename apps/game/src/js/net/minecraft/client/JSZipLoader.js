/**
 * JSZip loader.
 *
 * JSZip used to be fetched at runtime via a <script src="libraries/jszip.min.js">
 * tag. That path only resolves in the dev server and in Electron, which serve
 * the repository root. Neither `dist/` nor `dist-single/` contains a
 * `libraries/` directory, so the tag 404'd in built games and callers crashed
 * with "Cannot read properties of undefined (reading 'loadAsync')".
 *
 * Bundling the npm package makes the library part of the build output, so it is
 * embedded in the single-file build too. The vendored UMD file is still used as
 * a fallback for setups that run the sources un-bundled.
 */

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

/**
 * Returns the JSZip constructor, loading it on first use.
 * The result is cached on window.JSZip so repeat calls stay synchronous.
 */
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
        // Let a later call retry instead of caching the failure forever.
        pending = null;
        throw new Error(
            'JSZip is unavailable, so ZIP operations (mod install, texture packs, ' +
            'world export) cannot run. ' + (error && error.message ? error.message : error)
        );
    });

    return pending;
}

export default loadJSZip;
