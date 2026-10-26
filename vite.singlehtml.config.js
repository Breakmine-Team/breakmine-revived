import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import fs from "fs";
import path from "path";

function copyResourcesPlugin() {
    return {
        name: "copy-resources",
        closeBundle() {
            const src = path.resolve(__dirname, "src/resources");
            const dest = path.resolve(__dirname, "dist-single/src/resources");
            if (fs.existsSync(src)) {
                fs.cpSync(src, dest, { recursive: true });
            }
        },
    };
}

function forceBrowserFsPlugin() {
    return {
        name: "force-browser-fs",
        transform(code, id) {
            if (id.includes('IsomorphicFilesystem.js')) {
                console.log('[force-browser-fs] Transforming IsomorphicFilesystem.js');
                // Force isNode to false for singlefile builds
                // Replace the entire isNode detection and nodeFs initialization
                const transformed = code.replace(
                    /\/\/ Node\.js detection[\s\S]*?nodePath = null;/,
                    '// Node.js detection - forced to false for singlefile build\nconst isNode = false;\nlet nodeFs = null;\nlet nodeFsSync = null;\nlet nodePath = null;'
                );
                console.log('[force-browser-fs] Transformation applied');
                return transformed;
            }
            return null;
        },
    };
}

function inlineFaviconPlugin() {
    return {
        name: "inline-favicon",
        transformIndexHtml(html) {
            // Replace favicon link with data URI if possible, or remove it
            return html.replace(/<link[^>]*rel=["']shortcut icon["'][^>]*>/gi, '');
        },
        closeBundle() {
            // Delete the favicon file that was generated
            const faviconPath = path.resolve(__dirname, "dist-single/favicon-*.ico");
            try {
                const files = fs.readdirSync(path.resolve(__dirname, "dist-single"));
                for (const file of files) {
                    if (file.startsWith('favicon-') && file.endsWith('.ico')) {
                        fs.unlinkSync(path.resolve(__dirname, "dist-single", file));
                    }
                }
            } catch (e) {
                // Ignore if file doesn't exist
            }
        },
    };
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inline the built Web Worker bundles into the HTML.
 *
 * A single-file build has nowhere to put `integrated.worker-<hash>.js`, so each
 * worker becomes a Blob URL created by a small classic script injected into
 * <head>, and every reference to the worker file in the bundle is pointed at
 * that global. Three things matter here, two of them learned the hard way:
 *
 *  - The reference has to be replaced *with its quotes*. Vite emits
 *    `new URL("integrated.worker-<hash>.js", import.meta.url)`, so replacing
 *    only the file name left the quotes in place and the bundle handed the
 *    literal string "__inlineWorkerUrl" to `new Worker`, which resolved to
 *    `<page>/__inlineWorkerUrl` and 404'd.
 *  - The payload is embedded as base64, not pasted into a template literal.
 *    Escaping a bundle into a template string means every backtick, backslash
 *    and `${` has to survive, and the whole file travels through a JS string
 *    literal; base64 is byte-exact and needs no escaping.
 *  - Workers Vite inlined by itself (it does that for a worker referenced
 *    through a variable) arrive as `data:text/javascript;base64,...`. A data:
 *    URL is not same-origin, so module workers are rejected there; they are
 *    re-registered as Blob URLs so both workers load the same way.
 *
 * Workers are also forced to the *classic* type. A single-file build is usually
 * opened straight from disk (`file://`), where the document origin is opaque
 * and a module worker - fetched in same-origin mode - cannot be loaded at all:
 * the constructor succeeds and the worker then fires `error` with an empty
 * message. Classic workers are not fetched under that restriction, which is
 * what makes a Blob URL work on `file://`. `worker.format: 'iife'` below keeps
 * the bundles valid classic scripts, and the wrapper below drops the
 * `{ type: 'module' }` the sources ask for.
 */
function inlineWorkerPlugin() {
    const GLOBAL = '__breakmineWorkerBlobs';

    return {
        name: "inline-worker",
        closeBundle() {
            const distDir = path.resolve(__dirname, "dist-single");
            const htmlPath = path.join(distDir, "index-single.html");
            if (!fs.existsSync(htmlPath)) return;

            try {
                let html = fs.readFileSync(htmlPath, "utf-8");
                const blobs = [];
                const usedNames = new Set();

                const uniqueName = (candidate) => {
                    const base = candidate.replace(/[^A-Za-z0-9_$]/g, '_') || 'worker';
                    let name = base;
                    let suffix = 1;
                    while (usedNames.has(name)) name = `${base}_${suffix++}`;
                    usedNames.add(name);
                    return name;
                };

                // 1. Worker chunks Vite emitted as separate files.
                for (const file of fs.readdirSync(distDir)) {
                    if (!file.endsWith('.js') || !/worker/i.test(file)) continue;

                    const name = uniqueName(file.replace(/\.worker.*\.js$/i, ''));
                    const base64 = fs.readFileSync(path.join(distDir, file)).toString('base64');
                    blobs.push({ name, base64 });

                    // Quote classes on both sides: Vite emits a plain string,
                    // rolldown emits a template literal.
                    const reference = new RegExp(`(["'\`])${escapeRegExp(file)}(["'\`])`, 'g');
                    html = html.replace(reference, `${GLOBAL}.${name}`);

                    fs.unlinkSync(path.join(distDir, file));
                }

                // 2. Workers Vite already inlined as data: URLs.
                const dataUrls = new Map();
                html = html.replace(
                    /(["'`])data:text\/javascript;base64,([A-Za-z0-9+/=]+)\1/g,
                    (match, quote, base64) => {
                        let name = dataUrls.get(base64);
                        if (!name) {
                            name = uniqueName('worker');
                            dataUrls.set(base64, name);
                            blobs.push({ name, base64 });
                        }
                        return `${GLOBAL}.${name}`;
                    }
                );

                if (blobs.length === 0) return;

                const registrations = blobs
                    .map((entry) => `    register(${JSON.stringify(entry.name)}, '${entry.base64}');`)
                    .join('\n');

                const injectedScript = `
<script>
(function () {
    const workers = {};
    window.${GLOBAL} = workers;

    function register(name, base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        workers[name] = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    }

${registrations}

    // The workers in this bundle are classic scripts (worker.format: 'iife'),
    // and classic is the only type a file:// page can load.
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
        constructor(url, options) {
            super(url, Object.assign({}, options, { type: 'classic' }));
        }
    };
})();
</script>`;

                fs.writeFileSync(htmlPath, html.replace(/(<\/head>)/, injectedScript + '$1'));
                console.log(`[inline-worker] Inlined ${blobs.length} worker bundle(s): ${blobs.map((entry) => entry.name).join(', ')}`);
            } catch (e) {
                console.error('[inline-worker] Failed to inline worker:', e);
            }
        },
    };
}

export default defineConfig({
    plugins: [
        copyResourcesPlugin(),
        forceBrowserFsPlugin(),
        viteSingleFile({
            removeOptionalTags: false,
            useRecommendedBuildConfig: true,
        }),
        inlineFaviconPlugin(),
        inlineWorkerPlugin(),
    ],
    build: {
        outDir: "dist-single",
        assetsInlineLimit: Infinity,
        target: "esnext",
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index-single.html'),
            },
            output: {
                inlineDynamicImports: true,
            },
        },
        chunkSizeWarningLimit: 100000,
    },
    worker: {
        // Classic (non-module) worker bundles: see inlineWorkerPlugin above -
        // a module worker cannot be loaded from a file:// page.
        format: 'iife',
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
            },
        },
    },
    define: {
        'process.env.SINGLEFILE_BUILD': 'true',
    },
    optimizeDeps: {
        exclude: [
            "libraries/aes.js",
            "libraries/asn1.js",
            "libraries/bigint-mod-arith.js",
            "libraries/sha1.min.js",
            "libraries/pako.es5.min.js",
            "libraries/peerjs.js",
        ],
    },
});
