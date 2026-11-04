import { defineConfig } from "vite";
import fs from "fs";
import path from "path";

function copyResourcesPlugin() {
    let outputDir = "dist";
    return {
        name: "copy-resources",
        configResolved(config) {
            outputDir = config.build.outDir;
        },
        closeBundle() {
            const src = path.resolve(__dirname, "src/resources");
            const dest = path.resolve(__dirname, outputDir, "src/resources");
            if (fs.existsSync(src)) {
                fs.cpSync(src, dest, { recursive: true });
            }
        },
    };
}

export default defineConfig({
    plugins: [copyResourcesPlugin()],
    server: {
        port: 8000,
        allowedHosts: ["breakmine.minetest.land", "breakmine.logicerror.dev"],
    },
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
        ],
    },
});
