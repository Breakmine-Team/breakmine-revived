# Vanillith streaming audit

This is a historical engineering audit. References to a read-only preview
describe the setup used for the audit; saved Vanillith singleplayer worlds now
exist. See [Vanillith](VANILLITH.md) for the current status.

## Existing path (before this change)

```mermaid
flowchart LR
    P[Player tick: camera chunk + motion sign] --> D[requestRadius: terrain radius 2 / decorated radius 1]
    D --> T[Terrain worker: synchronous batches of 4]
    T --> C[Transfer terrain arrays to main thread]
    C --> I[Clone / transfer to integrated worker: terrain LRU 49]
    I --> G[Serial decoration service: center then neighboring batch]
    G --> R[Transfer completed native arrays]
    R --> N[Main: store copies + render chunk mapping + lighting]
    N --> M[20 Hz tick: rebuild up to 32 sections synchronously]
    M --> U[Three.js geometry / first-visible GPU upload]
    U --> V[Visibility]
    V --> E[Outside radius + 1: dispose meshes and delete native data]
```

The provider and service both deduplicate decorated requests, scoped to one
seed/settings/dimension/source context. Terrain preloads reuse compatible native
payloads; the service retains a 49-chunk terrain LRU and a bounded 32 MiB cache
of exact decoration request results. Region source execution is serial and
preserves existing feature ordering. Scalar memo/batch/cache and canonical
progressive experiments remain disabled.

The separate terrain worker uses a zero-sized terrain cache. Terrain dependency
requests arrive in batches of four. Synchronous computation prevents the
integrated worker from accepting preload messages during decoration. There are
two generation workers, not a per-chunk worker pool.

On the main thread, `readVanillaChunk` allocates and copies typed arrays; native
render mapping scans 98,304 blocks per overworld chunk into legacy section
arrays. `loadVanillaChunk` also invalidates biome tints, initializes light and
marks adjacent sections dirty. Up to eight completed neighboring chunks can be
published in one microtask. Mesh construction occurs in `WorldRenderer.onTick`:
up to 32 indivisible section rebuilds; multiple catch-up ticks can occur in a
single animation frame. Geometry upload occurs on the next Three.js render.
`ChunkSection.rebuild` clears prior geometries without disposing them.

Scene/native chunks are deleted as soon as they leave radius + 1. This removes
the provider's useful completed-chunk cache and makes return trips regenerate
or rely on the small exact-request worker cache. Render and generation storage
have no explicit separate hot/warm budget. The existing `VanillaChunkRepository`
provides persistent modern chunk save/load through integrated worker filesystem
storage, but decoration drafts explicitly prohibit persistent worlds. This
change must preserve that gate rather than save previews as gameplay worlds.

## Measurement protocol

`packages/vanilla-worldgen/scripts/profile-streaming-browser.mjs` launches its
own disposable headless Chromium. Same seed, build, viewport and route for
stationary, walking, sprinting, return, A-B-A, flight and straight exploration.
Records animation-frame intervals, long tasks, section rebuilds, completed
chunk publication, generation RPC durations and heap readings where available.
Software GPU results are useful for comparing main-thread CPU costs but cannot
predict desktop GPU frame rates. Browser JS heap is not total tab/process RAM.
Worldgen outputs/order and existing parity fixtures remain the correctness gate.

## Implemented minimum improvement

Default-on: cooperative publication, lighting and section meshing, plus warm
terrain/native/render caches. The configured main-thread streaming allowance is
4 ms/frame, shared among stages with work. Gameplay/rendering run first. Jobs
yield within mapping, light seeding/flood traversal and block meshing; completed
section geometry replaces the old geometry atomically. GUI rendering never
inherits the private mesh job's tessellator. This is a cooperative allowance,
not a hard real-time deadline: geometry construction, one block's model and GPU
upload remain indivisible. Old geometries and cloned materials are disposed.

HOT remains the active chunk map. WARM has independently bounded native terrain,
decorated arrays and retained render representations. Returning can reattach an
existing mesh without generation. Terrain queries share per-coordinate in-flight
promises and refresh the LRU. Each cache belongs to one source instance with its
seed/dimension/settings; existing source/status compatibility validation still
gates worker preload. Warm prewarm sends a complete compatible dependency set
in one message (at most 49), avoiding partial-preload LRU churn. No source-feature
results are reused/reordered. Existing persistence is not replaced: drafts remain
read-only and unsaved, not survival-authoritative worlds.

Memory presets, selectable in Options:

Settings now starts with a Performance page: manual Hardware Profile
Low / Balanced / High / Custom, Render Distance, Streaming Budget (1–8 ms) and
Vanillith Memory. Low uses distance 2, AO off, 2 ms; Balanced distance 4, AO on,
4 ms; High distance 8, AO on, 6 ms. Matching cache presets apply immediately to
the active provider. Custom retains individual values; manual changes to preset
fields mark the profile Custom. Settings persist on closing the options screen;
older saved custom distances are preserved instead of forcibly applying a preset.
These are user-controlled starting points, not detected CPU/GPU ratings or FPS
guarantees. Experimental worldgen/priority flags are not enabled by presets.

| Preset | Native arrays | Warm render estimate | Terrain arrays |
| --- | ---: | ---: | ---: |
| Low | 64 MiB | 32 MiB | 32 MiB |
| Balanced (default) | 256 MiB | 128 MiB | 64 MiB |
| High | 768 MiB | 384 MiB | 128 MiB |

These are **additional cache budgets**, not a browser RAM cap. Active chunks,
worker WASM heaps, atlas/model data, pending jobs, JS object overhead and GPU
resources are outside them. Render accounting includes array slots and geometry
buffers, conservatively counts shared native buffers, and cannot precisely
measure engine/GPU allocation overhead. Eviction releases owned meshes; world
exit clears caches/jobs. High deliberately spends more RAM on revisit retention.

`world.chunkProvider.streamingSnapshot()` exposes queues and byte/cache counters;
`streamingMetrics.snapshot()` exposes bounded timing samples and cumulative
counts. Telemetry does not log every block or allocate an unbounded profile.

The five-tier position/velocity/view/idle scheduler is implemented as an **opt-in
prototype** (`settings.vanillithPriorityStreaming = true`, before world launch).
It guarantees a camera-independent 3×3 demand, considers cached/in-flight work,
reprioritizes between terrain batches without discarding computed terrain, and
gates idle work on frame CPU/mesh backlog. Its critical post-center batch retains
the complete eight-chunk near-field footprint. Wider grouping needs additional
canonical parity work, so it is NOT enabled by default. Current normal publication
never displays terrain-only chunks while waiting for decoration. The separate
terrain-only spectator test remains available.

## Same-build browser results

Raw summarized measurements: [vanillith-streaming-measurements.json](vanillith-streaming-measurements.json).
Four sequential runs, seed `6888349110149677383`, Chromium 151, 960×640,
SwiftShader software GPU. Stationary route 20 s; other routes 6 s each. No test
suite/build ran concurrently. This is one run per variant, not a statistically
controlled multi-run confidence interval. Headless/software GPU CPU contention
is severe; these numbers do NOT imply desktop GPU FPS or a 60 FPS guarantee.

All frame values below are milliseconds. Each cell is **median / p95 / p99 /
maximum**. Baseline disables new budget/cache/priority flags on this build; it
retains the shared terrain reuse and quart-biome improvements already present.

| Route | Baseline | Budget only | Budget + cache (chosen) | Priority prototype |
| --- | --- | --- | --- | --- |
| Stationary | 83.3 / 100 / 299.9 / 1116.7 | 66.7 / 83.4 / 99.9 / 183.4 | 50.1 / 66.7 / 83.4 / 183.4 | 66.6 / 83.3 / 100 / 166.6 |
| Walking | 66.7 / 100 / 116.7 / 150 | 50 / 66.7 / 83.3 / 116.7 | 33.4 / 50.1 / 66.8 / 83.4 | 33.4 / 66.7 / 66.8 / 100 |
| Sprinting | 49.9 / 83.3 / 100 / 233.3 | 49.9 / 50.1 / 66.6 / 66.6 | 33.3 / 50 / 50.1 / 66.6 | 33.3 / 50.1 / 66.7 / 83.4 |
| Turn / return | 66.7 / 166.7 / 250 / 766.5 | 66.7 / 116.6 / 116.7 / 149.9 | 83.3 / 133.3 / 133.4 / 166.7 | 83.3 / 100 / 100 / 116.7 |
| A → B → A | 66.6 / 166.7 / 250 / 666.7 | 33.4 / 83.3 / 83.4 / 100 | 50 / 100 / 116.7 / 116.7 | 50 / 100 / 100 / 116.6 |
| Fast flight | 33.4 / 83.4 / 100 / 116.6 | 33.4 / 50 / 83.3 / 100 | 33.3 / 83.2 / 83.4 / 100 | 33.3 / 66.7 / 83.4 / 133.4 |
| Straight exploration | 33.4 / 100 / 133.2 / 133.4 | 33.3 / 50 / 50 / 66.6 | 33.3 / 33.4 / 50 / 66.7 | 33.3 / 33.4 / 33.5 / 50 |

Frame threshold counts (baseline → chosen), expressed as >16.7 / >33.3 / >50 ms
and total frames; unequal counts reflect improved delivered-frame count, so
compare rates rather than raw counts alone:

| Route | Baseline counts / total | Chosen counts / total |
| --- | --- | --- |
| Stationary | 223 / 223 / 223; 223 | 347 / 337 / 193; 347 |
| Walking | 82 / 82 / 69; 83 | 141 / 121 / 13; 144 |
| Sprinting | 123 / 116 / 28; 125 | 166 / 124 / 4; 172 |
| Turn / return | 63 / 63 / 48; 63 | 71 / 70 / 67; 71 |
| A → B → A | 73 / 67 / 42; 74 | 102 / 94 / 49; 103 |
| Flight | 130 / 120 / 26; 131 | 137 / 114 / 27; 158 |
| Exploration | 125 / 119 / 27; 125 | 161 / 130 / 2; 201 |

Stationary worst spike fell **1116.7 → 183.4 ms (~84%)**; A-B-A worst spike
**666.7 → 116.7 ms (~82.5%)**. Turn-return median regressed, although tail spikes
improved: retained content is rendered instead of an empty unloaded world. This
is not a universal FPS improvement.

| Metric | Baseline | Budget only | Budget + cache | Priority prototype |
| --- | ---: | ---: | ---: | ---: |
| First decorated native chunk published | 20.83 s | 18.51 s | 16.98 s | 16.89 s |
| Initial nine native publications | 39.46 s | 42.36 s | 37.28 s | 38.17 s |
| Peak summed browser-process PSS | 1539.8 MiB | 1392.8 MiB | 1588.4 MiB | 1387.8 MiB |

Publication readiness is **not** completion of every mesh/GPU upload in the
column. The measured cold times include boot, atlas preparation and worker
contention, so they cannot be compared directly to the earlier Node generation-
only 4.77/10.33 s figures. Budget-only delayed initial nine completion by ~2.9 s;
cache recovered that tradeoff. Cold decoration is still seconds, not instant.

Baseline synchronous native publication median/max was 26.9/45.5 ms; light
flood calls reached 134.9 ms despite their nominal outer time allowance. Chosen
publication slices max 8.3 ms, light slices max 3.8 ms, mesh slices max 9.5 ms;
total streaming work per frame p95/p99/max 4.9/6.2/11.4 ms. Incomplete slices keep
their traversal state rather than restarting work. GPU upload and persistent
water batching/sorting remain outside this budget and are next render-path
candidates, not assumed fixed here.

Chosen run restored 18 warm meshes, median 0.1 ms / max 0.2 ms reattachment CPU
time. This excludes queue waiting and the next actual draw. A-B-A regression test
also verifies object identity and zero extra generation on the return leg.
The run ended with 17 warm render chunks (~55.4 MiB), 22 native chunks (~10.4
MiB) and 93 terrain entries (~44.0 MiB); main terrain cache 203 hits / 96 misses,
zero eviction in this short route. Dependency service hits 261; feature-source
executions 111. Baseline executed 67 sources but published less completed work,
so this is NOT evidence of a per-feature speedup. Jobs have only two workers;
no new source parallelism or density experiments were enabled.

PSS is sampled every 2 s via the disposable browser's own process IDs and sums
browser/renderer/GPU process proportional-set sizes. It includes workers but is
not exact GPU memory or a guaranteed captured peak. Browser heap figures alone
would underreport this workload.

## Correctness and remaining limits

Initial nine block, biome, heightmap and scheduled-fluid arrays hash-identically
between baseline, budget, cache and priority runs on the measured seed. The
chosen cache run also matches all 12 coordinates common with baseline. Mapping,
initial lighting, mesh vertex/index/UV/color arrays and light flood visit/write
order have exact synchronous-versus-sliced regression coverage. Near-field
priority footprint is checked across four camera directions. Existing terrain
preload context/status and decoration tests remain correctness gates.

Do not extrapolate this to universal request-history independence. The budget-
only moving run differs at two peripheral coordinates (`2,-1`, `2,1`) despite
matching the initial nine; live timing changes which missing chunks are grouped
into the existing region service. Wider priority grouping likewise lacks proof
across many seeds/turns. This pre-existing region-request dependence is why the
expanded scheduler remains OFF. Generator feature/RNG/source order within a
given request is unchanged, but canonical output independent of request history
still needs the separate canonical-job research. No claim of complete JAR parity
or final survival readiness is made.

Cache budgets are bounded; synthetic 2000-entry LRU stress verifies eviction.
The sustained browser run is recorded separately below. Visible empty boundaries
can still occur when travel outruns generation. Native cold latency and background
throughput are not solved by frame slicing. This phase improves the measured
main-thread tails/revisits without the speculative worker/worldgen rewrite.

### Sustained exploration stress

[Stress measurements](vanillith-streaming-stress.json): same cache configuration,
60 s straight flight at 8 m/s after the other six routes. Frame median/p95/p99/max
33.3 / 49.9 / 66.7 / 183.3 ms; >16.7 / >33.3 / >50 ms counts 1632 / 1283 / 35
out of 1893 frames. Browser peak PSS 1503.4 MiB, ending 1294.1 MiB; main terrain
cache ended at 135 entries / 63.81 MiB against 64 MiB, 79 evictions, 170 hits /
214 misses. Warm render 44.24 MiB, native 12.76 MiB; no runtime errors. Twenty
warm reattachments, median 0.1 ms / max 0.3 ms across the complete run.

**Throughput failure remains:** no active chunk was ready at the final moving
position (one decorated job still in flight). This test demonstrates bounded
terrain retention and reduced stalls, NOT adequate decoration throughput for
8 m/s sustained travel. Even normal travel can outrun the old small demand
window. Increasing queue radius alone does not make synchronous source execution
faster. Next justified work is canonical, cooperative region-job scheduling with
request-history parity tests, plus profiling persistent translucent sort/upload
cost. Do not enable the wider priority prototype simply to hide this failure.

Reproduction (point at a separate QA server, not a user browsing session):

```sh
STREAM_URL=http://127.0.0.1:8011 STREAM_VARIANT=baseline STREAM_STATIONARY_MS=20000 STREAM_REPORT=/tmp/stream-baseline.json node packages/vanilla-worldgen/scripts/profile-streaming-browser.mjs
STREAM_URL=http://127.0.0.1:8011 STREAM_VARIANT=cache STREAM_STATIONARY_MS=20000 STREAM_LONG_MS=60000 STREAM_REPORT=/tmp/stream-cache.json node packages/vanilla-worldgen/scripts/profile-streaming-browser.mjs
```

The harness needs Playwright/Chromium; `PLAYWRIGHT_MODULE` overrides its local
runtime module path. Existing memo/batch/cache-wrapper/canonical-progressive
experiments stay disabled. Density graph compilation and RNG/feature algorithms
are untouched.

## Verification

- Streaming/render/preview targeted regression run: **35/35 passed** (including
  12 streaming tests). No gameplay/mining/attack refactoring.
- Existing gameplay regression suite: **12/12 passed**.
- Full existing worldgen suite: **484/487 passed**. Three unrelated feature-test
  failures reproduce when only the ore/speleothem tests run, without importing
  the streaming scheduler: two `minecraft:scattered_ore` unsupported dispatch
  failures and one `minecraft:simple_random_selector` cave-fixture assertion.
  Their feature implementations were not changed here; they remain open, rather
  than silently skipping features or reporting a green full suite.
- Additional real-generation cache parity matrix: **1/1 passed**, 152.1 s;
  exercises identical center-
  then-eight-neighbor requests on seeds `1` and `6888349110149677383`; complete
  blocks, biomes, heightmaps and fluid-update arrays match for both. A third
  condition (`42`, center `-2,1`) hits an existing `leaf_litter` native survival
  gap in baseline; the matrix explicitly checks identical warm-path failure and
  unchanged caller terrain buffers, not decorated-output parity for that biome.
- Vite production bundling: passed, **423 modules**, 5.34 s. Built into an isolated
  `/tmp/vanillith-build-3jr0ae` directory with the fixed-destination resource-copy
  plugin omitted, preserving the user's existing `dist` and resource files.
  This confirms bundling, not an exported resource-packaging/deployment test.
- Scoped `git diff --check` and harness syntax check: passed. Browser routes and
  sustained stress reported no runtime errors.
