import WorldClient from './WorldClient.js';
import stateRules from '../../../../../../packages/vanilla-worldgen/generated/block-rules.json' with { type: 'json' };
import registry from '../../../../../../packages/vanilla-worldgen/generated/block-states.json' with { type: 'json' };
import nativeShapes from '../../../../../../packages/vanilla-worldgen/generated/block-shapes.json' with { type: 'json' };
import { isFluidType, resolveNativeFluidState } from '../../../../../../packages/vanilla-worldgen/fluid-state.mjs';
import { nativeFluidFlow } from '../../../../../../packages/vanilla-gameplay/fluid-flow.mjs';
import { nativeStairShape } from './NativeBlockShapes.js';
import Block from './block/Block.js';
import EnumBlockFace from '../../util/EnumBlockFace.js';

const statesById = new Map(registry.states.map(state => [state.id, state]));
const statesByName = new Map();
for (const state of registry.states) {
    if (!statesByName.has(state.name)) statesByName.set(state.name, []);
    statesByName.get(state.name).push(state);
}

export default class VanillaPreviewWorld extends WorldClient {
    constructor(minecraft) {
        super(minecraft);
        this.vanillaPreview = true;
        this.vanillithPlayable = true;
        this.mobCombatEnabled = true;
        this.vanillithDirtyChunks = new Map();
        this.time = 6000;
        this.worldAgeTicks = 0;
        this.inhabitedTimeByChunk = new Map();
        this.moonBrightness = 1;
        this.animationTick = 0;
        this.skylightSubtracted = 0;
        this.nativeFluidStateCache = new Map();
    }

    onTick() {
        const player = this.minecraft.player;
        this.worldAgeTicks++;
        this.time = (this.time + 1) % 24000;
        const moonPhase = Math.floor(this.worldAgeTicks / 24000) % 8;
        this.moonBrightness = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75][moonPhase];
        if (player && Number.isFinite(player.x) && Number.isFinite(player.z)) {
            const chunkKey = `${Math.floor(player.x / 16)},${Math.floor(player.z / 16)}`;
            this.inhabitedTimeByChunk.set(chunkKey, (this.inhabitedTimeByChunk.get(chunkKey) ?? 0) + 1);
        }
        for (const entity of [...this.entities]) {
            if (entity !== player) {
                entity.spectator = false;
                entity.creative = false;
                entity.flying = false;
            } else if (this.vanillithPlayable) {
                entity.spectator = this.gameMode === 'spectator';
                entity.creative = this.gameMode === 'creative';
                if (entity.spectator) entity.flying = true;
                else if (!entity.creative) entity.flying = false;
            } else {
                entity.spectator = !this.mobCombatEnabled;
                entity.creative = false;
                entity.flying = !this.mobCombatEnabled;
            }
            entity.onUpdate();
            if (entity !== player && entity.isDead) this.removeEntityById(entity.id);
        }
        this.processBlockTicks();
        this.updateClouds();
        this.animationTick++;
        if (player && !this.minecraft.loadingScreen) {
            const chunkX = Math.floor(player.x / 16), chunkZ = Math.floor(player.z / 16);
            const lookAhead = (motion, coordinate) => Math.abs(motion ?? 0) >= 0.17 ? coordinate + Math.sign(motion) : coordinate;
            if (this.chunkProvider.requestStreamingDemand) this.chunkProvider.requestStreamingDemand(player);
            else if (this.chunkProvider.requestBackgroundDemand) this.chunkProvider.requestBackgroundDemand(player);
            else {
                const radius = Math.max(1, Math.min(6, Math.floor(this.minecraft.settings?.vanillithGenerationRadius ?? 3)));
                // Generate the whole nearby ring even while stationary, not just
                // the old decorated 3x3 that followed movement.
                Promise.resolve(this.chunkProvider.requestRadius(lookAhead(player.motionX, chunkX), lookAhead(player.motionZ, chunkZ), radius,
                    { decorateAll: true })).catch(error => {
                    this.chunkProvider.error = error;
                    this.vanillaPreviewError = error.message;
                });
            }
        }
    }

    getInhabitedTimeAt(x, z) {
        return this.inhabitedTimeByChunk.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`) ?? 0;
    }

    getNativeBlockStateAt(x, y, z) {
        const stateId = this.nativeChunks?.getBlockState(x, y, z);
        return stateId === undefined ? null : statesById.get(stateId) ?? null;
    }

    updateNativeStairShape(x, y, z) {
        const state = this.getNativeBlockStateAt(x, y, z);
        if (!state?.name?.endsWith('_stairs')) return;
        const { facing, half, shape } = state.properties;
        const nextShape = nativeStairShape(this, x, y, z, facing, half);
        if (shape === nextShape) return;
        const variant = this.getNativeRenderVariant(this.getBlockAt(x, y, z), { shape: nextShape });
        if (!variant) return;
        this.setBlockAt(x, y, z, variant.typeId, variant.data);
        this.minecraft.worldRenderer?.refreshEditedBlock(x, y, z);
    }

    getNativeBlockShapeAt(x, y, z, collision = false) {
        const stateId = this.nativeChunks?.getBlockState(x, y, z);
        if (stateId === undefined) return null;
        const ids = nativeShapes.states[stateId];
        return ids ? nativeShapes.shapes[ids[collision ? 1 : 0]] : null;
    }

    getRenderBlockShape(typeId, data = 0, collision = false) {
        const stateId = this.nativeStateFromRender?.(typeId, data);
        const ids = nativeShapes.states[stateId];
        return ids ? nativeShapes.shapes[ids[collision ? 1 : 0]] : null;
    }

    getNativeRenderVariant(typeId, changes) {
        const source = statesById.get(this.nativeStateFromRender?.(typeId, 0));
        if (!source) return null;
        const properties = { ...source.properties, ...changes };
        const state = statesByName.get(source.name)?.find(candidate =>
            Object.entries(properties).every(([key, value]) => candidate.properties?.[key] === value));
        const packed = state && this.chunkProvider.nativeRenderStateMap?.get(state.id);
        if (!Number.isInteger(packed)) return null;
        // Some unsupported states fall back to a legacy block ID. Do not
        // report a variant as available if that ID decodes to another state.
        const decoded = statesById.get(this.nativeStateFromRender?.(packed >> 4, packed & 15));
        if (!decoded || decoded.name !== state.name || Object.entries(changes).some(([key, value]) => decoded.properties?.[key] !== value)) return null;
        return { typeId: packed >> 4, data: packed & 15, state };
    }

    getNativeStateVariantAt(x, y, z, changes) {
        const source = this.getNativeBlockStateAt(x, y, z);
        if (!source) return null;
        const properties = { ...source.properties, ...changes };
        const state = statesByName.get(source.name)?.find(candidate =>
            Object.entries(properties).every(([key, value]) => candidate.properties?.[key] === value));
        const packed = state && this.chunkProvider.nativeRenderStateMap?.get(state.id);
        if (!Number.isInteger(packed) || Block.getById(packed >> 4)?.descriptor?.name !== source.name) return null;
        return { state, typeId: packed >> 4, data: packed & 15 };
    }

    setNativeStateAt(x, y, z, variant) {
        if (!variant || this.chunkProvider.nativeRenderStateMap?.get(variant.state.id) !== ((variant.typeId << 4) | variant.data)) return false;
        const oldType = this.getBlockAt(x, y, z);
        const oldState = this.getNativeBlockStateAt(x, y, z);
        if (oldState?.id === variant.state.id) return true;
        this.setBlockAt(x, y, z, variant.typeId, variant.data, null, variant.state.id);
        if (oldType === variant.typeId) this.notifyNeighborBlockChange(x, y, z);
        this.minecraft.worldRenderer?.refreshEditedBlock(x, y, z);
        return true;
    }

    hasNativeNeighborSignal(x, y, z) {
        const neighbors = [
            [1, 0, 0, EnumBlockFace.WEST], [-1, 0, 0, EnumBlockFace.EAST],
            [0, 0, 1, EnumBlockFace.NORTH], [0, 0, -1, EnumBlockFace.SOUTH],
            [0, -1, 0, EnumBlockFace.TOP], [0, 1, 0, EnumBlockFace.BOTTOM]
        ];
        return neighbors.some(([dx, dy, dz, face]) => {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            const block = Block.getById(this.getBlockAt(nx, ny, nz));
            if (!block) return false;
            return typeof block.getPower === 'function' ? block.getPower(this, nx, ny, nz, face) > 0 : !!block.isPowerSource;
        });
    }

    updateNativePoweredBlock(x, y, z) {
        if (this.updatingNativePower) return;
        const state = this.getNativeBlockStateAt(x, y, z);
        const name = state?.name;
        const door = name?.endsWith('_door');
        if (!door && !name?.endsWith('_trapdoor') && !name?.endsWith('_fence_gate')) return;
        const otherY = door ? y + (state.properties.half === 'upper' ? -1 : 1) : y;
        const other = door ? this.getNativeBlockStateAt(x, otherY, z) : null;
        if (door && (other?.name !== name || other.properties.half === state.properties.half)) return;
        const powered = this.hasNativeNeighborSignal(x, y, z) || (door && this.hasNativeNeighborSignal(x, otherY, z));
        if ((state.properties.powered === 'true') === powered && (!door || (other.properties.powered === 'true') === powered)) return;
        const changes = { powered: String(powered), open: String(powered) };
        const next = this.getNativeStateVariantAt(x, y, z, changes);
        const otherNext = door ? this.getNativeStateVariantAt(x, otherY, z, changes) : null;
        if (!next || door && !otherNext) return;
        this.updatingNativePower = true;
        try {
            this.setNativeStateAt(x, y, z, next);
            if (door) this.setNativeStateAt(x, otherY, z, otherNext);
        } finally {
            this.updatingNativePower = false;
        }
    }

    getMoonBrightness() {
        return this.moonBrightness;
    }

    getFluidState(x, y, z) {
        const stateId = this.nativeChunks?.getBlockState(x, y, z);
        if (stateId === undefined) return null;
        const rule = stateRules.states[stateId];
        if (!rule || rule.fluidEmpty) return null;
        if (this.nativeFluidStateCache.has(stateId)) return this.nativeFluidStateCache.get(stateId);
        const state = statesById.get(stateId);
        if (!state) throw new Error(`Missing native block state ${stateId} for fluid lookup`);
        const fluidState = resolveNativeFluidState(state, rule);
        if (!fluidState) return null;
        this.nativeFluidStateCache.set(stateId, fluidState);
        return fluidState;
    }

    getFluidFlowAt(x, y, z, fluid = this.getFluidState(x, y, z)) {
        return fluid ? nativeFluidFlow(this, x, y, z, fluid) : null;
    }

    getSpawnBlockRulesAt(x, y, z) {
        const stateId = this.nativeChunks?.getBlockState(x, y, z);
        return stateId === undefined ? null : stateRules.states[stateId] ?? null;
    }

    getPathfindingMalusAt(x, y, z) {
        const pathTypeAt = (bx, by, bz) => {
            const stateId = this.nativeChunks?.getBlockState(bx, by, bz);
            const state = stateId === undefined ? null : statesById.get(stateId);
            if (!state) return null;
            const name = state.name;
            const properties = state.properties ?? {};
            const rule = stateRules.states[stateId];
            if (name === 'minecraft:air' || name === 'minecraft:cave_air' || name === 'minecraft:void_air') return 'OPEN';
            if (name.endsWith('_trapdoor') || name === 'minecraft:lily_pad' || name === 'minecraft:big_dripleaf') return 'TRAPDOOR';
            if (name === 'minecraft:powder_snow') return 'POWDER_SNOW';
            if (name === 'minecraft:cactus' || name === 'minecraft:sweet_berry_bush') return 'DAMAGING';
            if (name === 'minecraft:honey_block') return 'STICKY_HONEY';
            if (name === 'minecraft:wither_rose' || name === 'minecraft:pointed_dripstone') return 'DAMAGE_CAUTIOUS';
            if (name === 'minecraft:oak_door' || name.endsWith('_door')) {
                if (properties.open === 'true') return 'DOOR_OPEN';
                return name === 'minecraft:iron_door' ? 'DOOR_IRON_CLOSED' : 'DOOR_WOOD_CLOSED';
            }
            if (name.endsWith('_rail')) return 'RAIL';
            if (name.endsWith('_leaves') || name === 'minecraft:azalea_leaves' || name === 'minecraft:flowering_azalea_leaves') return 'LEAVES';
            if (name.endsWith('_fence') || name.endsWith('_wall') || name.endsWith('_fence_gate') && properties.open !== 'true') return 'FENCE';
            if (name === 'minecraft:fire' || name === 'minecraft:soul_fire' || name === 'minecraft:magma_block' ||
                (name === 'minecraft:campfire' || name === 'minecraft:soul_campfire') && properties.lit === 'true') return 'FIRE';
            const fluid = this.getFluidState(bx, by, bz);
            if (fluid && !fluid.empty) return isFluidType(fluid, 'lava') ? 'LAVA' : 'WATER';
            if (rule?.solid) return 'BLOCKED';
            return 'OPEN';
        };
        const malus = {
            BLOCKED: -1, OPEN: 0, WALKABLE: 0, WALKABLE_DOOR: 0, TRAPDOOR: 0,
            POWDER_SNOW: -1, ON_TOP_OF_POWDER_SNOW: 0, FENCE: -1, LAVA: -1,
            WATER: 8, WATER_BORDER: 8, RAIL: 0, UNPASSABLE_RAIL: -1,
            FIRE_IN_NEIGHBOR: 8, FIRE: 16, DAMAGING_IN_NEIGHBOR: 8, DAMAGING: -1,
            DOOR_OPEN: 0, DOOR_WOOD_CLOSED: -1, DOOR_IRON_CLOSED: -1,
            BREACH: 4, LEAVES: -1, STICKY_HONEY: 8, COCOA: 0, DAMAGE_CAUTIOUS: 0,
            ON_TOP_OF_TRAPDOOR: 0, BIG_MOBS_CLOSE_TO_DANGER: 4
        };

        let type = pathTypeAt(x, y, z);
        if (type == null) return 0;
        if (type === 'OPEN') {
            const below = pathTypeAt(x, y - 1, z);
            const supportedTypes = {
                FIRE: 'FIRE', DAMAGING: 'DAMAGING', STICKY_HONEY: 'STICKY_HONEY',
                POWDER_SNOW: 'ON_TOP_OF_POWDER_SNOW', DAMAGE_CAUTIOUS: 'DAMAGE_CAUTIOUS',
                TRAPDOOR: 'ON_TOP_OF_TRAPDOOR'
            };
            type = supportedTypes[below] ?? 'WALKABLE';
        }
        if (malus[type] !== 0) return malus[type] ?? 0;

        // WalkNodeEvaluator.checkNeighbourBlocks inspects the surrounding
        // 3x3x3 cells (except the vertical center column) before accepting a
        // walkable node. Any non-zero neighbour malus rejects a stroll target.
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const neighbor = pathTypeAt(x + dx, y + dy, z + dz);
            if (neighbor === 'DAMAGING') return malus.DAMAGING_IN_NEIGHBOR;
            if (neighbor === 'FIRE' || neighbor === 'LAVA') return malus.FIRE_IN_NEIGHBOR;
            if (neighbor === 'WATER') return malus.WATER_BORDER;
        }
        return 0;
    }

    isInPowderSnow(entity) {
        const box = entity?.boundingBox;
        if (!box) return false;
        const minX = Math.floor(box.minX), maxX = Math.floor(box.maxX - 1e-7);
        const minY = Math.floor(box.minY), maxY = Math.floor(box.maxY - 1e-7);
        const minZ = Math.floor(box.minZ), maxZ = Math.floor(box.maxZ - 1e-7);
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const stateId = this.nativeChunks?.getBlockState(x, y, z);
                    if (stateId !== undefined && statesById.get(stateId)?.name === 'minecraft:powder_snow') return true;
                }
            }
        }
        return false;
    }
}
