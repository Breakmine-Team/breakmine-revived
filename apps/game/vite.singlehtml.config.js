import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
    plugins: [
        viteSingleFile({
            removeOptionalTags: false,
            useRecommendedBuildConfig: true,
        }),
    ],
    build: {
        outDir: "dist-single",
        assetsInlineLimit: Infinity,
        target: "esnext",
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