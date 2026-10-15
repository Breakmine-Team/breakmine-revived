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

function inlineWorkerPlugin() {
    return {
        name: "inline-worker",
        closeBundle() {
            // Inline the worker file into the HTML
            const distDir = path.resolve(__dirname, "dist-single");
            const htmlPath = path.resolve(distDir, "index-single.html");
            
            try {
                const files = fs.readdirSync(distDir);
                const workerFile = files.find(f => f.startsWith('integrated.worker-') && f.endsWith('.js'));
                
                if (workerFile) {
                    const workerPath = path.resolve(distDir, workerFile);
                    const workerCode = fs.readFileSync(workerPath, 'utf-8');
                    const html = fs.readFileSync(htmlPath, 'utf-8');
                    
                    // Escape the worker code for use in a template literal
                    const escapedWorkerCode = workerCode
                        .replace(/\\/g, '\\\\')
                        .replace(/`/g, '\\`')
                        .replace(/\$/g, '\\$');
                    
                    // Create inline worker code
                    const inlineWorkerScript = `
<script>
(function() {
    const workerCode = \`${escapedWorkerCode}\`;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    window.__inlineWorkerUrl = workerUrl;
})();
</script>`;
                    
                    // Insert the inline worker script before the closing head tag
                    const updatedHtml = html.replace(
                        /(<\/head>)/,
                        inlineWorkerScript + '$1'
                    );
                    
                    // Replace worker file references with the inline URL
                    const finalHtml = updatedHtml.replace(
                        /integrated\.worker-[^"]+\.js/g,
                        '__inlineWorkerUrl'
                    );
                    
                    fs.writeFileSync(htmlPath, finalHtml);
                    fs.unlinkSync(workerPath);
                    console.log('[inline-worker] Worker inlined successfully');
                }
                
                // Also inline integrated.worker.js if it exists (the integrated server worker)
                const integratedWorkerFile = files.find(f => f === 'integrated.worker.js');
                if (integratedWorkerFile) {
                    const workerPath = path.resolve(distDir, integratedWorkerFile);
                    const workerCode = fs.readFileSync(workerPath, 'utf-8');
                    const html = fs.readFileSync(htmlPath, 'utf-8');
                    
                    const escapedWorkerCode = workerCode
                        .replace(/\\/g, '\\\\')
                        .replace(/`/g, '\\`')
                        .replace(/\$/g, '\\$');
                    
                    const inlineWorkerScript = `
<script>
(function() {
    const integratedWorkerCode = \`${escapedWorkerCode}\`;
    const blob = new Blob([integratedWorkerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    window.__integratedWorkerUrl = workerUrl;
})();
</script>`;
                    
                    const updatedHtml = html.replace(
                        /(<\/head>)/,
                        inlineWorkerScript + '$1'
                    );
                    
                    const finalHtml = updatedHtml.replace(
                        /new Worker\(new URL\('integrated\.worker\.js', import\.meta\.url\)\)/g,
                        'new Worker(window.__integratedWorkerUrl)'
                    );
                    
                    fs.writeFileSync(htmlPath, finalHtml);
                    fs.unlinkSync(workerPath);
                    console.log('[inline-worker] Integrated worker inlined successfully');
                }
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
        format: 'es',
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
        ],
    },
});