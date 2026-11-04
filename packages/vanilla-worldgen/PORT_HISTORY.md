# Vanillith worldgen: development notes

These are historical notes kept for the implementation details and earlier
measurements. They describe different points in development, so older status
statements may no longer apply. See [PORT_STATUS.md](PORT_STATUS.md) for the
current state.

This is an in-progress port. It does not generate playable chunks yet.
The game exposes a development choice in More World Options, with world
creation disabled for that choice. Direct client/server calls also reject it,
so an unavailable vanilla generator cannot silently create a flat world.

Reference: the user-supplied reference client JAR, world data version 5023. The
exact SHA-256 is pinned in source-lock.json. JAR code stays outside this repo;
Java oracle programs call the original classes at test time.

Implemented:

- Structure-template foundation: bounded gzip/NBT decoding (including exact
  signed longs and Java modified UTF), modern/legacy palette formats, multi-palette
  selection, static-full/partial/NBT Y/X/Z ordering, mirrored/pivoted rotations,
  zero-origin offsets and bounding boxes. The placement pipeline preserves
  processor-before-state-rotation, ordinary versus whole-piece clipping,
  barrier/NBT loading, container loot seeds, source-fluid restoration and the
  native voxel-face neighbor-update traversal/flags. Block geometry, per-state
  rotations, liquid-container behavior, entity loading/spawning and shape
  callbacks remain explicit world-adapter responsibilities, not guessed physics.
  Unsupported processor types fail rather than silently passing through.
  All 1,511 pinned-JAR templates were independently loaded by native
  StructureTemplate: 1,651 palettes and 1,234,749 ordered block/state/NBT-presence
  records have matching SHA-256 digests; sizes/entity counts and 1,725 palette
  states also resolve. This checks reading/order, not complete structure placement.
- Processor chains support all four types occurring in the 40 imported processor
  lists: block_rot, rule, protected_blocks and capped. Rule tests reuse the
  native block/state/tag/random/height/composite predicates and add float32 linear
  and axis-aligned position curves. Passthrough, clear, recursive static NBT
  merging and loot-tag modifiers are implemented. Rules use position-seeded LCG
  independently of placement RNG; capped draws use the world-seeded legacy
  positional factory, shuffle indices, and count only changed non-null outputs.
- Both fossil configs now run through the built-in executor: all eight skeletons,
  coal/diamond overlays, four rotations, ocean-floor scan, randomized burial,
  minimum-Y clamp, eight-corner rejection, chunk-relative 48-block clipping,
  protected terrain and update flag 260. The 180 new original-JAR cases compare
  ordered writes/properties, water/lava shape-update ticks and RNG continuation;
  they include every template, negative chunks, clipped heights, zero/full decay,
  constant/variable caps, random rules and axis-position predicates.
- Non-empty structure beardifier is now a WASM density node, not a zero stub.
  NONE/BURY/BEARD_THIN/BEARD_BOX/ENCAPSULATE, ground deltas, jigsaw junctions,
  affected-box clipping and ordered float32 accumulation match 222,180 native-JAR
  sample bits; 36 mirror/rotation/pivot transformations match independently.
  Density graphs validate and replace structure context atomically; diagnostic
  terrain sampling can request it per chunk with beardifierForChunk, avoiding
  leakage into later chunks. Structure-start collection/jigsaw planning is not
  implemented, and this has not enabled the playable vanilla generator.
- Reproducible import of every data/minecraft resource (9,883 entries), with
  SHA-256 per entry. Includes all 67 biome definitions, all dimensions, 273
  placed features, 52 structures, 245 template pools, templates, tags and loot.
- Feature resource registry resolves every imported placed feature to its
  configured feature and keeps its placement modifiers in source order. All 273
  placed-feature references validate against the 240 feature definitions.
- Added the reference simple-block feature placement primitive and block-state
  providers for fixed states, weighted choices, and randomized integer
  properties. Survival checks, double-plant callbacks, update flags and optional
  scheduled ticks follow the JAR call order.
- Added reference random, simple-random, weighted-random, and boolean selector
  configured features. Nested placed features share the parent RNG stream and
  recursively use the same placement pipeline; selector probabilities,
  bounded choices, weights and boolean draws follow the JAR call sequence.
- Added 16 more configured-feature execution paths: ore, scattered ore,
  single-block replacement, block columns, disks, block piles, forest-rock
  blobs, Nether replacement blobs, springs, vines, neighbor spread, top-layer
  snow/freezing, End islands, overlay, sequence and no-op. Their top-level types
  occur in 74 imported named configs; this count is not a claim that all nested
  children of those configs are supported (e.g. sculk patches).
- Added 12 more configured-feature types occurring in 19 imported named
  configs: bamboo, blue ice, Nether deltas, underwater magma, End arrival
  platforms, Void start platforms, brown/red huge mushrooms, ice spikes,
  lakes, root systems and fallen trees. Provider draws, replacement predicates,
  update flags, height gates and placement order follow the pinned JAR.
- Added seven more configured-feature types: single-block pillars, projected
  patchy squares, stepped column clusters, coral trees/claws, huge fungi and
  chorus plants. All 25 imported instances reach the executor; nine parent
  configs (basalt pillars/columns, warm-ocean vegetation, crimson/warped fungi
  and chorus) execute their complete nested pipelines in synthetic test worlds.
  This is feature execution coverage, not playable-chunk parity.
- Added the cave speleothem family: pointed dripstone/sulfur spikes, their
  clusters and large dripstone columns. All seven imported instances and five
  parent configs execute with real WASM RNG in synthetic cave worlds, including
  cinnabar replacement for sulfur. Shared floor/ceiling column scans preserve
  endpoint checks and up-before-down order; pointed growth retains default
  block states, base/middle/frustum/tip thicknesses, merged tips and fluid-based
  waterlogging.
- Clusters retain water-pool enclosure checks, floor adjustment, Gaussian
  height bias, density gates, inclusive overlap splits and unconditional merge
  boolean draws. Large columns retain uniform radius selection from provider
  metadata, embedding probes with radius halving, origin-relative wind offsets,
  height curves, lava boundaries and WORLD_SURFACE_WG stopping. Added the
  clamped-normal float provider with Java float rounding and integer-provider
  bounds used by the radius selector. Debug-only large-column rendering is not
  implemented.
- Added the complete iceberg feature path for both imported packed/blue-ice
  configs: generator sea-level anchoring, round/elliptical and rare tall shapes,
  float-rounded radius curves, snow caps, ordered above-water smoothing,
  submerged growth and air/water cut-outs. Java integer ceil normalization
  prevents JS negative-zero radii from producing invalid signed distances.
- Added active/inactive End podiums and return/delayed gateways, covering all
  four imported configs. Podiums preserve spherical distance tests, same-block
  replacement skips, destruction with drops, pillar order and facing torches.
  Known gateways query the actual gateway block-entity adapter after the center
  write and set their exit/exact flag before completing the frame; missing or
  wrong-type block entities are not assigned an exit. These are generation
  features, not a port of runtime portal teleportation or the dragon fight.
  Added the fill-layer primitive with minY-relative height, air-only replacement
  and X/Z write order. Block entity and destruction behavior requires explicit
  world callbacks; none is simulated by a silent fallback.
- Added five feature types covering six imported configs: amethyst geodes,
  glow lichen/sculk vein multiface growth, bonus chests, monster rooms and End
  spikes. All six named configs execute with real WASM RNG in synthetic worlds.
  Geodes retain distribution-point rejection, four density layers, optional
  cracks, safe flag-2 writes, protected blocks, neighboring fluid ticks and
  facing/waterlogged bud selection. Providers and explicit inner placements
  inherit the real block defaults before overriding supplied properties.
- Added the reference legacy-positional NormalNoise path to WASM, separate from
  legacy Nether FBM initialization. Geodes fork two legacy positional factories
  from the world seed, hash each octave name and use float-rounded samples;
  this does not consume their feature-placement RNG stream. Independent JAR
  samples cover legacy/normalized/unnormalized definitions, negative and
  positive octaves, zero amplitudes and wrapped coordinates with exact float
  bits across six seeds.
- Multiface growth retains support/collision face checks, source-water
  waterlogging, existing faces, shuffled search directions and the JAR's
  repeated origin-relative one-step search. Spread tries same-position,
  same-plane and wrap-around candidates in order, marks cells before flag-2
  writes and respects the actual write success result. Sculk vein spread also
  retains blocked sculk/catalyst/piston surfaces, wrap obstruction, replaceable
  plants and fire/fluid rejection. This is not sculk-patch charge propagation.
- Bonus chests shuffle chunk X and Z separately, use the motion-blocking
  heightmap, accept empty collision shapes and place only supported torches.
  Monster rooms retain floor/ceiling/door validation, descending-Y clearing,
  mossy floor draws, protected safe writes, existing containers, chest facing
  and the skeleton/zombie/zombie/spider selection. Actual loot containers get
  their table and seed only when the block entity is present; spawner setup is
  passed the shared random source for any existing spawn-data behavior.
- End spikes retain the world-seeded Java LCG cache key and ten-rank shuffle,
  chunk gates (including negative coordinates), pillar clearing, 73-cell
  guarded cages and connection properties. Crystal creation is gated by the
  actual entity adapter; beam target, invulnerability and float yaw precede
  entity insertion, bedrock and fire writes. Failed crystal creation does not
  consume yaw RNG or add a cap. Fire state and entity behavior are explicit
  world adapters, not fabricated terrain fallbacks. All ten seeded spike
  descriptors and Java LCG draw/rejection sequences are independently checked.
- Pillars retain continuation-before-height draws and final cap placement,
  including zero-block caps. Stepped columns keep singleton-Y RNG draws,
  Manhattan reach budgets and separate downward-surface/upward-air searches.
  Coral branches retain shuffled horizontal directions, turn counters,
  nested-placement failure behavior and the shared parent random stream.
- Huge fungi retain crimson/warped cap probabilities, rare wide stems,
  generator-depth rejection, planted-mode destruction calls, flag-260 origin
  clearing and flag-2 weeping-vine columns with randomized tip ages. Direct
  string states require actual default-state decoding to retain stem axes.
  Chorus plants refresh all six connection properties at every junction,
  enforce the root-relative branch limit and finish unbranched tips at age 5.
- Added random-block state providers with ordered holder/tag selection,
  actual default-state callbacks, null optional results and no-draw empty sets.
  Added cuboid, random-chance and randomly-selected placement modifiers, biased
  height sampling and inclusive height predicates with relative-to-sea-level
  anchors. Modifier coverage includes nested configs, not only named placements.
- Lakes retain their ellipsoid union, six-neighbor barrier validation, protected
  cavity/barrier predicates, immediate cave-air block ticks and two-block
  post-processing scan. Water freezing calls the explicit biome adapter for
  every surface cell; solid/liquid, fluid-tag and tick APIs are mandatory when
  their branches execute. Underwater magma requires actual face-occlusion
  callbacks, rather than treating every non-air block as a full cube.
- Root systems retain the JAR's vertical water limit, optional horizontal level
  probes, heightmap stop, nested tree placement without a top-level biome check,
  rooted-dirt attempts and hanging-root support checks. Fallen trees retain
  stump-before-direction draws, sideways log axes, six-step ground search,
  maximum two-block unsupported gaps, post-processing and decorators. Added
  `attached_to_logs` with shuffled log order and inclusive probability checks.
  The fallen-log set follows Java Vec3i hashing before stable height sorting.
  Original-JAR checks also caught and fixed a missing vine `up=false` property
  and the horizontal shelf-mushroom decorator's neighbor callback arguments.
- Ore ellipsoid sampling/culling, visit deduplication, exposure rejection and
  raw section writes follow the JAR. Bulk ore requires explicit writable-section
  and section-write adapters and never substitutes normal world block updates.
  These feature adapters use an exclusive `context.maxY`, matching the package's
  dimension ranges; the JAR's inclusive maximum is `maxY - 1`.
- Added offset/composite/block/tag/fluid predicates with strict environment
  adapters, nested height/tag ore rule tests, rotated providers, and optional
  rule-based providers. Disk placement preserves null-provider run markers;
  tree soil and ground decorators can now use the imported optional providers
  without a custom sampling override. Snow/ice biome decisions, fluid ticks,
  vine attachment and post-processing still require caller-supplied world APIs.
- A separate original-JAR feature oracle verifies 1,246 feature/seed cases against
  the JS executor driven by WASM RNG: success values, ordered state/property
  writes, update flags, destruction calls, gateway-exit assignments and their
  position in the write sequence, scheduled block/fluid ticks, post-processing marks and
  the next RNG long all match.
  Cases include blocked ore writes, both block-column truncation policies,
  bamboo obstruction, lake protection/validation and water/lava paths, elevated
  ice spikes, root water/level/height rejection, decorated fallen logs and gaps.
  New cases cover pillar caps, optional-empty patch providers, raised/blocked
  column surfaces, coral failures, planted/rare-wide fungus growth, chorus
  obstruction, random blocks, cuboid face/shell order and biased height gates.
  The 162 new cave cases cover both support directions, submerged/sulfur tips,
  wet/dry clusters, overlapping tip merges, open/blocked/shallow columns,
  lava floors, large-column radius shrink, wind and heightmap stops.
  Another 148 cases cover icebergs in ocean/frozen/dry/obstructed worlds, floating
  snow and cave air, two rare tall-berg seeds, active/inactive/existing podiums,
  known/delayed/missing/wrong-type gateway entities and air/mixed/blocked layers.
  Another 318 cases cover geode rejection/protection/cracks, water/lava ticks,
  flooded bud waterlogging, weighted providers, custom layers and shifted origins; multiface
  support/water/search/wrap and sculk plant/fire cases; blocked/missing/uneven
  bonus chests, rejected/protected/preexisting dungeons and default/custom/
  guarded/missing/negative/multiple End spikes. Ordered container loot seeds,
  spawner IDs and crystal attributes/placement relative to block writes match
  the original JAR, alongside the independent legacy/noise/spike checks.
  These are synthetic placement worlds, not complete vanilla chunk comparisons.
- Added standard reference floor/ceiling vegetation patches: surface scans, edge
  columns, replaceable-tag checks, depth/extra-bottom draws and vegetation
  chances follow the JAR order. The caller supplies block/tag/face checks; the
  ground and nested vegetation features share the patch RNG. Java HashSet
  position iteration order is reproduced for the patch's placement set.
- Added the reference waterlogged vegetation-patch override: enclosed positions are
  filtered in vanilla face-check order, filled with water, passed to nested
  vegetation at the adjusted position, and successful waterloggable states are
  updated with the JAR's flag and ordering behavior.
- Added the reference straight-trunk height and placement primitive, including its
  two bounded height draws, optional below-trunk state, replaceable-position
  checks, update flags, and foliage attachment.
- Added the reference forking, bending, giant 2×2, and upwards-branching trunk
  placers, including attachment positions, branch/tag checks, optional soil
  provider draws, and trunk write order.
- Added the reference dark-oak 2×2 trunk and perimeter branches, plus mega-jungle
  giant trunk roots and foliage attachments. Three-layer feature clearance now
  follows its lower/middle/upper height bands from the pinned JAR.
- Added fancy-oak trunk generation: branch candidate sampling, clearance probes,
  limb voxel stepping, axis-oriented log states, trimmed foliage attachments and
  the corresponding fancy-oak configured-tree dispatch follow the reference JAR.
- Added the reference mangrove root placer: sampled trunk offset, vertical clearance,
  four ordered root simulations, width/length limits, skew draws, muddy-root
  replacement, waterlogging and optional above-root providers. Imported mangrove
  trees place roots before their trunk; root tag checks remain explicit caller
  adapters.
- Added cherry branch placement with JAR-ordered branch-count/start/end draws,
  horizontal log axes and canopy attachments; added Poplar's per-layer shuffled
  direction draws and configured branch layer. Cherry foliage builds its tiered
  crown, wide-bottom/corner holes and hanging extensions. Poplar foliage uses its
  layered rhombus and side-hole draws, and only replaces a leaf when the current
  block exactly matches a newly sampled foliage-provider state.
- Added the reference `blob_foliage_placer` canopy primitive: configured height/radius,
  per-attachment offset, row-radius curve, double-trunk bounds, leaf checks and
  corner random draws follow the JAR.
- Added acacia, bush, cherry, Poplar, fancy, mega-jungle, mega-pine, pine,
  random-spread and spruce foliage placers with their distinct layer shapes and
  RandomSource draw order. Mega-pine crown height/radius rows and parity-based
  crown expansion match the reference JAR. Imported acacia, jungle bush, fancy oak,
  mega pine/spruce, pine, spruce and azalea configurations now connect to the
  configured-tree path.
- Connected imported supported tree data, including the two-layer clearance
  scan, into configured-feature placement. Block tags, vine checks, world bounds,
  optional provider predicates, mangrove root tags and fluid checks are strict
  caller adapters; unimplemented root, trunk and feature-size types still fail
  closed.
- Added the reference beehive tree decorator: its probability, log-height selection,
  south-facing clearance, candidate shuffle and stored bee ages follow the JAR.
  Added `place_on_ground` attempts using the lowest foliage-layer bounds, ordered
  inclusive position draws, air/vine and replaceability checks, the
  motion-blocking-no-leaves heightmap, and the configured state provider.
- Added reference `trunk_vine` and `leave_vine` decorators: trunk side draws use the
  JAR's west/east/north/south order, while leaf sides use four independent
  probability draws and hang at most four vine blocks downward. Vine states and
  block writes are resolved through caller adapters.
- Added the remaining imported tree decorators: cocoa, shelf mushrooms, ground
  alteration, leaf-attached providers, pale-moss patch/hangers, and creaking
  hearts. Probability checks, candidate ordering, provider draws, exclusion
  volumes and six-neighbor log checks follow their reference decorator flows.
- Added the placed-feature execution path for every modifier type found in the
  pinned JAR: modifier chains preserve its depth-first position order and share
  one RNG stream. Count, rarity, square spread, height providers/maps, offsets,
  biome and block predicates, surface filters, environment scans, noise counts,
  count-on-every-layer, fixed positions, cuboids and random modifier selection
  are covered. World/block predicates,
  biome membership, heightmaps, and biome-info noise are strict caller adapters.
- Connected real imported `flower_default` data through rarity/spread/height,
  biome and block-predicate filters, the weighted block-state provider, survival
  check, and block writes. Integer weighted/clamped/trapezoid/clamped-normal
  providers and trapezoid height sampling are available; WASM RNG now exposes
  the JAR's cached Marsaglia-polar Gaussian sequence.
- Added reference biome decoration scheduling: feature order is topologically sorted
  per generation step with the JAR's stable encounter indices, the 3×3 chunk
  neighborhood's biome palettes are unioned, and decoration/feature seeds use
  the JAR's signed 64-bit formulas. `placeWithBiomeCheck` is wired through a
  caller-supplied block-biome lookup. The sorter covers all 67 bundled biomes;
  only the existing configured-feature algorithms can actually place blocks.
- Rust → WASM build without third-party Rust dependencies.
- Xoroshiro128++ seed upgrade, unsigned bounded-int rejection and nextDouble.
- Positional RNG factories: coordinate hashes with Java int/long overflow,
  fork ordering, fromSeed and UTF-8/MD5 name seeds (including multi-block input).
- reference GradientNoise/PerlinNoise and SmearedPerlinNoise sampling. Fractional
  coordinates and interpolation follow the JAR's float32 arithmetic.
- NormalNoise octave construction and float32 NoiseStack sampling, including
  enabled, disabled and legacy normalization. Paired octave seeds, amplitude
  modifiers and layer order match the JAR. No third-party Rust dependencies.
- Named noise registry: world seed → positional factory → resource-name seed
  → normal noise. Instances are cached without depending on lookup order.
- WASM scalar density graph with named references, per-sample memoization,
  shifted 3D noise, arithmetic, clamped gradients, clamps, lerp, nested cubic
  splines, negative scaling, square/cube, squeeze, range/interval selection,
  and exact cell interpolation. Fresh-world blend density is an identity and
  an empty structure beardifier is zero; nonempty adaptation is implemented
  but needs collected structure pieces/junctions. Old/new chunk blending is
  still missing.
- Coordinate-to-climate and biome sampling for Overworld, Large Biomes,
  Amplified and Nether. Block coordinates and quart-biome coordinates have
  separate entry points. Nether uses the JAR's legacy 48-bit RNG, skipped
  octaves, stack ordering, and seed+1 vegetation initialization.
- BlendedNoise with all 40 smeared Perlin layers and the JAR's modern/legacy
  initialization. Base terrain noise for Overworld, Nether and End; Overworld
  sloped_cheese, factor and jaggedness for normal/large/amplified settings.
- Export of the JAR's complete Overworld/Nether climate trees, retaining node
  order. WASM tree search retains last-result tie behavior and 64-bit distance.
- Independent Java/WASM comparisons: 2,860 RNG/noise results, 45,564 Overworld
  climate queries (56 biomes/7,594 parameter entries), 30 Nether queries.
- Another 37,611 positional/normal-noise comparisons against the original JAR:
  all 64 bundled noise definitions, nine normalization/zero-octave fixtures,
  seven 64-bit seeds, 37 sample coordinates per noise, and named-seed sampling.
  The JS registry is also checked against every named-noise sample.
- Actual JAR RandomState/DensityFunctionCompiler/Climate.Sampler comparisons:
  58,128 climate values match float32 bits and 9,688 coordinate-to-biome results
  match across four settings and seven seeds. Another 1,911 operator/spline
  boundary values and 43,596 final-density/base-terrain/sloped-cheese/factor/
  jaggedness values match bits. Final density includes caves for Overworld,
  Large Biomes, Amplified and Nether; End base noise is covered separately.
  These are sampled parity tests, not proof of complete world-generation
  equivalence.
- JS runtime with signed 64-bit seeds, independent handles and disposal.
- A separate chunk transport contract with signed minY, 32-bit block-state
  IDs, 3D quarter-resolution biomes and transferable buffers.
- WASM density volume sampling follows JAR block-step interpolation, including
  float32 incremental Y filling and negative or unaligned origins. All
  1,572,864 values in 16 complete 16×384×16 volumes match JAR bits across
  Overworld, Large Biomes, Amplified and Nether, two seeds and two origins.
- A diagnostic density terrain sampler converts volumes into caller-supplied
  solid/air state IDs, exclusive heightmaps and 3D biome IDs. This is dry base
  terrain only; the noise terrain sampler additionally fills fluids.
- `find_top_surface` follows the JAR's float32 upper-bound snapping and
  descending cell search. Aquifer surface queries snap X/Z to quart positions.
- WASM noise aquifers for Overworld/Large Biomes/Amplified: positional cell
  centers, nearest-four tie ordering, floodedness/exclusion, randomized fluid
  levels, lava noise, pressure walls and fluid update flags. Nether uses the
  JAR's disabled-aquifer global lava picker. Caller-supplied block/biome IDs
  are converted to chunk buffers with fluid post-processing markers.
- Another 1,572,864 chunk samples match the JAR's aquifer block results and
  update flags across four settings, two seeds and two origins. The fixtures
  exercise 15 pressure walls and 495 fluid-update flags. Noise terrain block
  buffers also match across the three Overworld presets and Nether.
- Initial material-rule execution layer resolves vanilla rule/condition JSON
  references and evaluates the JAR's sequence, condition, and block control
  flow. Context-dependent predicates and special rules are explicit adapters;
  unsupported rules fail closed instead of guessing. Unit tests cover
  reference resolution, fallthrough, state mapping, and failure behavior.
- Ported the common reference material predicates from their JAR bytecode:
  above-preliminary-surface, biome, hole, noise-threshold, steep, stone-depth,
  temperature, vertical-gradient, water, and y-above. The predicates consume
  explicit per-block context; biome temperature and vertical-gradient
  randomness remain supplied by the generation adapter. The temperature
  predicate calls the adapter with block coordinates and sea level, matching
  `Biome.coldEnoughToSnow(pos, seaLevel)` in the JAR.
- Added the material surface noise/context adapter: JAR-named surface noises,
  per-position surface-depth jitter, secondary noise, preliminary-surface
  minimum level, vertical-anchor resolution, arbitrary 2D/3D noise predicates,
  and name-scoped positional random for vertical gradients. Tests verify its
  stream construction against the same named noise and positional RNG APIs
  already compared bit-for-bit with the JAR.
- Added a block-column material-rule pass: scans top-down, resets depth at air,
  records the first fluid surface, computes JAR-style neighboring heightmap
  gradients, and applies evaluator results only to non-fluid solid states.
  Synthetic chunk fixtures cover floor depth, water height, and chunk-edge
  gradients. The noise terrain sampler can now opt into the pass, compiling
  the chunk-surface and ore-vein density roots and supplying block biomes,
  temperature, fluid, noise, and positional-random context. It requires a
  caller-provided vanilla block-state map and remains a diagnostic sampler,
  not the integrated game's default world generator.
- Ported the JAR's ore-vein decision flow: vein-density gate, positional
  richness/raw-ore draws, filler-gap gate, and ore/raw/filler block selection.
  Overworld terrain samplers now expose the vanilla copper/iron vein density,
  richness, and gap functions. The missing density `negate` primitive was added
  and verified as part of 2,002 density/operator comparisons against the JAR.
- Ported Badlands' `bandlands` rule: the 192-state terracotta palette follows
  the JAR's named `clay_bands` random stream and generation order, while each
  block uses `clay_bands_offset` noise to select its Y band. Determinism and
  palette membership are tested across samplers for the same seed.
- Added biome temperature sampling from reference biome JSON: legacy-seeded simplex
  noise, frozen-biome's three-layer noise stack, frozen modifier, the sea-level
  +17 height threshold, float-rounded lapse, and `< 0.15` snow predicate.
  Material contexts now provide this predicate from their sampled biome and
  sea level; reference values were checked against the JAR.
- Added reusable carver configuration samplers for uniform and (very) biased
  integer providers, uniform/trapezoid float providers, and uniform height
  providers with absolute, bottom/top, and sea-level anchors. The very-biased
  provider's three nested random draws and Java float rounding follow reference
  bytecode; WASM random sources now expose the matching `nextFloat()` primitive.
- Added the reference cave tunnel traversal primitive: thread-local legacy random,
  float-rounded yaw/pitch drift, tunnel radius, early reach culling, split
  branches, floor skipping, and chunk ellipsoid mutation.
- Added configured cave entry-point sampling from the imported reference resources:
  inclusive start probability, attempt count, origin-chunk coordinates, Y
  provider, radius/floor providers, optional room and extra tunnel branches,
  weird-thickness bias, and seeded tunnel starts. It mutates only the supplied
  target chunk through a caller callback; the carver RNG stream and generation
  stage are still supplied externally, so this is not yet pipeline-integrated.
- Added the reference canyon path: smooth per-Y width factors, per-step horizontal
  radius and vertical shaping, vertical rotation/drift, random carving skips,
  reach culling, and the configured canyon providers. Like cave carving, this
  mutates a supplied chunk only and is not connected to the generation stage.
- Added the biome carver scheduling pass: it scans the JAR's 17×17 origin
  neighborhood in X/Z order, looks up each origin biome at quart Y=0, preserves
  that biome's carver list order, and seeds each entry with the reference
  large-feature legacy RNG (`world seed + list index`, then origin chunk).
  Biome/config resolution and block mutation are callbacks so this remains
  independent of the incomplete game chunk pipeline.
- Added the JAR-shaped `CarvingMask`: packed bit storage, X/Z/Y index layout,
  contiguous vertical-segment visiting, normal/upgrading world-height bounds,
  and a `CarverOutput` view that clips cave/canyon ellipsoids to the mask's
  vertical interval instead of the full chunk. The mask application pass now
  follows the reference client's order for blend filtering,
  uncarvable blocks, aquifer null results, fluid post-processing markers, and
  grass/mycelium top-material repair. Registry tags, aquifer and surface rules
  remain explicit callbacks rather than guessed block IDs.
- Added an end-to-end package-level carver pass that resolves biome carver IDs
  and configured-carver JSON from the imported JAR resource map, creates the
  target mask/output, runs the scheduled origin chunks, then applies the mask.
  Resource lookup is cached by imported data object. Block tags, Aquifer,
  surface repair, and biome sampling stay explicit integration adapters.
- Added the reference End biome-source selector: center-island section radius,
  section-center erosion sampling, quart-Y conversion, and all four outer-island
  erosion thresholds.
- Added seeded End island simplex sampling, the `end_outer_islands`,
  `distance_to_point` and `slice` density nodes, and compiled the vanilla
  `end/islands` JSON graph. The End biome source can now consume this graph.
  A Java oracle compares sampler, height and complete end/islands graph float
  outputs bit-for-bit. End final-density sampling is also compared through the
  JAR's RandomState over the same broad coordinate/seed fixture set. End chunk
  density volumes now produce diagnostic 16×128×16 chunk buffers with End
  biome IDs and no aquifer pass; 131,072 full-chunk values match JAR bits.
  Game chunk-generation connection remains pending.
- Added a strict, standalone adapter from the package's 32-bit vanilla block
  states to the legacy server's 8-bit block-ID column. It preserves the
  server's Y/Z/X indexing, pads a 0..127 End chunk with air to 256 blocks, and
  rejects unmapped states or unsupported vertical ranges. This does not guess
  the vanilla-to-Breakmine registry mapping, retain modern state properties or
  biome data, or connect the adapter to live worlds.
- Added an explicit name-based bridge for exact matches in the current legacy
  block registry. Unsupported names such as deepslate and end_stone stay
  unmapped and therefore fail conversion if encountered; state properties are
  not represented by the legacy block-ID format.
- The JAR verifier now enumerates the actual reference `Block.BLOCK_STATE_REGISTRY`
  after bootstrap and writes each numeric state ID with its registry block name
  to ignored `generated/block-states.json`. The output is tied to the pinned JAR
  hash and can feed the strict legacy adapter; it does not imply full block or
  property compatibility.
- The verifier also records the 77 supported state IDs (17 vanilla block names)
  as `reference/legacy-block-state-map.json`, with the pinned JAR hash. Tests
  assert the exported registry size and mapping provenance. This partial table
  is not enough for complete Overworld, Nether, or End terrain.
- That bridge now retains the legacy 4-bit metadata in a packed `Uint16Array`
  adapter matching the server's existing block-state packet/store format. JAR
  fluid `level` variants and oak-log `axis` are converted explicitly; other
  mapped states use metadata zero. The old ID-only adapter remains available.
- Added a client-worker chunk-result adapter with the game's 16-section result
  shape, section mask, split block/data buffers and heightmap indexing. It
  supports only Y ranges representable by the current 0..255 game world and
  emits no light values; game lighting must still run afterward.

Not implemented or connected yet:

- Structure-start/jigsaw collection for beardifier and old/new chunk blending. Further
  density-volume optimization and general legacy positional RNG remain.
  The seeded End biome source and End final-density graph are implemented
  diagnostically, but are not integrated into playable game chunks.
- Connection of terrain, carvers, surface rules, and biome-seeded feature
  scheduling to the integrated game chunk pipeline; production
  biome/Aquifer/surface-rule/block-tag and placement-context adapters are also
  missing. Built-in configured-feature executors cover simple blocks, selectors,
  vegetation patches, the imported trunk/foliage/decorator paths, ores and the
  terrain and environment features listed above. Sculk-patch charge propagation
  and other remaining feature algorithms are still
  missing. The placement executors are JS using WASM RNG, not complete WASM
  chunk generation. The optional material
  pass has not been connected to the integrated game's world-generation path;
  other material-system extensions may still be missing. Legacy positional aquifer
  RNG for custom legacy noise configurations is not implemented.
- Structures/jigsaw, cross-chunk generation stages,
  structure starts/references, blending and generation lighting.
- Complete registry block-state mapping, biome conversion, and game/server
  conversion to modern chunk storage and packets; save migration.
- Actual WASM chunk generation in the integrated server worker, dimension
  switching, seed/chunk comparisons against JAR-generated reference worlds.

Existing worlds and generators retain their current storage format. Importing
all biome JSON is not equivalent to implementing their world generation.

## Integrated worker chunk boundary

The game integrated worker now accepts `generateVanillaChunks` and
`releaseVanillaChunks` RPCs. `createVanillaChunkProvider(seed, settings)` in
`IntegratedServer.js` exposes an asynchronous modern chunk provider without
replacing the current world provider. Assets are fetched lazily in the worker;
Vite includes the WASM, climate, block registry and imported data in production.

The worker runs noise, aquifers, quart biome assignment and material rules for
Overworld/large biomes/amplified/Nether/End, returning explicit completed and
pending stages. Requests preserve signed 64-bit seeds, have a four-chunk limit,
and run serially. An eight-chunk LRU is discarded on seed/settings changes.
Transferred buffers are copies, so cached chunks cannot become detached.

`VanillaChunkStore` retains Uint32 modern states, Uint16 biomes, signed heightmaps
and fluid-update flags, including Overworld Y -64..319. Batch insertion validates
all chunks before mutation. Unloaded/out-of-range reads return undefined, not
air. Neither vertical clipping nor unknown-state substitutions are performed.

This is a generation/RPC/storage boundary, **not a playable world integration**.
The live World renderer, legacy server packets and saves still use the old
format. Carvers, decoration, structures and lighting are not yet scheduled by
this service, and the vanilla world selection remains disabled. Legacy saves
and normal/flat/amplified generation are unchanged.

Tests exercise the actual integrated.worker.js handler in a Node worker, using
a file-backed asset fetch shim (not a browser gameplay test), including queued
requests, errors, transferable buffers, seed/settings changes and disposal.

## Signed-height renderer boundary

World and game Chunk now carry per-world minY/maxY. Sections remain a compact
array, while getSection takes the signed world section coordinate; Overworld
uses 24 sections (-4..19). Section origins/bounds, block lookups, rebuilds,
dirty regions, skylight and flood bounds respect this range. Legacy worlds
still default to 16 sections and retain their original serialized shape.
Non-default game chunks include minY/height in their local serializer and
reject mismatched restore ranges and legacy chunk packets.

VanillaChunkProvider.createRenderChunk(world,x,z,stateMap) creates a read-only
game-render chunk from modern data using an explicit render-state map.
Unknown/unregistered mappings and non-air-to-air substitutions fail before
attachment. Original modern states/biomes/fluids remain authoritative and
serialize in the modern format. Block edits and legacy packets are rejected
until state-aware editing exists; light buffers remain mutable.

Tests invoke actual ChunkSection.rebuild at Y -64 and 319 with a recording
renderer (no GPU/browser visual claim), game save/restore, world lookups and
lighting. This does not enable a live playable vanilla world: comprehensive
modern block models, native server packets/saves and editing remain pending.

## Native packet and persistence boundary

The BMVC v1 codec stores signed chunk/range coordinates, unsigned 32-bit
states, unsigned 16-bit biomes, signed heightmaps and optional fluid flags.
It uses explicit little-endian reads/writes, exact length validation and an
FNV-1a corruption checksum (not authentication). Truncation, extra bytes,
bad counts and oversized payloads fail before use.

VanillaChunkRepository saves separate files below
worlds/<key>/vanilla_chunks_v1/<source-id>/<settings>/<seed>/.
Keys, ranges and coordinates are validated. Legacy world_data.bin is never
rewritten. Writes serialize, and failures reject; a multi-file batch is not
one atomic transaction. Node writes use a synced temporary file and rename;
browser writes await IndexedDB transaction completion (or localStorage).
The existing legacy fire-and-forget save behavior remains unchanged.

Integrated worker RPCs saveVanillaChunks/loadVanillaChunk expose this path.
createVanillaChunkProvider(seed,settings,{worldKey}) opts into saved-first
loading and persists generated chunks; without worldKey it remains transient.
Saved loads recover the pinned biome index table without regenerating terrain.

Custom play packet 0x4a carries this codec. The server send helper requires
vanillaChunkProtocol=1; the actual client parser/handler validates opt-in and
world range, then stores native chunks. Legacy 0x21 is unchanged. Normal
sessions still do not send these packets. Experimental negotiation/attachment
are described below; native block updates and comprehensive models remain pending.

Tests cover real filesystem reopening, corruption/failed writes, actual server
framing/client parsing/handler dispatch, and transaction completion/abort via
a browser-storage mock. Integrated worker persistence routing uses an in-memory
filesystem fixture. None of these are a browser multiplayer gameplay claim.

## Experimental session and automatic attachment

Explicit experimental sessions can exchange a pinned-source/range/settings
offer (server 0x4b) and acknowledgement (client 0x20). The server helper requires
experimentalVanillaChunks=true. The client requires allowExperimentalVanillaChunks=true
and an empty world; otherwise it declines or rejects switching a populated world.
Tokens prevent stale/replayed acknowledgements. Modern chunks are sent only after
acceptance. Automatic activation during normal login is deliberately not wired:
the legacy login still generates its legacy spawn chunks, and vanilla selection
remains disabled until full generation/block-model integration is available.

Accepted offers configure signed-height client sections and a local, pinned
77-state render map, never arbitrary server-supplied render IDs. Native packets
now go through ChunkProviderClient.loadVanillaChunk: validate/build first, then
replace the scene chunk, retain modern states/biomes/fluids, queue lighting and
dirty adjacent sections. Unknown render mappings leave the previous chunk intact.
Coordinate keys use x,z strings in modern mode, avoiding the old packed-key collisions.

Server 0x4c unloads native chunks. Replacement/unload/clear detach groups, dispose
section geometry, remove stale rebuild-queue entries and clear native cache.
Shared renderer materials are not disposed by this path. Legacy chunk packets
are rejected in a negotiated modern world. Native chunks remain read-only;
dimension renegotiation within an existing session is not supported yet.

Tests exercise offer/ACK through actual framing/parsing/server dispatch, automatic
scene attachment, safe replacement failure, native unload/clear and legacy-client
decline, with headless THREE objects and a recording light hook. This is not GPU
or browser multiplayer visual verification, and the 77-state map does not cover
all blocks produced by a modern Overworld.

## Experimental terrain cube assets

`worldgen:import-render -- /path/to/reference-client.jar` extracts the
pinned JAR's terrain default-state models and original PNG bytes. The current
manifest contains 49 terrain default states and 62 textures, with per-face mappings
for column and top/bottom models plus grass layers and powder-snow shells. Model parent, blockstate and PNG hashes are
retained and checked directly against the source JAR in tests.

Experimental client offers prepare a separate namespaced atlas layer before
acceptance. Native cube IDs use free slots in 2048–4095 without overwriting
classic blocks, creative entries or texture names. Decoding, capacity and
world-change failures decline the offer. Atlas reload restores native textures
before chunk rebuilding. Headless protocol tests retain the base mapping path.

The Vanillith preview no longer uses the legacy state map: remaining simple
blocks and directional logs use native JAR models, while water/lava use pinned
JAR still frames and biome water tint. Fluid surface geometry and frame animation
are not yet native-exact; this is not complete model parity.
Grass uses the JAR's base faces and four coplanar alpha-cutout overlays. Tint
reads the native quart biome cell, pinned biome temperature/downfall and exact
JAR grass colormap, including explicit biome grass-color overrides. This does
not implement vanilla biome zoom, radius blending or dark-forest/swamp modifiers;
modifier biomes currently use the base colormap, not the final vanilla tint.
Powder snow uses the JAR's six thin elements, twelve inward/outward faces,
mirrored inner UVs and cullface ownership; it is not a solid snow cube. Native
render models accept explicit UV rectangles without changing legacy UV cropping.
Powder snow has no full-cube collision in this adapter, but leather-boot,
entity-dependent collision, sinking, freezing and other native gameplay rules
are not ported. Snowy grass state variants remain outside this default-state batch.
Weighted/mirrored model selection and UV rotations are pending. Ice uses the
client translucent pass and an adapted opacity, not a complete native property
or lighting port. Native chunks remain read-only. Live vanilla login/generation,
remaining generation stages and full vanilla GPU parity are still pending.

## In-game terrain test

### Decoration integration batch

`decoration-region.mjs` now connects feature reads/writes to native VanillaChunk
buffers, using exact registry state IDs/properties, floor-based negative chunk
coordinates and native quart-biome palettes. Missing neighbors/states fail
explicitly. Chunk-wide synchronous transactions roll back blocks and queued
ticks on feature failure; committed writes update the adapter's exclusive
world-surface heightmap. Placement heightmaps require explicit native predicates
and are scanned from current blocks rather than reusing the surface cache.

`chunk-decoration.mjs` connects this region to the existing biome feature sorter,
decoration/feature seeds and configured-feature dispatcher. Tests use the WASM
random kernel and the imported JAR oak feature to place actual native trunk and
foliage states across chunk borders, repeat deterministically, and check rollback.
This is integration coverage, not a Java-oracle comparison of decorated chunks.
Tests supply limited block rules; those are not production vanilla rule ports.

The preview still does NOT run decoration. Production native survival/tag/fluid
rules, vanilla block-biome lookup (rather than raw quart lookup), possible-biome
registry ordering, staged neighbor generation/publication, tick post-processing,
and render coverage for decoration states remain required. Feature orchestration
is currently JS around the WASM kernel, not a fully WASM-ported feature system.

The next batch adds exact bundled block-tag resolution (all 300 definitions),
including recursive tags, optional entries, deduplication and cycle/missing-entry
errors. `native-tree-rules.mjs` adapts TreeFeature's air/leaves/replaceable/vine
predicates and TrunkPlacer's log-inclusive clearance predicate from the pinned
JAR bytecode. WORLD_SURFACE[_WG] uses the non-air predicate. Leaf waterlogging
tests source water, not all flowing water; generic survival and motion-blocking
heightmap rules still throw as unported. A region-bound rule factory removes
the oak integration test's permissive tree-position stubs.

Render import also emits `generated/decoration-render.json`: nine vertical log
models and eleven leaf models, sharing one runtime render block per model across
native leaf properties. The additional 29 PNG textures and foliage colormap are
original pinned-JAR assets. Spruce/birch constants match BlockColors bytecode;
other tinted leaves use foliage colors, not grass colors. Cutout faces keep
neighbor geometry visible and do not turn leaves into non-collidable plants.
Tests cover model registration/state aliases, six cutout faces, tint, JAR hashes,
atlas reload and actual decorated native chunk → game render-chunk conversion.

This still does not enable automatic biome decoration in the preview. Horizontal
log rotations, foliage biome zoom/blending, native leaf-lighting parity, neighbor
stage ordering and publication, leaf-distance post-processing, generic survival,
and the other feature context adapters remain incomplete. The render test is
headless; no claim of browser/GPU visual parity is made for trees yet.

The worker generation service now accepts opt-in `mode: 'decoration_draft'`.
It materializes an isolated 5×5 surface-terrain region before decorating the
interior 3×3, so neighboring feature writes can reach the center chunk. All
reads/writes use cloned native buffers, never the reusable terrain cache.
Failure aborts the response; no partly decorated center is returned. Ordinary
`mode: 'terrain'` remains unchanged, and the regular client provider rejects
draft replies instead of storing or rendering them as stable world chunks.

Draft scheduling is deterministic local z-then-x ordering, NOT verified native
task order. Possible-biome order currently uses the imported sorted biome names,
NOT an oracle-verified native registry order. The draft response marks these
limits explicitly, keeps decoration in pendingStages, and stays non-playable.
Draft regions are independent and are not safe to stitch into a playable world
yet. Post-processing ticks are counted, not applied; leaf-distance propagation
is still pending. Tests cover neighbor preparation, incoming writes, immutable
terrain, aborts, transfers and the actual integrated worker's draft-error path.
Real vanilla drafts still stop at unported feature context adapters. No fake
tree sprinkling or skip-on-error behavior is used, and preview decoration is
still disabled until those adapters and stable publication are implemented.

Native context batch: `BlockRulesOracle` exports the pinned JAR's 35,723 state
facts and 1,286 exact block defaults. The import validates source SHA, coverage
and default-state IDs, then writes `generated/block-rules.json`. Worker assets
load these facts for solid/solid-render/replaceable/liquid predicates, fluid
identity, empty-fluid checks and source-water checks. They are not name-based
solid-block guesses. Generic level-dependent survival/collision shapes still
require separate ports.

The native Heightmap predicates now cover WORLD_SURFACE[_WG], OCEAN_FLOOR[_WG],
MOTION_BLOCKING and MOTION_BLOCKING_NO_LEAVES using the original block tags and
fluid facts. Dimension seaLevel comes from the selected noise settings and is
rebuilt on seed/dimension changes. Native default properties are merged for
configured state providers before exact state-ID lookup; explicit overrides
remain intact and invalid values fail. This fixes omitted redstone `lit=false`.

Decoration writes use the JAR FEATURES radius-one write zone, native section
buffers, transactional section setters and live per-column height caches.
Write/rollback invalidates height queries. Raw quart-biome lookup clamps Y like
ChunkAccess.getNoiseBiome (this still is NOT the full BiomeManager zoom port).
Feature failures now report placed-feature ID, step and index. Tests cover
native state facts, defaults, omitted properties, waterlogged/flowing water,
height predicates, negative-coordinate write zones and cache rollback.

Singleplayer → Create New World → More World Options → Generator: Vanillith.
Enter a seed (start with `1`), then choose Open Terrain Test. This bypasses saved
world creation and opens a local, read-only spectator preview. WASD flies,
Space ascends, Shift descends, and Escape opens Exit Terrain Test.

The loading screen waits for a fast terrain-only center chunk while generation
starts concurrently with atlas preparation. The decorated center replaces it
asynchronously; an independent terrain worker streams a 5×5 area around the
camera in four-chunk batches while the nearest 3×3 decoration drafts run in
the integrated worker. Distant scene/cache
entries. Cancel/Exit terminate the preview provider and discard its RAM cache.
Unknown states or generation failures stop loading and show an error instead
of silently generating classic terrain. Block edits, commands and autosaves
are disabled. No existing worlds or remote servers are changed.

Earlier browser checks confirmed seed 1 terrain rendering and exit/cancellation;
the staged 3×3 decoration preview has not had browser visual QA in this run.
This is terrain-pipeline testing, not a complete playable vanilla world:
carvers, decoration, structures, native lighting and full visual parity remain
unfinished. Automated tests cover loading order, deduplication, scene/cache
eviction, late-result cleanup, error handling and spectator/read-only behavior.

## Local commands

Feature render assets now include 597 native states and 111 source textures:
ore/stone cubes, plant cross models, kelp and directional glow-lichen planes.
Model parents, variants, multipart conditions, element rotations and UVs are
imported from the pinned JAR; animated textures currently use the first frame.
Native air/cave-air/void-air retain explicit air mappings. Seed 1's real draft
has complete state-map coverage; tests exercise feature states in render chunks
and emitted textured vertices. More World Options offers Decoration: Off/Draft
for Vanillith. Draft is RAM-only and streams a bounded 3×3 area, not a stitched
or saved world. Other biome features/render states may remain unsupported.
Browser visual QA was unavailable due to the browser tool's access policy;
native lighting, native ordering, post-processing and full visual parity are
not claimed. The standard render import also builds feature-render.json.

Decoration integration now records ProtoChunk-style post-processing offsets
(x | y << 4 | z << 8, local section coordinates). Duplicate marks are retained
as in the native short lists; failed transactions roll back marks with blocks
and ticks. Draft reports retain these records, but no neighbor-shape processing
or playable publication is claimed. VeryBiasedToBottomHeight uses the native
three nested inclusive draws. Short grass, fern and firefly bush survival uses
the imported supports_vegetation tag. A seed-1 draft at (0,0) now reaches
seagrass_deep and fails explicitly on unported tall_seagrass survival. The
terrain preview remains undecorated until the complete path is supported.

The public generator/menu/loading/HUD label is now Vanillith. Pinned source
versions, storage identifiers and validation checks still identify reference.
Native oracle facts now include upward sturdy support sampled with the empty
block getter and survival-method ownership for vegetation/double vegetation.
Seagrass, tall seagrass, kelp, sugar cane and ordinary vegetation/double plants
have separate survival paths; double plants write both halves transactionally.
Biome-info noise is wired to placement counts and omitted noise_offset defaults
to the native zero. Fluid-tag queries use imported fluid tag resources. Warm
biomes reject snow/freezing without invoking incomplete cold-biome adapters;
cold-biome light/collision dependencies still fail explicitly. Seed 1 at (0,0)
now proceeds into later neighbor decoration, stopping on glow_lichen's missing
isBlockSupportFaceFull adapter. This is not yet a decorated playable preview.

Support, collision and sturdy masks for all six faces are now imported from
the pinned JAR (empty block getter). The multiface adapter uses the separate
shape masks, and fluid readers now retain native id/empty/source flags. Seed 1
at (0,0) completes all nine neighborhood decoration stages; an automated real
WASM/native-data test verifies changed output and unchanged cached terrain.
The read-only provider can accept explicit RAM-only drafts and a fixed center
prevents stitching independently generated drafts. No decoration UI toggle is
enabled: the actual center still contains unmapped ore, seagrass and glow
lichen render states. Cold biomes, neighbor-shape processing, native feature
order and full visual verification remain unfinished.

Prerequisites: Rust with wasm32-unknown-unknown, Node, Java 25, the pinned JAR
and its launcher libraries. No accounts, credentials or network services are
needed by the oracle. The library directory is explicit; files are read only.

```sh
rustup target add wasm32-unknown-unknown
npm run worldgen:import -- /path/to/reference-client.jar
npm run worldgen:import-render -- /path/to/reference-client.jar
# The render import emits both terrain and decoration manifests.
npm run worldgen:build
npm run worldgen:verify -- /path/to/reference-client.jar /path/to/launcher/libraries
npm run worldgen:import-block-rules -- /path/to/reference-client.jar /path/to/launcher/libraries
npm run worldgen:verify-features -- /path/to/reference-client.jar /path/to/launcher/libraries
npm run worldgen:test
```

Generated data, WASM and Java class files are in generated/ and ignored by Git.
Run both verification commands after rebuilding. Climate tree data is written only after
all Java/WASM comparisons pass. Tests require import, build and verification.
The Java runner selects the newest locally installed version of each library;
incompatible or missing dependencies fail explicitly rather than substituting
handwritten Java reference algorithms.
