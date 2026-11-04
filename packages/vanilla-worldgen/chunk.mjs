import { createClimateRouter } from './density.mjs';
import { createMaterialRuleEvaluator } from './material-rules.mjs';
import { applyMaterialRulesToChunk, createMaterialSurfaceSampler } from './material-surface.mjs';
import { createKernelEndBiomeSource } from './end-biome-source.mjs';

export function createNoiseTerrainSampler(kernel,seed,data,options={}) {
    return createDensityTerrainSampler(kernel,seed,data,{...options,fluids:options.settings === 'end' ? false : true});
}

export function createDensityTerrainSampler(kernel, seed, data, { settings = 'overworld', solidState, airState, biomeIds, fluids=false, waterState, lavaState, applySurfaceRules = false, blockStates, beardifierForChunk, batchMaterialDensitySampling = false, cacheSurfaceBiomeSamples = true, experimentalScalarMemoReuse = false, experimentalBatchDensityQueries = false, cacheWrapperPrototype = false, cacheWrapperProfile = false, excludedBiomes = [] } = {}) {
    if (beardifierForChunk !== undefined && typeof beardifierForChunk !== 'function') throw new TypeError('Expected beardifierForChunk(chunkX,chunkZ)');
    if (!['overworld','large_biomes','amplified','nether','end'].includes(settings)) throw new Error(`Density terrain not ported: ${settings}`);
    if (settings === 'end' && fluids) throw new Error('End has no aquifer fluid sampler');
    if (![solidState,airState].every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff) || solidState === airState) throw new RangeError('Supply distinct solid and air block-state IDs');
    const definition = data[`data/minecraft/worldgen/noise_settings/${settings}.json`];
    if (!definition?.noise_router || !definition.noise) throw new Error(`Missing noise settings: ${settings}`);
    if (applySurfaceRules && (!blockStates || typeof blockStates !== 'object' || !definition.material_rule)) throw new Error('Surface-rule generation requires a blockStates map and a vanilla material_rule root');
    const { min_y: minY, height } = definition.noise;
    if (fluids && (![waterState,lavaState].every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff) || new Set([solidState,airState,waterState,lavaState]).size!==4)) throw new RangeError('Supply distinct solid, air, water and lava state IDs');
    const aquifers = fluids && definition.aquifers ? Object.fromEntries(Object.keys(definition.aquifers).map(key=>[key,`aquifer/${key}`])) : null;
    const roots = {final:definition.noise_router.final_density};
    if (aquifers) for (const [key,name] of Object.entries(aquifers)) roots[name]=definition.aquifers[key];
    const materialDensityRoots = {};
    if ((fluids || applySurfaceRules) && settings !== 'nether') {
        const materialRule = definition.material_rule;
        const seen = new Set();
        const visitRule = rule => {
            if (typeof rule === 'string') {
                if (seen.has(rule)) return;
                seen.add(rule);
                const child = data[`data/minecraft/worldgen/material_rule/${rule.slice('minecraft:'.length)}.json`];
                if (!child) throw new Error(`Missing material rule resource: ${rule}`);
                visitRule(child);
                return;
            }
            if (!rule || typeof rule !== 'object') return;
            if (rule.type === 'minecraft:ore_vein') {
                for (const field of ['density','richness','filler_gap']) {
                    const id = rule[field];
                    if (typeof id !== 'string' || !id.startsWith('minecraft:')) throw new Error(`Invalid ore-vein ${field} in ${materialRule}`);
                    const root = `material:${id}`;
                    roots[root] = id;
                    materialDensityRoots[id] = root;
                }
            } else if (rule.type === 'minecraft:sequence' && Array.isArray(rule.sequence)) {
                rule.sequence.forEach(visitRule);
            } else if (rule.type === 'minecraft:condition') {
                visitRule(rule.then_run);
            }
        };
        if (typeof materialRule === 'string' && materialRule.startsWith('minecraft:')) visitRule(materialRule);
    }
    if (applySurfaceRules) roots.surface = definition.noise_router.chunk_surface_level;
    const defaultFluid = (typeof definition.default_fluid==='string' ? definition.default_fluid : definition.default_fluid?.Name) === 'minecraft:lava' ? 3 : 2;
    const density = kernel.density(seed,data,roots,{legacyRandom:!!definition.legacy_random_source,
        experimentalScalarMemoReuse, experimentalBatchDensityQueries, cacheWrapperPrototype, cacheWrapperProfile});
    let climate;
    let endBiomes;
    let materialSampler;
    try {
        if (settings === 'end') endBiomes = createKernelEndBiomeSource(kernel, seed, data);
        else climate = createClimateRouter(kernel,seed,data,settings,{experimentalScalarMemoReuse, experimentalBatchDensityQueries, cacheWrapperPrototype, cacheWrapperProfile, excludedBiomes});
        if (applySurfaceRules) materialSampler = createMaterialSurfaceSampler(kernel, seed, data, { blockStates });
        const biomeNames = endBiomes?.biomes ?? (() => {
            const preset = kernel.climate(settings === 'nether' ? 'nether' : 'overworld', { excludeBiomes: excludedBiomes });
            try { return preset.biomes; } finally { preset.dispose(); }
        })();
        for (const name of biomeNames) {
            if (!Number.isInteger(biomeIds?.[name]) || biomeIds[name] < 0 || biomeIds[name] > 65535) throw new RangeError(`Missing biome ID: ${name}`);
        }
        if (applySurfaceRules && settings === 'end' && blockStates['minecraft:end_stone'] !== solidState) {
            throw new Error('End material rule requires solidState to map to minecraft:end_stone');
        }
    } catch (error) { density.dispose(); climate?.dispose(); endBiomes?.dispose(); materialSampler?.dispose(); throw error; }
    const ids = { ...biomeIds };
    const biomeNamesById = [];
    for (const [name, id] of Object.entries(ids)) biomeNamesById[id] = name;
    let surfaceBiomeQueries = 0, surfaceBiomeCacheHits = 0, surfaceBiomeRouterCalls = 0;
    const materialEvaluator = applySurfaceRules ? createMaterialRuleEvaluator(data, { blockStates }) : null;
    const fluidStateIds = new Set(fluids ? [waterState, lavaState] : []);
    const cacheWrapperInstrumentation = cacheWrapperPrototype || cacheWrapperProfile;
    return {
        sampleChunk(chunkX,chunkZ) {
            if (cacheWrapperInstrumentation) { density.cacheBeginContext(); climate?.cacheBeginContext(); }
            if (![chunkX,chunkZ].every(v=>Number.isInteger(v) && v >= -134217728 && v <= 134217726)) throw new RangeError('Chunk exceeds Java block coordinates');
            if (beardifierForChunk) {
                const structures = beardifierForChunk(chunkX,chunkZ);
                if (!structures || typeof structures !== 'object' || typeof structures.then === 'function') throw new TypeError('Chunk beardifier context must be synchronous and explicit');
                density.setBeardifier(structures);
            }
            const chunk = new VanillaChunk(chunkX,chunkZ,minY,height);
            const values = fluids
                ? density.sampleAquiferVolume('final',chunkX*16,minY,chunkZ*16,16,height,16,{fields:aquifers,seaLevel:definition.sea_level,defaultFluid})
                : density.sampleVolume('final',chunkX*16,minY,chunkZ*16,16,height,16);
            if (fluids) chunk.fluidUpdates = new Uint8Array(chunk.blocks.length);
            for (let z=0;z<16;z++) for (let x=0;x<16;x++) for (let dy=0;dy<height;dy++) {
                const value = values[(z*16+x)*height+dy];
                const kind = fluids ? value&15 : value>0 ? 0 : 1;
                const index=dy*256+z*16+x;
                chunk.blocks[index] = [solidState,airState,waterState,lavaState][kind];
                if (fluids) chunk.fluidUpdates[index] = kind>=2 && (value&16) ? 1 : 0;
                if (kind!==1) chunk.heightmap[z*16+x] = minY+dy+1;
            }
            let batchedBiomeIds = null;
            if (experimentalBatchDensityQueries && climate) {
                const positions = new Int32Array((height / 4) * 16 * 3);
                let offset = 0;
                for (let y=minY;y<minY+height;y+=4) for (let z=0;z<16;z+=4) for (let x=0;x<16;x+=4) {
                    positions[offset++] = chunkX * 16 + x;
                    positions[offset++] = y;
                    positions[offset++] = chunkZ * 16 + z;
                }
                batchedBiomeIds = climate.biomeAtQuartBatch(positions).map(name => ids[name]);
            }
            let biomeIndex = 0;
            for (let y=minY;y<minY+height;y+=4) for (let z=0;z<16;z+=4) for (let x=0;x<16;x+=4) {
                const biome = batchedBiomeIds
                    ? batchedBiomeIds[biomeIndex++]
                    : endBiomes
                        ? ids[endBiomes.biomeAtQuart(chunkX*4+x/4,y/4,chunkZ*4+z/4)]
                        : ids[climate.biomeAtQuart(chunkX*4+x/4,y/4,chunkZ*4+z/4)];
                chunk.setBiome(x,y,z,biome);
            }
            let materialDensityVolumes = null;
            if (applySurfaceRules && batchMaterialDensitySampling && Object.keys(materialDensityRoots).length) {
                materialDensityVolumes = Object.fromEntries(Object.entries(materialDensityRoots).map(([id, root]) => [id,
                    density.sampleVolume(root, chunkX * 16, minY, chunkZ * 16, 16, height, 16)]));
            }
            const preliminarySurfaceValues = experimentalBatchDensityQueries && applySurfaceRules
                ? density.sampleMany('surface', (() => {
                    const positions = new Int32Array(256 * 3);
                    let offset = 0;
                    for (let z=0;z<16;z++) for (let x=0;x<16;x++) {
                        positions[offset++] = chunkX * 16 + x;
                        positions[offset++] = 0;
                        positions[offset++] = chunkZ * 16 + z;
                    }
                    return positions;
                })()) : null;
            if (applySurfaceRules) applyMaterialRulesToChunk(chunk, {
                evaluator: materialEvaluator,
                ruleId: definition.material_rule,
                materialSampler,
                airState,
                fluidStates: fluidStateIds,
                samplePreliminarySurface: (x, z) => preliminarySurfaceValues
                    ? preliminarySurfaceValues[(z - chunkZ * 16) * 16 + x - chunkX * 16]
                    : density.sample('surface', x, 0, z),
                sampleDensity: (id, x, y, z) => {
                    const root = materialDensityRoots[id];
                    if (!root) throw new Error(`Material density is unavailable for ${settings}: ${id}`);
                    if (materialDensityVolumes) {
                        const localX = x - chunkX * 16, localZ = z - chunkZ * 16;
                        if (localX < 0 || localX >= 16 || localZ < 0 || localZ >= 16 || y < minY || y >= minY + height) {
                            throw new RangeError('Batched material density sample escaped its terrain chunk');
                        }
                        return materialDensityVolumes[id][(localZ * 16 + localX) * height + y - minY];
                    }
                    return density.sample(root, x, y, z);
                },
                seaLevel: definition.sea_level,
                biomeAt: (x, y, z) => {
                    surfaceBiomeQueries++;
                    const localX = x - chunkX * 16, localZ = z - chunkZ * 16;
                    if (cacheSurfaceBiomeSamples && localX >= 0 && localX < 16 && localZ >= 0 && localZ < 16 && y >= minY && y < minY + height) {
                        const index = Math.floor((y - minY) / 4) * 16 + Math.floor(localZ / 4) * 4 + Math.floor(localX / 4);
                        const biome = biomeNamesById[chunk.biomes[index]];
                        if (!biome) throw new Error(`Missing cached surface biome ID: ${chunk.biomes[index]}`);
                        surfaceBiomeCacheHits++;
                        return biome;
                    }
                    surfaceBiomeRouterCalls++;
                    return endBiomes
                        ? endBiomes.biomeAtQuart(Math.floor(x / 4), Math.floor(y / 4), Math.floor(z / 4))
                        : climate.biomeAtQuart(Math.floor(x / 4), Math.floor(y / 4), Math.floor(z / 4));
                }
            });
            return chunk;
        },
        sampleBiomeAtQuart(x, y, z) {
            return endBiomes
                ? endBiomes.biomeAtQuart(x, y, z)
                : climate.biomeAtQuart(x, y, z);
        },
        sampleCarvingAquiferVolume(chunkX, chunkZ) {
            if (!fluids || !aquifers) throw new Error(`Carving aquifer is unavailable for ${settings}`);
            return density.sampleCarvingAquiferVolume('final', chunkX * 16, minY, chunkZ * 16, 16, height, 16,
                { fields: aquifers, seaLevel: definition.sea_level, defaultFluid });
        },
        topMaterialAt(chunk, x, y, z, fluid) {
            if (!applySurfaceRules || !materialSampler || !materialEvaluator) throw new Error('Native top material needs the vanilla material-rule sampler');
            const lx = x - chunk.chunkX * 16, lz = z - chunk.chunkZ * 16;
            if (lx < 0 || lx > 15 || lz < 0 || lz > 15) throw new RangeError('Top-material query escaped its target chunk');
            const gradientX = chunk.heightmap[lz * 16 + Math.min(15, lx + 1)] - chunk.heightmap[lz * 16 + Math.max(0, lx - 1)];
            const gradientZ = chunk.heightmap[Math.min(15, lz + 1) * 16 + lx] - chunk.heightmap[Math.max(0, lz - 1) * 16 + lx];
            const biomeId = chunk.biomes[Math.floor((y - minY) / 4) * 16 + Math.floor(lz / 4) * 4 + Math.floor(lx / 4)];
            const biome = biomeNamesById[biomeId];
            if (!biome) throw new Error(`Missing biome name for ID ${biomeId}`);
            const column = materialSampler.createColumn({ x, z, surfaceGradientX: gradientX, surfaceGradientZ: gradientZ,
                preliminarySurfaceValue: density.sample('surface', x, 0, z), seaLevel: definition.sea_level,
                minY, maxY: minY + height, biome });
            const context = column.atY(y, { waterHeight: fluid ? y + 1 : -0x80000000,
                stoneDepthAbove: 1, stoneDepthBelow: 1, biome });
            return materialEvaluator.evaluate(definition.material_rule, context);
        },
        profileSnapshot() { return { surfaceBiomeQueries, surfaceBiomeCacheHits, surfaceBiomeRouterCalls,
            ...(cacheWrapperInstrumentation ? { densityCache: density.cacheStats(), climateCache: climate?.cacheStats() ?? { wrappers: [], bytes: 0 } } : {}) }; },
        cacheResetStats() { if (cacheWrapperInstrumentation) { density.cacheResetStats(); climate?.cacheResetStats(); } },
        sampleMaterialDensity(id,x,y,z) {
            const root = materialDensityRoots[id];
            if (!root) throw new Error(`Material density is unavailable for ${settings}: ${id}`);
            return density.sample(root,x,y,z);
        },
        dispose() { density.dispose(); climate?.dispose(); endBiomes?.dispose(); materialSampler?.dispose(); }
    };
}

export class VanillaChunk {
    constructor(chunkX, chunkZ, minY = -64, height = 384) {
        if (![chunkX, chunkZ, minY, height].every(Number.isSafeInteger) || minY % 16 || height <= 0 || height % 16) {
            throw new RangeError('Invalid chunk coordinates or vertical range');
        }
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.minY = minY;
        this.height = height;
        this.blocks = new Uint32Array(16 * 16 * height);
        this.biomes = new Uint16Array(4 * 4 * (height / 4));
        this.heightmap = new Int32Array(256).fill(minY);
    }

    index(x, y, z) {
        if (![x,y,z].every(Number.isInteger) || x < 0 || x >= 16 || z < 0 || z >= 16 || y < this.minY || y >= this.minY + this.height) {
            throw new RangeError('Block is outside chunk bounds');
        }
        return (y - this.minY) * 256 + z * 16 + x;
    }

    setBlock(x,y,z,stateId) {
        if (!Number.isInteger(stateId) || stateId < 0 || stateId > 0xffffffff) throw new RangeError('Invalid block state ID');
        this.blocks[this.index(x,y,z)] = stateId;
    }

    getBlock(x,y,z) { return this.blocks[this.index(x,y,z)]; }

    setBiome(x,y,z,biomeId) {
        this.index(x,y,z);
        if (!Number.isInteger(biomeId) || biomeId < 0 || biomeId > 65535) throw new RangeError('Invalid biome ID');
        this.biomes[Math.floor((y - this.minY) / 4) * 16 + Math.floor(z / 4) * 4 + Math.floor(x / 4)] = biomeId;
    }

    serialize() {
        return { format: 'breakmine:vanilla-chunk-v1', chunkX: this.chunkX, chunkZ: this.chunkZ, minY: this.minY, height: this.height,
            blocks: this.blocks, biomes: this.biomes, heightmap: this.heightmap,
            ...(this.fluidUpdates ? {fluidUpdates:this.fluidUpdates} : {}) };
    }
}
