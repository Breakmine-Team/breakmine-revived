import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readStructureNbt, decodeStructureNbt, normalizeStructureTemplate, createStructureTemplateRegistry } from '../structure-nbt.mjs';
import { resolveStructureProcessors, processStructureBlocks, testStructurePositionRule } from '../structure-processors.mjs';
import { transformStructurePosition, rotatedStructureSize, structureZeroPosition, structureBounds, placeStructureTemplate, updateStructureNeighborShapes } from '../structure-template.mjs';
import { createVanillaKernel } from '../runtime.mjs';
import { createJavaLegacyRandom } from '../java-legacy-random.mjs';
import { createDensityTerrainSampler } from '../chunk.mjs';
import { FOSSIL_MODES, fossilData, fossilTemplates, runFossilFixture } from './fossil-fixtures.mjs';
import { createStructureFixtureWorld } from './structure-feature-fixtures.mjs';
import { compareJarTemplates } from './template-comparison.mjs';

const reference = JSON.parse(await readFile(new URL('../generated/feature-oracle.json', import.meta.url), 'utf8'));
const templateReference = JSON.parse(await readFile(new URL('../generated/template-oracle.json', import.meta.url), 'utf8'));
async function withKernel(fn) {
    const kernel = await createVanillaKernel(await readFile(new URL('../generated/worldgen.wasm', import.meta.url)), JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url), 'utf8')));
    try { return await fn(kernel); } finally { kernel.dispose(); }
}
const point = ([x,y,z]) => ({x,y,z});
const state = (name, properties = {}) => ({name:`minecraft:${name}`, properties});
const directState = value => typeof value === 'string' ? state(value.replace('minecraft:','')) : {name:value.id, properties:value.properties ?? {}};
const emptyFluid = {id:'minecraft:empty', empty:true,source:false};
function world() {
    const blocks = new Map(), writes = [], effects = [], key = p => `${p.x},${p.y},${p.z}`;
    const context = { seed:'912337', getBlockState:p=>blocks.get(key(p)) ?? state('stone'), getDefaultBlockState:name=>({name,properties:{}}),
        getFluidState:()=>emptyFluid, isStaticFullTemplateBlock:s=>s.name!=='minecraft:torch', transformStructureState:s=>s,
        isTemplateLiquidContainer:()=>false, updateStructureBlockShape:s=>s, notifyStructureBlockNeighbors:()=>{},
        isBlockInTag:s=>s.name==='minecraft:bedrock', loadTemplateBlockEntity:(p,n)=>effects.push({kind:'nbt',p,n}),
        markTemplateBlockEntityChanged:p=>effects.push({kind:'dirty',p}), hasLootContainer:()=>false };
    const setBlock = (s,p,flags) => { blocks.set(key(p),s); writes.push({s,p,flags}); return true; };
    return {context,setBlock,writes,effects,blocks,directState};
}
function template(names = ['stone'], entries = [[0,0,0,0]]) {
    return {size:[4,4,4],palettes:[names.map(n=>state(n))],blocks:entries.map(([x,y,z,s,nbt=null])=>({pos:{x,y,z},state:s,nbt})),entities:[]};
}
const origin = {x:0,y:0,z:0};

test('all 1,511 JAR templates match native ordered palette/block digests, sizes and entity counts', async () => {
    assert.deepEqual(await compareJarTemplates(fossilData,templateReference.templates),{templates:1511,palettes:1651,blocks:1234749,states:1725});
    const registry = await createStructureTemplateRegistry(fossilData,['minecraft:fossil/spine_1']);
    assert.throws(()=>registry.get('minecraft:missing'),/not loaded/);
});
test('NBT reader rejects truncation, bad types, trailing bytes and decompression bombs', async () => {
    assert.throws(()=>readStructureNbt(new Uint8Array([10,0,0])),/Truncated/);
    assert.throws(()=>readStructureNbt(new Uint8Array([1,0,0,0])),/root/);
    assert.throws(()=>readStructureNbt(new Uint8Array([10,0,0,0,1])),/Trailing/);
    assert.throws(()=>readStructureNbt(new Uint8Array([10,0,0,99,0,0,0])),/Unknown/);
    await assert.rejects(()=>decodeStructureNbt(fossilData['data/minecraft/structure/fossil/spine_1.nbt'],{maxBytes:20}),/limit/);
});
test('NBT longs retain all 64 bits rather than rounding through JavaScript numbers', () => {
    const bytes=new Uint8Array([10,0,0,4,0,1,115,0,0,0,0,0,0,0,0,0]);
    new DataView(bytes.buffer).setBigInt64(7,9223372036854775807n);
    assert.equal(readStructureNbt(bytes).s,9223372036854775807n);
});
test('NBT palettes accept modern 26.3 id/properties and old Name/Properties without missing-state fallback', () => {
    const modern=normalizeStructureTemplate({size:[1,1,1],palette:[{id:'minecraft:bone_block',properties:{axis:'x'}}],blocks:[{pos:[0,0,0],state:0}]});
    const old=normalizeStructureTemplate({size:[1,1,1],palette:[{Name:'minecraft:bone_block',Properties:{axis:'x'}}],blocks:[{pos:[0,0,0],state:0}]});
    assert.deepEqual(modern,old);
    assert.throws(()=>normalizeStructureTemplate({size:[1,1,1],palette:[{}]}),/palette/);
    assert.throws(()=>normalizeStructureTemplate({size:[1,1,1],palette:[{id:'minecraft:stone'}],blocks:[{pos:[0,0,0],state:2}]}),/block/);
});
for (const rotation of ['none','clockwise_90','clockwise_180','counterclockwise_90']) test(`template bounds and zero-origin align non-square fossil after ${rotation}`, () => {
    const t=fossilTemplates.get('minecraft:fossil/spine_1'), corner={x:-17,y:-64,z:31};
    const p=structureZeroPosition(t,corner,{rotation}), b=structureBounds(t,p,{rotation}), size=rotatedStructureSize(t,rotation);
    assert.deepEqual([b.minX,b.minY,b.minZ],[corner.x,corner.y,corner.z]);
    assert.deepEqual([b.maxX-b.minX+1,b.maxY-b.minY+1,b.maxZ-b.minZ+1],size);
});
test('all 36 original-JAR rotation/mirror/pivot transforms match', () => {
    for (const entry of templateReference.transforms) assert.deepEqual(transformStructurePosition(point(entry.pos),{rotation:entry.rotation,mirror:entry.mirror,rotationPivot:point(entry.pivot)}),point(entry.result));
    assert.throws(()=>transformStructurePosition(origin,{rotation:'invalid'}),/transform/);
});
test('template groups sort full blocks, partial shapes, then NBT in Y/X/Z order', () => {
    const w=world(), t=template(['torch','stone','chest'],[[1,2,0,0],[1,1,0,1],[0,1,2,1],[0,0,0,2,{id:'minecraft:chest'}]]);
    placeStructureTemplate(t,origin,{...w,random:createJavaLegacyRandom('0')});
    assert.deepEqual(w.writes.map(a=>a.s.name),['minecraft:stone','minecraft:stone','minecraft:torch','minecraft:barrier','minecraft:chest']);
    assert.deepEqual(w.writes.slice(0,2).map(a=>a.p),[{x:0,y:1,z:2},{x:1,y:1,z:0}]);
    assert.equal(w.writes[3].flags,820); assert.equal(w.effects[0].kind,'nbt'); assert.equal(w.effects[1].kind,'dirty');
});
test('empty template still consumes nextInt(1) to select its palette', () => {
    const w=world(), bounds=[], random={nextInt:n=>{bounds.push(n);return 0;}};
    assert.equal(placeStructureTemplate(template(['stone'],[]),origin,{...w,random}),false);
    assert.deepEqual(bounds,[1]);
});
test('ordinary processors clip before RNG draws but capped processors evaluate the whole piece', () => {
    const t=template(['stone'],[[0,0,0,0],[1,0,0,0]]), box={minX:0,minY:0,minZ:0,maxX:0,maxY:0,maxZ:0};
    for (const capped of [false,true]) {
        const w=world(); let draws=0;
        placeStructureTemplate(t,origin,{...w,boundingBox:box,random:{nextInt:()=>0,nextFloat:()=>{draws++;return 0;}},processors:[{processor_type:'minecraft:block_rot',integrity:1},
            ...(capped?[{processor_type:'minecraft:capped',limit:1,delegate:{processor_type:'minecraft:nop'}}]:[])]});
        assert.equal(draws,capped?2:1); assert.equal(w.writes.length,1);
    }
});
test('block rot uses <= integrity and retains non-rottable blocks without float draws', () => {
    const w=world(), blocks=[{local:origin,pos:origin,state:state('stone'),nbt:null}]; let calls=0;
    const options={...w,random:{nextFloat:()=>{calls++;return 0;}}};
    assert.equal(processStructureBlocks(blocks,[{processor_type:'minecraft:block_rot',integrity:0}],origin,origin,options).length,1);
    assert.equal(processStructureBlocks(blocks,[{processor_type:'minecraft:block_rot',integrity:0,rottable_blocks:'minecraft:bone_block'}],origin,origin,options).length,1);
    assert.equal(calls,1);
});
test('protected blocks and block-ignore suppress writes; unsupported processors fail explicitly', () => {
    const w=world(), blocks=[{local:origin,pos:origin,state:state('bone_block'),nbt:null}];
    w.context.getBlockState=()=>state('bedrock');
    assert.deepEqual(processStructureBlocks(blocks,[{processor_type:'minecraft:protected_blocks',value:'#minecraft:features_cannot_replace'}],origin,origin,w),[]);
    assert.deepEqual(processStructureBlocks(blocks,[{processor_type:'minecraft:block_ignore',blocks:'minecraft:bone_block'}],origin,origin,w),[]);
    assert.throws(()=>processStructureBlocks(blocks,[{processor_type:'minecraft:unknown'}],origin,origin,w),/Unsupported/);
});
test('every imported processor list resolves and uses the four implemented datapack types', () => {
    const types=new Set(); let lists=0;
    for (const [path] of Object.entries(fossilData)) if (path.includes('/processor_list/')) {
        const id=`minecraft:${path.split('/processor_list/')[1].slice(0,-5)}`;
        resolveStructureProcessors(fossilData,id).forEach(p=>types.add(p.processor_type)); lists++;
    }
    assert.equal(lists,40); assert.deepEqual([...types].sort(),['minecraft:block_rot','minecraft:capped','minecraft:protected_blocks','minecraft:rule']);
    assert.throws(()=>resolveStructureProcessors(fossilData,'minecraft:missing'),/Missing/);
});
test('rule output and NBT passthrough/clear/static/loot do not mutate template tags', () => {
    const w=world(), nbt={original:1}, blocks=[{local:origin,pos:origin,state:state('stone'),nbt}];
    for (const modifier of [undefined,{type:'minecraft:clear'},{type:'minecraft:append_static',data:{custom:2}},{type:'minecraft:append_loot',loot_table:'minecraft:chests/simple_dungeon'}]) {
        const result=processStructureBlocks(blocks,[{processor_type:'minecraft:rule',rules:[{input_predicate:{predicate_type:'minecraft:always_true'},location_predicate:{predicate_type:'minecraft:always_true'},output_state:'minecraft:gold_block',block_entity_modifier:modifier}]}],origin,origin,w)[0];
        assert.equal(result.state.name,'minecraft:gold_block');
        if (modifier?.type==='minecraft:append_loot') {assert.equal(result.nbt.LootTable,'minecraft:chests/simple_dungeon');assert.equal(typeof result.nbt.LootTableSeed,'bigint');}
    }
    assert.deepEqual(nbt,{original:1});
});
test('static NBT modifier recursively merges compound tags and replaces arrays', () => {
    const w=world(), nbt={nested:{kept:1,old:2},list:[1,2]}, blocks=[{local:origin,pos:origin,state:state('stone'),nbt}];
    const result=processStructureBlocks(blocks,[{processor_type:'minecraft:rule',rules:[{input_predicate:{predicate_type:'minecraft:always_true'},location_predicate:{predicate_type:'minecraft:always_true'},output_state:'minecraft:stone',block_entity_modifier:{type:'minecraft:append_static',data:{nested:{old:3,new:4},list:[5]}}}]}],origin,origin,w)[0];
    assert.deepEqual(result.nbt,{nested:{kept:1,old:3,new:4},list:[5]});assert.deepEqual(nbt,{nested:{kept:1,old:2},list:[1,2]});
});
test('position rules use float32 linear/axis curves and inclusive comparison', () => {
    for (const type of ['linear_pos','axis_aligned_linear_pos']) {
        const rule={predicate_type:`minecraft:${type}`,axis:'y',min_dist:0,max_dist:10,min_chance:0,max_chance:1};
        assert.equal(testStructurePositionRule(rule,origin,{x:0,y:5,z:0},origin,{nextFloat:()=>0.5}),true);
        assert.equal(testStructurePositionRule(rule,origin,{x:0,y:5,z:0},origin,{nextFloat:()=>0.51}),false);
    }
});
test('failed template writes do not load NBT, waterlog, or notify neighbors', () => {
    const w=world(); let neighbors=0;
    w.context.notifyStructureBlockNeighbors=()=>neighbors++;
    placeStructureTemplate(template(['stone']),origin,{...w,setBlock:()=>false});
    assert.equal(neighbors,0); assert.equal(w.effects.length,0);
});
test('pending template waterlogging obtains an external source', () => {
    const w=world(), calls=[], fluids=new Map(), key=p=>`${p.x},${p.y},${p.z}`, source={id:'minecraft:water',empty:false,source:true};
    w.context.getFluidState=p=>fluids.get(key(p)) ?? emptyFluid;
    w.context.isTemplateLiquidContainer=s=>s.name==='minecraft:chest';
    w.context.placeTemplateLiquid=(p,s,fluid)=>{calls.push({p,source:fluid.source});if(fluid.source)fluids.set(key(p),source);return fluid.source;};
    fluids.set('1,0,0',source);
    placeStructureTemplate(template(['chest']),origin,{...w});
    assert.deepEqual(calls.map(c=>c.source),[false,true]);
});
test('neighbor shape update visits exposed faces in Z/Y/X cycle then the six vanilla directions', () => {
    const w=world(), events=[];
    w.setBlock(state('stone'),origin,2);
    w.context.updateStructureBlockShape=(s,p,d)=>{events.push([p.x,p.y,p.z,d]);return s;};
    updateStructureNeighborShapes([origin],{...w,flags:261});
    assert.deepEqual(events.filter((e,i)=>i<12&&i%2===0).map(e=>e[3]),['north','south','down','up','west','east']);
    assert.deepEqual(events.slice(12).map(e=>e[3]),['west','east','north','south','down','up']);
});
for (const mode of FOSSIL_MODES) test(`original JAR fossil ${mode}: six seeds, states, ticks, flags and RNG continuation`,async () => {
    await withKernel(kernel=>{
        const entries=reference.cases.filter(c=>c.mode===mode);assert.equal(entries.length,6);
        for (const entry of entries) {
            const random=kernel.random(entry.seed);
            try {const {mode:ignored,seed,...expected}=entry;assert.deepEqual(runFossilFixture(mode,random,entry.seed,createStructureFixtureWorld),expected);}
            finally {random.dispose();}
        }
    });
});
test('nonempty WASM beardifier matches every original-JAR float32 bit in all five modes',async () => {
    await withKernel(kernel=>{
        const graph=kernel.density('0',{}, {b:{type:'minecraft:beardifier'}}), view=new DataView(new ArrayBuffer(4));
        try {for(const entry of templateReference.beardCases){
            graph.setBeardifier({pieces:[{box:{minX:-5,minY:-12,minZ:3,maxX:4,maxY:7,maxZ:11},terrainAdjustment:entry.adjustment,groundLevelDelta:entry.ground}],junctions:[{x:-7,groundY:-9,z:13}],affectedBox:{minX:-32,minY:-40,minZ:-28,maxX:32,maxY:40,maxZ:36}});
            for(const [x,y,z,bits] of entry.samples){view.setFloat32(0,graph.sample('b',x,y,z));assert.equal(view.getInt32(0),bits);}
        }}finally{graph.dispose();}
    });
});
test('beardifier validates atomically, resets empty contexts and flows through density operators/volumes',async () => {
    await withKernel(kernel=>{
        const graph=kernel.density('0',{}, {b:{type:'minecraft:beardifier'},sum:{type:'minecraft:add',left:2,right:{type:'minecraft:beardifier'}}});
        const structures={pieces:[{box:{minX:0,minY:0,minZ:0,maxX:1,maxY:1,maxZ:1},terrainAdjustment:'bury'}],affectedBox:{minX:-24,minY:-24,minZ:-24,maxX:25,maxY:25,maxZ:25}};
        try {graph.setBeardifier(structures);assert.equal(graph.sample('b',0,0,0),1);assert.equal(graph.sample('sum',0,0,0),3);
            assert.throws(()=>graph.setBeardifier({...structures,affectedBox:null}),/affectedBox/);assert.equal(graph.sample('b',0,0,0),1);
            const v=graph.sampleVolume('b',-1,-1,-1,3,3,3);let i=0;for(let z=-1;z<2;z++)for(let x=-1;x<2;x++)for(let y=-1;y<2;y++)assert.equal(v[i++],graph.sample('b',x,y,z));
            graph.setBeardifier();assert.equal(graph.sample('sum',0,0,0),2);
        }finally{graph.dispose();}
    });
});
test('chunk terrain obtains fresh structure context without leaking it into the next chunk',async () => {
    await withKernel(kernel=>{
        const climate=kernel.climate('overworld'); const biomeIds=Object.fromEntries(climate.biomes.map((n,i)=>[n,i]));climate.dispose();
        const data={...fossilData}; const definition=fossilData['data/minecraft/worldgen/noise_settings/overworld.json'];
        data['data/minecraft/worldgen/noise_settings/overworld.json']={...definition,noise:{...definition.noise,min_y:0,height:16},noise_router:{...definition.noise_router,final_density:{type:'minecraft:add',left:-0.5,right:{type:'minecraft:beardifier'}}}};
        const calls=[];
        const sampler=createDensityTerrainSampler(kernel,'0',data,{solidState:1,airState:0,biomeIds,beardifierForChunk:(x,z)=>{calls.push([x,z]);return x===0?{pieces:[{box:{minX:0,minY:0,minZ:0,maxX:15,maxY:15,maxZ:15},terrainAdjustment:'encapsulate'}],affectedBox:{minX:-24,minY:-24,minZ:-24,maxX:39,maxY:39,maxZ:39}}:{};}});
        try {assert.ok(sampler.sampleChunk(0,0).blocks.some(v=>v===1));assert.ok(sampler.sampleChunk(1,0).blocks.every(v=>v===0));assert.deepEqual(calls,[[0,0],[1,0]]);}finally{sampler.dispose();}
    });
});
