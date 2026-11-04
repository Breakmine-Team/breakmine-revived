import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

// A throwaway browser/profile: never connects to the user's desktop browser.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/home/_doxism/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const memorySamples = [];
const browserCDP = await browser.newBrowserCDPSession();
async function sampleMemory() {
    try {
        const { processInfo } = await browserCDP.send('SystemInfo.getProcessInfo');
        const samples = await Promise.all(processInfo.map(async process => {
            try {
                const rollup = await readFile(`/proc/${process.id}/smaps_rollup`, 'utf8');
                return { type: process.type, pssKiB: Number(rollup.match(/^Pss:\s+(\d+)/m)?.[1] ?? 0) };
            } catch { return { type: process.type, pssKiB: 0 }; }
        }));
        const pssKiB = samples.reduce((sum, sample) => sum + sample.pssKiB, 0);
        memorySamples.push({ at: Date.now(), pssKiB });
        return { pssKiB, processes: samples };
    } catch { return null; }
}
const memoryInterval = setInterval(() => { sampleMemory().catch(() => {}); }, 2000);
try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.STREAM_URL ?? 'http://127.0.0.1:8000/');
    await page.waitForFunction(() => window.app?.worldRenderer?.textureAtlas?.loaded, { timeout: 60000 });
    await page.evaluate(async variant => {
        const root = '/src/js/net/minecraft/client/';
        const launchSource = await (await fetch(root + 'world/generator/VanillaTerrainPreview.js')).text();
        const modulePath = name => launchSource.match(new RegExp('from "([^"]+/' + name + '\\.js[^\"]*)"'))?.[1];
        const [{ default: Provider }, { default: Source }, { default: Section }] = await Promise.all([
            import(modulePath('VanillaPreviewChunkProvider') ?? root + 'world/provider/VanillaPreviewChunkProvider.js'),
            import(modulePath('VanillaChunkProvider') ?? root + 'world/provider/VanillaChunkProvider.js'),
            import(root + 'world/ChunkSection.js')
        ]);
        const m = window.streamProfile = { frames: [], stages: [], chunkReady: [], scenarios: [], requests: {}, longTasks: [], hashes: {}, hashJobs: [], start: performance.now() };
        const wrap = (object, name) => {
            const original = object[name];
            object[name] = function (...args) {
                const start = performance.now();
                m.requests[name] = (m.requests[name] ?? 0) + 1;
                const finish = () => m.stages.push({ name, start, ms: performance.now() - start });
                const result = original.apply(this, args);
                if (result?.then) return result.finally(finish);
                finish(); return result;
            };
        };
        for (const name of ['getTerrainChunksAtAsync', 'ensureDecorationTerrain', 'getChunksAtAsync']) wrap(Source.prototype, name);
        wrap(Provider.prototype, 'loadVanillaChunk');
        wrap(Section.prototype, 'rebuild');
        const loaded = Provider.prototype.installVanillaChunk;
        Provider.prototype.installVanillaChunk = function (...args) {
            const chunk = loaded.apply(this, args);
            m.chunkReady.push({ at: performance.now(), x: chunk.x, z: chunk.z });
            const key = `${chunk.x},${chunk.z}`;
            if (!m.hashes[key]) {
                m.hashes[key] = {};
                m.hashJobs.push(Promise.all(['blocks', 'biomes', 'heightmap', 'fluidUpdates'].map(async field => {
                    if (chunk.native[field]) m.hashes[key][field] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', chunk.native[field])), b => b.toString(16).padStart(2, '0')).join('');
                })));
            }
            return chunk;
        };
        new PerformanceObserver(list => m.longTasks.push(...list.getEntries().map(e => ({ at: e.startTime, ms: e.duration })))).observe({ type: 'longtask', buffered: true });
        let previous = performance.now();
        const frame = now => { m.frames.push({ at: now, ms: now - previous }); previous = now; requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
        window.app.settings.tvmode = true;
        window.app.settings.viewDistance = 4;
        if (variant === 'baseline') window.app.settings.vanillithFrameBudget = false;
        window.app.settings.vanillithWarmCache = ['cache', 'priority', 'full'].includes(variant);
        window.app.settings.vanillithPriorityStreaming = ['priority', 'full'].includes(variant);
        const { startVanillaTerrainPreview } = await import(root + 'world/generator/VanillaTerrainPreview.js');
        window.launchProfile = startVanillaTerrainPreview(window.app, 6888349110149677383n, { decorationDraft: true });
    }, process.env.STREAM_VARIANT ?? 'baseline');
    await page.evaluate(() => window.launchProfile);
    await page.waitForFunction(() => window.app.world && !window.app.loadingScreen, { timeout: 120000 });
    await page.evaluate(() => {
        const m = window.streamProfile;
        for (const [object, name] of [[window.app.world, 'updateLights'], [window.app.worldRenderer, 'render']]) {
            const original = object[name];
            object[name] = function (...args) {
                const start = performance.now(), result = original.apply(this, args);
                m.stages.push({ name, start, ms: performance.now() - start }); return result;
            };
        }
    });
    const duration = Number(process.env.STREAM_SCENARIO_MS ?? 6000);
    const scenarios = [['stationary', 0], ['walking', 4.3], ['sprinting', 5.6], ['turn-return', -5.6], ['A-B-A', 0], ['flight', 20], ['long-exploration', 8]];
    for (const [name, speed] of scenarios) {
        await page.evaluate(({ name, speed, duration }) => {
            const p = window.app.player, m = window.streamProfile;
            const start = performance.now(), origin = p.x, y = p.y, z = p.z;
            const scenario = { name, start, initialChunks: window.app.world.chunkProvider.chunks.size };
            m.scenarios.push(scenario);
            window.profileMove = setInterval(() => {
                const elapsed = (performance.now() - start) / 1000;
                const offset = name === 'A-B-A' ? 48 * Math.sin(elapsed * Math.PI * 2 / (duration / 1000)) : speed * elapsed;
                p.setPositionAndRotation(origin + offset, y, z, speed < 0 ? 90 : -90, 20);
                p.motionX = name === 'A-B-A' ? Math.cos(elapsed * Math.PI * 2 / (duration / 1000)) * 0.3 : speed / 20;
            }, 50);
        }, { name, speed, duration });
        await page.waitForTimeout(name === 'stationary' ? Number(process.env.STREAM_STATIONARY_MS ?? duration)
            : name === 'long-exploration' ? Number(process.env.STREAM_LONG_MS ?? duration) : duration);
        await page.evaluate(() => {
            clearInterval(window.profileMove);
            const s = window.streamProfile.scenarios.at(-1), provider = window.app.world.chunkProvider;
            s.end = performance.now(); s.chunks = provider.chunks.size;
            s.error = provider.error?.message ?? null;
            s.streaming = provider.streamingSnapshot?.() ?? null;
            s.heap = performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null;
        });
        const processMemory = await sampleMemory();
        await page.evaluate(memory => { window.streamProfile.scenarios.at(-1).processMemory = memory; }, processMemory);
    }
    await page.evaluate(() => Promise.all(window.streamProfile.hashJobs));
    const result = await page.evaluate(() => {
        const m = window.streamProfile;
        const stats = values => {
            values.sort((a, b) => a - b);
            const q = p => values[Math.floor((values.length - 1) * p)] ?? 0;
            return { n: values.length, median: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over16: values.filter(v => v > 16.7).length, over33: values.filter(v => v > 33.3).length, over50: values.filter(v => v > 50).length };
        };
        return { start: m.start, firstDecoratedMs: (m.chunkReady[0]?.at ?? m.start) - m.start,
            nineDecoratedMs: m.chunkReady.length >= 9 ? m.chunkReady[8].at - m.start : null,
            stages: Object.fromEntries([...new Set(m.stages.map(s => s.name))].map(name => [name, stats(m.stages.filter(s => s.name === name).map(s => s.ms))])),
            scenarios: m.scenarios.map(s => ({ ...s, frames: stats(m.frames.filter(f => f.at >= s.start && f.at < s.end).map(f => f.ms)),
                ready: m.chunkReady.filter(c => c.at >= s.start && c.at < s.end).length })),
            requests: m.requests, longTasks: m.longTasks, chunkReady: m.chunkReady,
            metrics: window.app.world.chunkProvider.streamingMetrics?.snapshot?.() ?? null, hashes: m.hashes };
    });
    result.errors = errors;
    result.memory = { sampleIntervalMs: 2000, peakProcessPssKiB: Math.max(0, ...memorySamples.map(s => s.pssKiB)), samples: memorySamples };
    result.environment = { browser: await browser.version(), renderer: 'headless Chromium / SwiftShader', seed: '6888349110149677383', scenarioMs: duration, variant: process.env.STREAM_VARIANT ?? 'baseline' };
    await writeFile(process.env.STREAM_REPORT ?? '/tmp/vanillith-streaming-baseline.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ environment: result.environment, firstDecoratedMs: result.firstDecoratedMs, nineDecoratedMs: result.nineDecoratedMs,
        stages: result.stages, scenarios: result.scenarios.map(s => ({ name: s.name, frames: s.frames, chunks: s.chunks, ready: s.ready, streaming: s.streaming, heap: s.heap, error: s.error })),
        metrics: result.metrics, memory: { peakProcessPssKiB: result.memory.peakProcessPssKiB }, errors: result.errors }));
} finally { clearInterval(memoryInterval); await browser.close(); }
