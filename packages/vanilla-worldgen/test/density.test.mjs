import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVanillaKernel } from '../runtime.mjs';
import { createClimateRouter } from '../density.mjs';
import { VanillaChunk, createDensityTerrainSampler, createNoiseTerrainSampler } from '../chunk.mjs';
import { applyMaterialRulesToChunk, createMaterialSurfaceSampler } from '../material-surface.mjs';
import { createNoiseRegistry } from '../noise-registry.mjs';
import { createMaterialRuleEvaluator } from '../material-rules.mjs';
import { createKernelEndBiomeSource } from '../end-biome-source.mjs';

const bytes = await readFile(new URL('../generated/worldgen.wasm', import.meta.url));
const climate = JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url)));
const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url)));
const kernel = () => createVanillaKernel(bytes, climate);

test('fluid terrain keeps dry generation explicit and respects Nether fluid levels', async () => {
    const k=await kernel();
    try {
        const preset=k.climate('nether');
        const biomeIds=Object.fromEntries(preset.biomes.map((name,i)=>[name,i]));
        preset.dispose();
        const options={settings:'nether',solidState:70000,airState:9,waterState:200,lavaState:300,biomeIds};
        assert.throws(()=>createNoiseTerrainSampler(k,0,data,{...options,lavaState:9}),/distinct/);
        const wet=createNoiseTerrainSampler(k,0,data,options);
        const dry=createDensityTerrainSampler(k,0,data,options);
        const chunk=wet.sampleChunk(-1,0);
        const baseline=dry.sampleChunk(-1,0);
        for (let y=0;y<chunk.height;y++) for (let z=0;z<16;z++) for (let x=0;x<16;x++) {
            const i=y*256+z*16+x;
            const expected=baseline.blocks[i]===70000 ? 70000 : y<32 ? 300 : 9;
            assert.equal(chunk.blocks[i],expected);
            assert.equal(chunk.fluidUpdates[i],0);
        }
        assert.ok(chunk.blocks.includes(9) && chunk.blocks.includes(70000));
        const picker=k.density(0,data,{empty:0});
        const selected=picker.sampleAquiferVolume('empty',0,-64,0,1,130,1,{seaLevel:63});
        assert.equal(selected[9],3);
        assert.equal(selected[10],2);
        assert.equal(selected[126],2);
        assert.equal(selected[127],1);
        picker.dispose();
        assert.equal(chunk.minY,0);
        assert.equal(chunk.height,128);
        assert.equal(chunk.serialize().fluidUpdates,chunk.fluidUpdates);
        wet.dispose(); dry.dispose();
        assert.throws(()=>wet.sampleChunk(0,0),/disposed/);
        assert.equal(k.capabilities.chunks,false);
    } finally { k.dispose(); }
});

test('density chunks retain JAR volume order, biome IDs and exclusive heightmaps', async () => {
    const k = await kernel();
    try {
        const preset = k.climate('overworld');
        const biomeIds = Object.fromEntries(preset.biomes.map((name,i)=>[name,i+100]));
        preset.dispose();
        assert.throws(()=>createDensityTerrainSampler(k,0,data,{solidState:300,airState:9,biomeIds:{}}),/Missing biome ID/);
        const sampler = createDensityTerrainSampler(k,-1,data,{solidState:300,airState:9,biomeIds});
        const chunk = sampler.sampleChunk(-1,0);
        const graph = k.density(-1,data,{final:'minecraft:overworld/final_density'});
        const volume = graph.sampleVolume('final',-16,-64,0,16,384,16);
        const router = createClimateRouter(k,-1,data);
        assert.equal(chunk.blocks.length,98304);
        assert.equal(chunk.biomes.length,1536);
        let solids = 0;
        for (let z=0;z<16;z++) for (let x=0;x<16;x++) {
            let top = -64;
            for (let y=0;y<384;y++) {
                const solid = volume[(z*16+x)*384+y] > 0;
                assert.equal(chunk.getBlock(x,y-64,z),solid ? 300 : 9);
                if (solid) { top = y-63; solids++; }
            }
            assert.equal(chunk.heightmap[z*16+x],top);
        }
        assert.ok(solids > 0 && solids < volume.length);
        for (let y=0;y<96;y++) for (let z=0;z<4;z++) for (let x=0;x<4;x++) {
            assert.equal(chunk.biomes[y*16+z*4+x],biomeIds[router.biomeAtQuart(-4+x,y-16,z)]);
        }
        assert.throws(()=>graph.sampleVolume('final',0,0,0,16,0,16),/Invalid density volume/);
        sampler.dispose(); graph.dispose(); router.dispose();
        assert.throws(()=>sampler.sampleChunk(0,0),/disposed/);
        assert.equal(k.capabilities.chunks,false);
    } finally { k.dispose(); }
});

test('climate router uses the selected settings and quart coordinates', async () => {
    const k = await kernel();
    try {
        for (const mode of ['overworld', 'large_biomes', 'amplified', 'nether']) {
            const router = createClimateRouter(k, 0, data, mode);
            const lookup = k.climate(mode === 'nether' ? 'nether' : 'overworld');
            for (const p of [[0,16,0],[-1,-16,1],[7919,79,-104729]]) {
                assert.equal(router.biomeAtQuart(...p), lookup.sample(...router.sampleBlock(...p.map(v => v*4))));
            }
            router.dispose(); lookup.dispose();
        }
        const overworld = createClimateRouter(k, 0, data);
        const large = createClimateRouter(k, 0, data, 'large_biomes');
        assert.notDeepEqual(overworld.sampleBlock(0,64,0), large.sampleBlock(0,64,0));
        assert.equal(overworld.biomeAtQuart(0,16,0), 'minecraft:river');
        assert.equal(large.biomeAtQuart(0,16,0), 'minecraft:deep_lukewarm_ocean');
        assert.throws(() => createClimateRouter(k, 0, data, 'end'), /not ported/);
        assert.equal(k.capabilities.chunks, false);
    } finally { k.dispose(); }
});

test('End island density graph compiles from vanilla JSON and drives its biome source', async () => {
    const k = await kernel();
    try {
        const graph = k.density('-9223372036854775808', data, { islands: 'minecraft:end/islands' });
        const source = createKernelEndBiomeSource(k, '-9223372036854775808', data);
        try {
            for (const point of [[0,0,0],[1024,64,-1024],[32000,80,26000],[-25000000,20,25000000]]) {
                assert.ok(Number.isFinite(graph.sample('islands', ...point)));
            }
            assert.equal(source.biomeAtQuart(256, 0, 0), 'minecraft:the_end');
            assert.ok(source.biomes.includes(source.biomeAtQuart(260, 0, 0)));
        } finally { graph.dispose(); source.dispose(); }
        assert.throws(() => source.biomeAtQuart(260,0,0), /disposed/);
    } finally { k.dispose(); }
});

test('End diagnostic terrain sampler creates 0..127 chunks with End biomes and no aquifers', async () => {
    const k = await kernel();
    try {
        const source = createKernelEndBiomeSource(k, '123456789', data);
        const biomeIds = Object.fromEntries(source.biomes.map((name,index)=>[name,index]));
        source.dispose();
        assert.throws(()=>createDensityTerrainSampler(k,0,data,{settings:'end',solidState:1,airState:0,biomeIds,fluids:true,waterState:2,lavaState:3}),/no aquifer/);
        const sampler = createNoiseTerrainSampler(k,'123456789',data,{settings:'end',solidState:1,airState:0,biomeIds});
        try {
            const chunk = sampler.sampleChunk(0,0);
            assert.equal(chunk.minY,0);
            assert.equal(chunk.height,128);
            assert.equal(chunk.blocks.length,32768);
            assert.ok(chunk.blocks.includes(1) && chunk.blocks.includes(0));
            assert.ok([...chunk.blocks].every(state=>state===0 || state===1));
            assert.ok([...chunk.biomes].every(id=>id>=0 && id<5));
            assert.ok([...chunk.heightmap].every(height=>height>=0 && height<=128));
            assert.equal(chunk.serialize().format,'breakmine:vanilla-chunk-v1');
        } finally { sampler.dispose(); }
    } finally { k.dispose(); }
});

test('26.3 material surface noise, positional jitter and column anchors follow RandomState streams', async () => {
    const k = await kernel();
    const seed = '-1234567890123456789';
    const x = -37, z = 812;
    const noises = createNoiseRegistry(k, seed, data);
    const random = k.random(seed);
    const randoms = random.forkPositional();
    const surfaceSource = randoms.fromHashOf('surface');
    const surfaceRandom = surfaceSource.forkPositional();
    const sampler = createMaterialSurfaceSampler(k, seed, data);
    try {
        const surface = Math.fround(noises.sample('minecraft:surface', x, 0, z));
        const at = surfaceRandom.at(x, 0, z);
        const expectedDepth = Math.trunc(surface * 2.75 + 3 + at.nextDouble() * 0.25);
        const secondary = Math.fround(noises.sample('minecraft:surface_secondary', x, 0, z));
        const actual = sampler.surfaceAt(x, z);
        assert.deepEqual(actual, { surfaceDepth: expectedDepth, surfaceSecondary: secondary });

        const column = sampler.createColumn({
            x, z, surfaceGradientX: -3, surfaceGradientZ: 5,
            preliminarySurfaceValue: -12.25, seaLevel: 63, minY: -64, maxY: 320,
            biome: 'minecraft:plains'
        });
        assert.equal(column.minSurfaceLevel, Math.floor(Math.fround(-12.25)) + expectedDepth - 8);
        assert.equal(column.resolveAnchorY({ above_bottom: 5 }), -59);
        assert.equal(column.resolveAnchorY({ below_top: 7 }), 312);
        assert.equal(column.resolveAnchorY({ above_sea_level: 4 }), 67);

        const y = 101;
        const condition = { random_name: 'minecraft:bedrock_floor', true_at_and_below: { above_bottom: 0 }, false_at_and_above: { below_top: 0 } };
        const randomAt = randoms.fromHashOf('minecraft:bedrock_floor').forkPositional().at(x, y, z);
        const roll = Math.fround(Number(BigInt.asUintN(64, randomAt.nextLong()) >> 40n) * 5.9604644775390625e-8);
        const threshold = 1 - (y - (-64)) / (319 - (-64));
        assert.equal(column.atY(y).verticalGradient(condition), roll < threshold);
        assert.equal(column.atY(y).sampleNoise('minecraft:surface', false), surface);
        assert.equal(column.atY(y).sampleNoise('minecraft:surface', true), Math.fround(noises.sample('minecraft:surface', x, y, z)));
        randomAt.dispose();
    } finally {
        sampler.dispose(); surfaceRandom.dispose(); surfaceSource.dispose(); randoms.dispose(); random.dispose(); noises.dispose(); k.dispose();
    }
    assert.throws(() => sampler.surfaceAt(0, 0), /disposed/);
});

test('26.3 Badlands band rule uses the clay-band palette and offset noise', async () => {
    const k = await kernel();
    const blockStates = Object.fromEntries([
        'terracotta', 'orange_terracotta', 'yellow_terracotta', 'brown_terracotta',
        'red_terracotta', 'white_terracotta', 'light_gray_terracotta'
    ].map((name, index) => [`minecraft:${name}`, index + 100]));
    const first = createMaterialSurfaceSampler(k, 7781, data, { blockStates });
    const second = createMaterialSurfaceSampler(k, 7781, data, { blockStates });
    const evaluator = createMaterialRuleEvaluator({}, { blockStates });
    try {
        const context = first.createColumn({
            x: -181, z: 903, surfaceGradientX: 0, surfaceGradientZ: 0,
            preliminarySurfaceValue: 80, seaLevel: 63, minY: -64, maxY: 320,
            biome: 'minecraft:badlands'
        }).atY(82);
        const other = second.createColumn({
            x: -181, z: 903, surfaceGradientX: 0, surfaceGradientZ: 0,
            preliminarySurfaceValue: 80, seaLevel: 63, minY: -64, maxY: 320,
            biome: 'minecraft:badlands'
        }).atY(82);
        const rule = { type: 'minecraft:bandlands' };
        for (let y = -64; y < 320; y += 7) {
            const actual = evaluator.evaluate(rule, { ...context, blockY: y });
            assert.ok(Object.values(blockStates).includes(actual));
            assert.equal(actual, evaluator.evaluate(rule, { ...other, blockY: y }));
        }
    } finally { first.dispose(); second.dispose(); k.dispose(); }
});

test('Overworld terrain sampler can opt into the complete vanilla material-rule pass', async () => {
    const k = await kernel();
    try {
        const preset = k.climate('overworld');
        const biomeIds = Object.fromEntries(preset.biomes.map((name, index) => [name, index]));
        preset.dispose();
        const blockNames = new Set(['minecraft:air', 'minecraft:stone', 'minecraft:water', 'minecraft:lava']);
        const visit = value => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
                if (['result_state', 'ore_block', 'raw_ore_block', 'filler_block'].includes(key) && typeof child === 'string') blockNames.add(child);
                else visit(child);
            }
        };
        for (const [key, value] of Object.entries(data)) if (key.startsWith('data/minecraft/worldgen/material_rule/')) visit(value);
        for (const name of ['terracotta', 'orange_terracotta', 'yellow_terracotta', 'brown_terracotta', 'red_terracotta', 'white_terracotta', 'light_gray_terracotta']) blockNames.add(`minecraft:${name}`);
        const blockStates = Object.fromEntries([...blockNames].sort().map((name, index) => [name, index + 100]));
        const sampler = createNoiseTerrainSampler(k, 453, data, {
            settings: 'overworld', solidState: blockStates['minecraft:stone'], airState: blockStates['minecraft:air'],
            waterState: blockStates['minecraft:water'], lavaState: blockStates['minecraft:lava'], biomeIds,
            applySurfaceRules: true, blockStates
        });
        try {
            const chunk = sampler.sampleChunk(0, 0);
            const materialStates = new Set([...blockNames].filter(name => !['minecraft:stone', 'minecraft:air', 'minecraft:water', 'minecraft:lava'].includes(name)).map(name => blockStates[name]));
            assert.ok([...chunk.blocks].some(state => materialStates.has(state)));
        } finally { sampler.dispose(); }
    } finally { k.dispose(); }
});

test('material surface column scan tracks exposed stone, water, and edge height gradients', () => {
    const chunk = new VanillaChunk(-1, 0, 0, 16);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        for (const y of [5, 6, 7]) chunk.setBlock(x, y, z, 1);
        chunk.heightmap[z * 16 + x] = 8;
    }
    chunk.setBlock(1, 8, 0, 2);
    chunk.heightmap[1] = 9;
    const seen = new Map();
    const materialSampler = {
        createColumn(args) {
            return {
                atY(y, state) {
                    if (y === 7 && args.z === 0) seen.set(args.x, { ...args, ...state });
                    return { ...args, ...state, blockY: y };
                }
            };
        }
    };
    const evaluator = createMaterialRuleEvaluator({}, { blockStates: { 'minecraft:grass_block': 3 } });
    const result = applyMaterialRulesToChunk(chunk, {
        evaluator,
        ruleId: {
            type: 'minecraft:condition',
            if_true: { type: 'minecraft:stone_depth', offset: 0, add_surface_depth: false, secondary_depth_range: 0, surface_type: 'floor' },
            then_run: { type: 'minecraft:block', result_state: 'minecraft:grass_block' }
        },
        materialSampler,
        airState: 0,
        fluidStates: new Set([2]),
        samplePreliminarySurface: () => 0,
        seaLevel: 8,
        biomeAt: () => 'minecraft:plains'
    });

    assert.equal(result.changedBlocks, 256);
    assert.equal(chunk.getBlock(0, 7, 0), 3);
    assert.equal(chunk.getBlock(0, 6, 0), 1);
    assert.equal(chunk.getBlock(0, 5, 0), 1);
    assert.equal(seen.get(-16).stoneDepthAbove, 1);
    assert.equal(seen.get(-16).stoneDepthBelow, 3);
    assert.equal(seen.get(-16).waterHeight, -0x80000000);
    assert.equal(seen.get(-15).waterHeight, 9);
    assert.equal(seen.get(-16).surfaceGradientX, 1);
    assert.equal(seen.get(-16).surfaceGradientZ, 0);
});

test('Overworld terrain sampler exposes JAR ore-vein density fields for material rules', async () => {
    const k = await kernel();
    try {
        const preset = k.climate('overworld');
        const biomeIds = Object.fromEntries(preset.biomes.map((name, index) => [name, index]));
        preset.dispose();
        const sampler = createNoiseTerrainSampler(k, 91, data, {
            settings: 'overworld', solidState: 1, airState: 0, waterState: 2, lavaState: 3, biomeIds
        });
        for (const id of [
            'minecraft:overworld/ore_vein/copper_density',
            'minecraft:overworld/ore_vein/iron_density',
            'minecraft:overworld/ore_vein/richness',
            'minecraft:overworld/ore_vein/gap'
        ]) assert.ok(Number.isFinite(sampler.sampleMaterialDensity(id, -157, -32, 803)));
        assert.throws(() => sampler.sampleMaterialDensity('minecraft:missing', 0, 0, 0), /unavailable/);
        sampler.dispose();
        assert.throws(() => sampler.sampleMaterialDensity('minecraft:overworld/ore_vein/gap', 0, 0, 0), /disposed/);
    } finally { k.dispose(); }
});

test('density caches do not leak values across positions, seeds or graph lifetimes', async () => {
    const k = await kernel();
    try {
        const a = createClimateRouter(k, '9007199254740993', data);
        const b = createClimateRouter(k, '9007199254740993', data);
        const different = createClimateRouter(k, '9007199254740992', data);
        const origin = a.sampleBlock(-16,-64,16);
        a.sampleBlock(30000000,319,-30000000);
        assert.deepEqual(a.sampleBlock(-16,-64,16), origin);
        assert.deepEqual(b.sampleBlock(-16,-64,16), origin);
        assert.notDeepEqual(different.sampleBlock(-16,-64,16), origin);
        a.dispose(); a.dispose();
        assert.throws(() => a.sampleBlock(0,0,0), /disposed/);
        assert.deepEqual(b.sampleBlock(-16,-64,16), origin);
        k.dispose();
        assert.throws(() => b.biomeAtQuart(0,0,0), /disposed/);
    } finally { k.dispose(); }
});

test('density compilation rejects missing, cyclic, unsupported and malformed input', async () => {
    const k = await kernel();
    const graph = definition => k.density(0, data, { value: definition });
    try {
        assert.throws(() => graph('minecraft:missing'), /Missing density/);
        assert.throws(() => graph({ type: 'minecraft:made_up' }), /not ported/);
        assert.throws(() => graph({ type: 'minecraft:noise', noise:'minecraft:missing', xz_scale:1, y_scale:1 }), /Missing noise/);
        const cycle = { ...data, 'data/minecraft/worldgen/density_function/cycle.json': 'minecraft:cycle' };
        assert.throws(() => k.density(0, cycle, { value:'minecraft:cycle' }), /Cyclic/);
        assert.throws(() => graph({ type:'minecraft:gradient', axis:'y', from_coordinate:0, to_coordinate:0, from_value:0, to_value:1 }), /range cannot/);
        assert.throws(() => graph({ type:'minecraft:gradient', axis:'y', tiling:'repeat', from_coordinate:0, to_coordinate:8, from_value:0, to_value:1 }), /Unsupported/);
        assert.throws(() => graph({ type:'minecraft:spline', spline:{coordinate:0,points:[]} }), /requires points/);
        assert.throws(() => graph({ type:'minecraft:spline', spline:{coordinate:0,points:[{location:1,value:0,derivative:0},{location:1,value:1,derivative:0}]} }), /must increase/);
        assert.throws(() => graph({ type:'minecraft:interval_select', input:0, thresholds:[0], functions:[0] }), /one more function/);
        assert.throws(() => graph({ type:'minecraft:interpolated', input:0, cell_size_xz:0, cell_size_y:8 }), /must be positive/);
        let deep = 0;
        for (let i=0; i<140; i++) deep = {type:'minecraft:cache',input:deep};
        assert.throws(() => graph(deep), /maximum depth/);
        const valid = graph(1.5);
        assert.equal(valid.sample('value',0,0,0),1.5);
        assert.throws(() => valid.sample('missing',0,0,0), /Unknown density/);
        assert.throws(() => valid.sample('value',0.5,0,0), /Java int/);
        assert.throws(() => valid.sample('value',2147483648,0,0), /Java int/);
    } finally { k.dispose(); }
});

test('spline endpoints, nested values and linear extensions stay continuous', async () => {
    const k = await kernel();
    try {
        const graph = k.density(0, data, { value: {type:'minecraft:spline',spline:{
            coordinate: {type:'minecraft:gradient',axis:'y',from_coordinate:-8,to_coordinate:8,from_value:-8,to_value:8},
            points:[{location:-2,value:-2,derivative:1},{location:2,value:2,derivative:1}]
        }} });
        for (const y of [-8,-3,-2,-1,0,1,2,3,8]) assert.equal(graph.sample('value',0,y,0),y);
    } finally { k.dispose(); }
});

test('Nether climate uses the legacy path, and rejects other unported legacy noises', async () => {
    const k = await kernel();
    try {
        const router = createClimateRouter(k, '9223372036854775807', data, 'nether');
        const first = router.sampleBlock(123,0,456);
        assert.deepEqual(router.sampleBlock(123,319,456), first);
        assert.deepEqual(first.slice(2), [0,0,0,0]);
        const roots = { value: {type:'minecraft:noise',noise:'minecraft:temperature',xz_scale:0.25,y_scale:0} };
        assert.throws(() => k.density(0,data,roots,{legacyRandom:true}), /Legacy named noise is not ported/);
        assert.throws(() => router.biomeAtQuart(536870912,0,0), /Quart coordinates/);
    } finally { k.dispose(); }
});

test('base terrain honors dimension scales and legacy versus positional initialization', async () => {
    const k = await kernel();
    try {
        const roots = { overworld:'minecraft:overworld/base_3d_noise', nether:'minecraft:nether/base_3d_noise', end:'minecraft:end/base_3d_noise' };
        const modern = k.density(-1,data,roots);
        const legacy = k.density(-1,data,roots,{legacyRandom:true});
        const values = modern.fields.map(name => modern.sample(name,-17,-64,16));
        assert.equal(new Set(values).size,3);
        assert.ok(values.every(Number.isFinite));
        for (const name of modern.fields) assert.notEqual(modern.sample(name,-17,-64,16),legacy.sample(name,-17,-64,16));
        const expected = modern.sample('overworld',0,63,0);
        modern.sample('overworld',30000000,319,-30000000);
        assert.equal(modern.sample('overworld',0,63,0),expected);
        legacy.dispose();
        assert.throws(() => legacy.sample('end',0,0,0),/disposed/);
        const invalid = {...data['data/minecraft/worldgen/density_function/overworld/base_3d_noise.json'],y_factor:0};
        assert.throws(() => k.density(0,data,{value:invalid}),/Invalid blended noise/);
    } finally { k.dispose(); }
});

test('sloped and final density remain seed dependent without enabling incomplete chunks', async () => {
    const k = await kernel();
    try {
        const roots = { shape:'minecraft:overworld/sloped_cheese', amplified:'minecraft:overworld_amplified/sloped_cheese' };
        const graph = k.density(0,data,roots);
        for (const name of graph.fields) {
            const below = graph.sample(name,7919,-64,-104729);
            const above = graph.sample(name,7919,319,-104729);
            assert.ok(Number.isFinite(below) && Number.isFinite(above));
            assert.notEqual(below,above);
        }
        const final = k.density(0,data,{terrain:'minecraft:overworld/final_density'});
        assert.ok(Number.isFinite(final.sample('terrain',17,32,-17)));
        final.dispose();
        assert.throws(() => k.generateChunk(0,0),/not implemented/);
    } finally { k.dispose(); }
});

test('experimental scalar memo reuse and packed density batches preserve exact float results', async () => {
    const k = await kernel();
    try {
        const graph = k.density('6888349110149677383', data, {
            base: 'minecraft:overworld/base_3d_noise',
            surface: 'minecraft:overworld/continents'
        });
        const reused = k.density('6888349110149677383', data, {
            base: 'minecraft:overworld/base_3d_noise',
            surface: 'minecraft:overworld/continents'
        }, { experimentalScalarMemoReuse: true });
        const batched = k.density('6888349110149677383', data, {
            base: 'minecraft:overworld/base_3d_noise',
            surface: 'minecraft:overworld/continents'
        }, { experimentalBatchDensityQueries: true });
        const points = new Int32Array([-17, -64, 31, 0, 63, 0, 811, 208, -397, 16, 319, 16]);
        try {
            for (const name of graph.fields) {
                const expected = [];
                for (let i = 0; i < points.length; i += 3) expected.push(graph.sample(name, points[i], points[i + 1], points[i + 2]));
                const reusedValues = points.reduce((values, _, i) => {
                    if (i % 3 === 0) values.push(reused.sample(name, points[i], points[i + 1], points[i + 2]));
                    return values;
                }, []);
                assert.deepEqual(reusedValues, expected);
                assert.deepEqual([...batched.sampleMany(name, points)], expected);
            }
        } finally { graph.dispose(); reused.dispose(); batched.dispose(); }
    } finally { k.dispose(); }
});
