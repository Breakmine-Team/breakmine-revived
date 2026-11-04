import { createDecorationRegion } from './decoration-region.mjs';
import { collectDecorationBiomes, createBiomeFeatureSorter, decorateVanillaChunk } from './biome-decoration.mjs';
import { createWorldgenFeatureRegistry } from './feature-resources.mjs';
import { createConfiguredFeaturePlacer } from './features.mjs';

const now = () => globalThis.performance?.now?.() ?? Date.now();
const DISABLED_DECORATION_BLOCKS = new Set(['minecraft:leaf_litter']);

export function createChunkDecorationPipeline({ kernel, data, registry, biomeNames, possibleBiomeOrder, rules }) {
    if (typeof rules !== 'function' && typeof rules?.canStateSurvive !== 'function') throw new TypeError('Decoration needs native block survival rules');
    const sorter = createBiomeFeatureSorter(data, possibleBiomeOrder, { allowCycles: false });
    const featureRegistry = createWorldgenFeatureRegistry(data);
    return {
        decorate({ chunks, worldSeed, chunkX, chunkZ, profile }) {
            const setupStart = profile ? now() : 0;
            const region = createDecorationRegion({ chunks, registry, biomeNames, rules, seed: worldSeed, writeCenter: { chunkX, chunkZ }, writeRadius: 1, profile });
            if (profile) profile.regionSetupMs += now() - setupStart;
            if (typeof region.context.canStateSurvive !== 'function') throw new TypeError('Decoration needs native block survival rules');
            const neighborBiomeIds = collectDecorationBiomes(chunkX, chunkZ, region.biomesInChunk);
            const placeFeature = createConfiguredFeaturePlacer(data, {
                stateIdFor: region.stateIdFor,
                canSurvive: (state, pos, context) => {
                    if (profile) profile.survivalChecks++;
                    return context.canStateSurvive(state, pos);
                },
                setBlock: (state, pos, flags) => DISABLED_DECORATION_BLOCKS.has(state.name)
                    ? false
                    : region.setBlock(state, pos, flags),
                scheduleTick: region.scheduleTick,
                isDoublePlant: region.context.isDoublePlant,
                canPlaceDoublePlant: region.context.canPlaceDoublePlant,
                placeDoublePlant: region.context.placeDoublePlant
            });
            return region.transaction(() => {
                const report = decorateVanillaChunk({ kernel, worldSeed, chunkX, chunkZ, neighborBiomeIds,
                    sorter, featureRegistry, context: region.context, placeFeature, biomeAtBlock: region.biomeAtBlock });
                return { ...report, ticks: region.pendingTicks, postProcessing: region.postProcessing,
                    blockEntities: [...region.blockEntityData.values()], stage: 'decoration' };
            });
        }
    };
}
