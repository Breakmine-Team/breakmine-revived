import { defineConfig } from "vite";
import fs from "fs";
import path from "path";
import basicSsl from '@vitejs/plugin-basic-ssl';
import { betaVersionDefines, betaVersionPlugin } from "./scripts/beta-version.js";

function copyResourcesPlugin() {
    return {
        name: "copy-resources",
        closeBundle() {
            const src = path.resolve(__dirname, "src/resources");
            const dest = path.resolve(__dirname, "dist/src/resources");
            if (fs.existsSync(src)) {
                fs.cpSync(src, dest, { recursive: true });
            }
        },
    };
}

// The web app manifest and the service worker have to sit next to the built
// index.html: a worker can only control pages at or below its own URL, and the
// manifest's relative start_url/scope/icons resolve against its location.
// publicDir is disabled, so they are copied out of the project root instead.
//
// The <link rel="manifest"> is injected after bundling rather than written in
// index.html: Vite processes <link href> as an asset, which moved the manifest
// to assets/manifest-<hash>.webmanifest and left its relative URLs pointing one
// directory too deep (start_url became /assets/ and every icon 404'd).
function buildInputs() {
    const inputs = { main: path.resolve(__dirname, "index.html") };
    const launcher = path.resolve(__dirname, "launcher.html");
    if (fs.existsSync(launcher)) {
        inputs.launcher = launcher;
    }
    return inputs;
}

function pwaPlugin() {
    const files = ["manifest.webmanifest", "sw.js"];
    const manifestTag = '<link rel="manifest" href="./manifest.webmanifest">';

    return {
        name: "pwa",
        // The dev server serves the project root, so the manifest is already
        // reachable there - only the tag is missing.
        transformIndexHtml(html, ctx) {
            if (!ctx.server) return html;
            return {
                html,
                tags: [{
                    tag: "link",
                    attrs: { rel: "manifest", href: "./manifest.webmanifest" },
                    injectTo: "head",
                }],
            };
        },
        closeBundle() {
            const dest = path.resolve(__dirname, "dist");
            for (const file of files) {
                const src = path.resolve(__dirname, file);
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, path.join(dest, file));
                }
            }

            const htmlPath = path.join(dest, "index.html");
            if (!fs.existsSync(htmlPath)) return;
            const html = fs.readFileSync(htmlPath, "utf-8");
            if (html.includes('rel="manifest"')) return;
            fs.writeFileSync(htmlPath, html.replace("</head>", `    ${manifestTag}\n</head>`));
        },
    };
}

export default defineConfig({
    plugins: [betaVersionPlugin(__dirname), copyResourcesPlugin(), pwaPlugin(), basicSsl()],
    root: '.',
    publicDir: false,
    server: {
        port: 8002,
        https: true,
        allowedHosts: true,
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        },
        fs: {
            strict: false,
            cachedChecks: false,
            allow: ['.']
        },
        watch: {
            usePolling: true,
            interval: 100
        }
    },
    cacheDir: false,
    // "1.7.1b-fe11d7c-p3" in beta builds; see src/js/net/minecraft/client/BetaVersion.js.
    define: betaVersionDefines(__dirname),
    // Relative asset URLs. The desktop app is packaged with electron-builder
    // and loaded with win.loadFile() (main.js), so the page origin is
    // file:///.../app.asar/dist/index.html. With the default base of "/" the
    // built HTML asks for /assets/index-<hash>.js, which resolves to the
    // filesystem root instead of the bundle and every chunk 404s.
    base: "./",
    build: {
        outDir: "dist",
        assetsInlineLimit: 0,
        rollupOptions: {
            // launcher.html is a standalone page for browsing older builds. It is
            // a second entry so it lands in dist/ next to the game, and it stays
            // out of the single-file build (which has its own config). It is only
            // an entry while the page exists, so removing it cannot break the
            // normal build.
            input: buildInputs(),
        },
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
