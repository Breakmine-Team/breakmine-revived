import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/home/_doxism/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.STREAM_URL ?? 'http://127.0.0.1:8011/');
    await page.waitForFunction(() => window.app?.worldRenderer?.textureAtlas?.loaded, { timeout: 60000 });
    await page.evaluate(async () => {
        const { default: Options } = await import('/src/js/net/minecraft/client/gui/screens/GuiOptions.js');
        window.app.settings.applyHardwarePreset('balanced');
        const screen = new Options(window.app.currentScreen);
        window.app.displayScreen(screen);
        screen.currentPage = screen.pages.findIndex(page => page.title === 'Distant Terrain'); screen._buildPage();
    });
    await page.screenshot({ path: '/tmp/vanillith-distant-settings.png' });
    await page.evaluate(async () => {
        const { startVanillaTerrainPreview } = await import('/src/js/net/minecraft/client/world/generator/VanillaTerrainPreview.js');
        window.app.settings.vanillithCachedViewDistance = 8;
        await startVanillaTerrainPreview(window.app, 6888349110149677383n);
        const provider = window.app.world.chunkProvider;
        const original = provider.requestRadius.bind(provider);
        provider.requestRadius = () => Promise.resolve();
        window.app.player.setPositionAndRotation(104, window.app.player.y + 32, 8, 90, 20);
        original(6,0,0).catch(error => { window.lodQAError = error.message; });
    });
    await page.waitForFunction(() => window.app.world.chunkProvider.warmRender.entries.has('0,0'), { timeout: 60000 });
    const poolParity = await page.evaluate(async () => {
        const source = window.app.world.chunkProvider.source;
        const coords = [[10,0],[0,10],[-10,0],[0,-10]];
        source.terrainParallelism = 4;
        const parallel = await source.requestTerrainChunksAtAsync(coords);
        const serial = await source.requestTerrainChunksAtAsync(coords, 0);
        for (let i = 0; i < parallel.length; i++) for (const name of ['blocks','biomes','heightmap','fluidUpdates']) {
            const a = parallel[i][name], b = serial[i][name];
            if (a.length !== b.length || a.some((v,j) => v !== b[j])) throw new Error(`Terrain pool parity mismatch: ${i}/${name}`);
        }
        return { workers: source.terrainWorkers.filter(Boolean).length, chunks: coords.length, exact: true };
    });
    await page.waitForTimeout(1500);
    const cached = await page.evaluate(() => {
        const p = window.app.world.chunkProvider;
        return { cachedVisible: p.warmRender.entries.get('0,0').value.group.visible,
            activeContainsOldChunk: p.chunks.has('0,0'), nativeContainsOldChunk: p.world.nativeChunks.getChunk(0,0) !== undefined };
    });
    if (!cached.cachedVisible || cached.activeContainsOldChunk || cached.nativeContainsOldChunk) throw new Error(`Cached render separation failed: ${JSON.stringify(cached)}`);
    await page.evaluate(() => { window.app.settings.vanillithCachedViewDistance = 3; });
    await page.waitForFunction(() => window.app.world.chunkProvider.distantTerrain.cache.entries.get('0,0')?.value.mesh.visible, { timeout: 60000 });
    await page.evaluate(() => {
        const entry = window.app.world.chunkProvider.distantTerrain.cache.entries.get('0,0').value;
        entry.mesh.onBeforeRender = () => { window.lodDraws = (window.lodDraws ?? 0) + 1; };
        const top = entry.mesh.geometry.boundingSphere.center.y;
        window.app.settings.tvmode = true;
        window.app.player.setPositionAndRotation(104, top + 64, 8, 90, Math.atan2(64, 96) * 180 / Math.PI);
    });
    await page.waitForTimeout(500);
    const visual = await page.evaluate(() => {
        const renderer = window.app.worldRenderer, gl = renderer.webRenderer.getContext();
        const pixels = new Uint8Array(80 * 80 * 4);
        gl.readPixels(gl.drawingBufferWidth / 2 - 40, gl.drawingBufferHeight / 2 - 40, 80, 80, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let grassPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i+1] > pixels[i] * 1.2 && pixels[i+1] > pixels[i+2] * 1.1) grassPixels++;
        return { draws: window.lodDraws ?? 0, grassPixels };
    });
    if (!visual.draws || visual.grassPixels < 50) throw new Error(`LOD not visibly rendered: ${JSON.stringify(visual)}`);
    await page.screenshot({ path: '/tmp/vanillith-lod-qa.png' });
    const result = await page.evaluate(() => {
        const p = window.app.world.chunkProvider, lod = p.distantTerrain, entry = lod.cache.entries.get('0,0').value;
        const triangles = entry.mesh.geometry.index.count / 3;
        window.app.settings.vanillithLod = false; lod.updateVisibility(6,0);
        const toggleHides = !entry.mesh.visible;
        window.app.settings.vanillithLod = true; lod.updateVisibility(0,0);
        const nearFieldHides = !entry.mesh.visible;
        const camera = window.app.worldRenderer.camera;
        return { triangles, toggleHides, nearFieldHides, camera: { position: camera.position.toArray(), rotation: camera.rotation.toArray(), lodSphere: entry.mesh.geometry.boundingSphere },
            streaming: p.streamingSnapshot(), metrics: p.streamingMetrics.snapshot(), error: p.error?.message ?? window.lodQAError ?? null };
    });
    if (!result.toggleHides || !result.nearFieldHides || result.error || errors.length) throw new Error(JSON.stringify({ result, errors }));
    await page.evaluate(() => window.app.loadWorld(null));
    console.log(JSON.stringify({ cached, poolParity, visual, result, errors, screenshots: ['/tmp/vanillith-distant-settings.png', '/tmp/vanillith-lod-qa.png'] }));
} finally { await browser.close(); }
