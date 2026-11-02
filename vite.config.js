import { defineConfig } from "vite";
import fs from "fs";
import path from "path";
import basicSsl from '@vitejs/plugin-basic-ssl';

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

export default defineConfig({
    plugins: [copyResourcesPlugin(), basicSsl()],
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
    // Relative asset URLs. The desktop app is packaged with electron-builder
    // and loaded with win.loadFile() (main.js), so the page origin is
    // file:///.../app.asar/dist/index.html. With the default base of "/" the
    // built HTML asks for /assets/index-<hash>.js, which resolves to the
    // filesystem root instead of the bundle and every chunk 404s.
    base: "./",
    build: {
        outDir: "dist",
        assetsInlineLimit: 0,
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
