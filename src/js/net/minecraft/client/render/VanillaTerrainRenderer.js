import Block from '../world/block/Block.js';
import { BlockRegistry } from '../world/block/BlockRegistry.js';
import EnumCreativeInventoryTab from '../gui/EnumCreativeInventoryTab.js';
import BlockLiquid from '../world/block/type/BlockLiquid.js';
import BoundingBox from '../../util/BoundingBox.js';
import EnumBlockFace from '../../util/EnumBlockFace.js';
import GuiContainerStonecutter from '../gui/screens/container/GuiContainerStonecutter.js';
import manifest from '../../../../../../packages/vanilla-worldgen/generated/terrain-render.json' with { type: 'json' };
import decoration from '../../../../../../packages/vanilla-worldgen/generated/decoration-render.json' with { type: 'json' };
import features from '../../../../../../packages/vanilla-worldgen/generated/feature-render.json' with { type: 'json' };
import blockItems from '../../../../../../packages/vanilla-worldgen/generated/block-item-render.json' with { type: 'json' };
import registry from '../../../../../../packages/vanilla-worldgen/generated/block-states.json' with { type: 'json' };
import rules from '../../../../../../packages/vanilla-worldgen/generated/block-rules.json' with { type: 'json' };
import { nativeFeatureQuads } from './VanillaFeatureGeometry.js';
import { VANILLA_SOURCE_SHA } from '../../../../../../packages/vanilla-worldgen/chunk-session.mjs';
import { vanillaBlendedBiomeColor } from '../../../../../../packages/vanilla-worldgen/biome-tint.mjs';
import { getVanillaBlockDrop, getVanillaBlockDrops, hasVanillaBlockLootTable } from '../../../../../../packages/vanilla-gameplay/block-drops.mjs';
import { getVanillaMiningRule } from '../../../../../../packages/vanilla-gameplay/mining.mjs';
import { isExcludedVanillithContent } from '../../../../../../packages/vanilla-gameplay/content-policy.mjs';

const ownedBlocks = new Map();
const vanillaRenderedItems = new Map();
const pendingAtlases = new WeakMap();
const textureKey = name => `vanilla26_3:${name}`;
const faces = { up: EnumBlockFace.TOP, down: EnumBlockFace.BOTTOM, north: EnumBlockFace.NORTH,
    south: EnumBlockFace.SOUTH, east: EnumBlockFace.EAST, west: EnumBlockFace.WEST };
const lightingFaces = [EnumBlockFace.BOTTOM, EnumBlockFace.TOP, EnumBlockFace.NORTH,
    EnumBlockFace.SOUTH, EnumBlockFace.WEST, EnumBlockFace.EAST];
const grassPixels = Uint8Array.from(atob(manifest.grassColors.pixelsBase64), char => char.charCodeAt(0));
const foliagePixels = Uint8Array.from(atob(decoration.foliageColors.pixelsBase64), char => char.charCodeAt(0));
const renderBlocks = [...manifest.blocks, ...decoration.blocks, ...features.blocks, ...blockItems.blocks];
const renderTextures = { ...manifest.textures, ...decoration.textures, ...features.textures, ...blockItems.textures };

const bluestoneItems = () => ({
    'minecraft:redstone_block': BlockRegistry.BLUESTONE_BLOCK,
    'minecraft:redstone_lamp': BlockRegistry.BLUESTONE_LAMP,
    'minecraft:repeater': BlockRegistry.BLUESTONE_REPEATER,
    'minecraft:lever': BlockRegistry.ITEM_BLUESTONE_LEVER_PLACER
});

function bluestoneState(state) {
    const p = state.properties ?? {};
    if (state.name === 'minecraft:redstone_wire') return (BlockRegistry.BLUESTONE_DUST.id << 4) | Number(p.power ?? 0);
    if (state.name === 'minecraft:redstone_block') return BlockRegistry.BLUESTONE_BLOCK.id << 4;
    if (state.name === 'minecraft:redstone_lamp') return (BlockRegistry.BLUESTONE_LAMP.id << 4) | Number(p.lit === 'true');
    if (state.name === 'minecraft:repeater') {
        const direction = { south: 0, west: 1, north: 2, east: 3 }[p.facing] ?? 0;
        return (BlockRegistry.BLUESTONE_REPEATER.id << 4) | (direction << 1) | Number(p.powered === 'true');
    }
    if (state.name === 'minecraft:lever') {
        const mounted = p.face === 'ceiling' ? 1 : p.face === 'floor' ? 0 :
            ({ south: 2, north: 3, east: 4, west: 5 }[p.facing] ?? 0);
        return (BlockRegistry.BLUESTONE_LEVER.id << 4) | (mounted << 1) | Number(p.powered === 'true');
    }
    return null;
}

function blueOre(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
        const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
        if (r > 60 && r > g * 1.35 && r > b * 1.35) {
            pixels.data[i] = b;
            pixels.data[i + 1] = Math.min(255, g + Math.round((r - g) * .3));
            pixels.data[i + 2] = r;
        }
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
}

function useNativeContainer(name, world, x, y, z, button) {
    if (button === 2 && name === 'minecraft:stonecutter') {
        world.minecraft.displayScreen(new GuiContainerStonecutter(world.minecraft.player, { x, y, z }));
        return true;
    }
    if (button === 2 && (name.endsWith('_trapdoor') && name !== 'minecraft:iron_trapdoor' || name.endsWith('_fence_gate'))) {
        const state = world.getNativeBlockStateAt?.(x, y, z);
        if (!state || state.name !== name) return false;
        const open = state.properties?.open === 'true' ? 'false' : 'true';
        const variant = world.getNativeStateVariantAt?.(x, y, z, { open });
        if (!variant) return false;
        world.setNativeStateAt(x, y, z, variant);
        return true;
    }
    if (button === 2 && name.endsWith('_door') && name !== 'minecraft:iron_door') {
        const state = world.getNativeBlockStateAt?.(x, y, z);
        if (!state || state.name !== name) return false;
        const otherY = state.properties?.half === 'upper' ? y - 1 : y + 1;
        const other = world.getNativeBlockStateAt(x, otherY, z);
        const open = state.properties.open === 'true' ? 'false' : 'true';
        const variant = world.getNativeStateVariantAt?.(x, y, z, { open });
        if (!variant || other?.name !== name) return false;
        const otherVariant = world.getNativeStateVariantAt?.(x, otherY, z, { open });
        if (!otherVariant) return false;
        world.setNativeStateAt(x, y, z, variant);
        world.setNativeStateAt(x, otherY, z, otherVariant);
        return true;
    }
    const legacy = {
        'minecraft:crafting_table': BlockRegistry.CRAFTING_TABLE,
        'minecraft:chest': BlockRegistry.CHEST,
        'minecraft:furnace': BlockRegistry.FURNACE
    }[name];
    return legacy?.onMouseButton(world, x, y, z, button) ?? false;
}

function foliageColorForBiome(biomeId) {
    const biome = manifest.biomeTints[biomeId];
    if (!biome) throw new Error(`Unknown native foliage biome tint ID: ${biomeId}`);
    if (biome.effects.foliage_color) return parseInt(biome.effects.foliage_color.slice(1), 16);
    const temperature = Math.max(0, Math.min(1, biome.temperature));
    const downfall = Math.max(0, Math.min(1, biome.downfall)) * temperature;
    const pixel = (Math.floor((1 - temperature) * 255) + Math.floor((1 - downfall) * 255) * 256) * 3;
    return foliagePixels[pixel] << 16 | foliagePixels[pixel + 1] << 8 | foliagePixels[pixel + 2];
}
foliageColorForBiome.key = 'foliage';

function grassColorForBiome(biomeId) {
    const biome = manifest.biomeTints[biomeId];
    if (!biome) throw new Error(`Unknown native biome tint ID: ${biomeId}`);
    if (biome.effects.grass_color) return parseInt(biome.effects.grass_color.slice(1), 16);
    const temperature = Math.max(0, Math.min(1, biome.temperature));
    const downfall = Math.max(0, Math.min(1, biome.downfall)) * temperature;
    const pixel = (Math.floor((1 - temperature) * 255) + Math.floor((1 - downfall) * 255) * 256) * 3;
    const base = grassPixels[pixel] << 16 | grassPixels[pixel + 1] << 8 | grassPixels[pixel + 2];
    return biome.effects.grass_color_modifier === 'dark_forest'
        ? ((base & 0xfefefe) + 0x28340a >> 1) & 0xffffff
        : base;
}
grassColorForBiome.key = 'grass';

function waterColorForBiome(biomeId) {
    const biome = manifest.biomeTints[biomeId];
    if (!biome) throw new Error(`Unknown native water biome tint ID: ${biomeId}`);
    return parseInt(biome.effects.water_color.slice(1), 16);
}
waterColorForBiome.key = 'water';

function biomeTintRadius(world) {
    return world?.minecraft?.settings?.biomeBlendRadius ?? 2;
}

export function vanillaFoliageColor(world, x, y, z) {
    return vanillaBlendedBiomeColor(world, x, y, z, biomeTintRadius(world), foliageColorForBiome, 0x48b518);
}

export function vanillaBlockFoliageColor(world, name, x, y, z) {
    // BlockColors#createDefault in the reference JAR does not register a tint
    // source for cherry leaves, so their pink texture must remain untinted.
    if (name === 'minecraft:cherry_leaves') return 0xffffff;
    return vanillaFoliageColor(world, x, y, z);
}

export function vanillaGrassColor(world, x, y, z) {
    return vanillaBlendedBiomeColor(world, x, y, z, biomeTintRadius(world), grassColorForBiome, 0x7cbd6b);
}

class TerrainCube extends Block {
    constructor(id, descriptor) {
        super(id);
        this.descriptor = descriptor;
        this.isBluestoneConsumer = /(?:_door|_trapdoor|_fence_gate)$/.test(descriptor.name);
        this.description = descriptor.name.replace('redstone', 'bluestone');
        const mining = getVanillaMiningRule(descriptor.name);
        this.toolType = mining.toolType;
        this.nativeMinimumToolLevel = mining.minimumToolLevel;
        this.requiresToolForDrops = mining.requiresToolForDrops;
    }

    onMouseButton(world, x, y, z, button) {
        return useNativeContainer(this.descriptor.name, world, x, y, z, button);
    }
    onNeighborBlockChange(world, x, y, z) { world.updateNativePoweredBlock?.(x, y, z); }
    onBlockTick(world, x, y, z) { world.updateNativePoweredBlock?.(x, y, z); }
    pickedItem() { return vanillaRenderedItems.get(this.descriptor.name)?.id ?? this.id; }
    isReplaceable(world, x, y, z) {
        return world?.getSpawnBlockRulesAt?.(x, y, z)?.replaceable ?? rules.states[this.descriptor.stateId]?.replaceable ?? false;
    }

    getTextureForFace(face) {
        const name = face.getName();
        return textureKey(this.descriptor.faces[name === 'top' ? 'up' : name === 'bottom' ? 'down' : name]);
    }

    getHardness() { return rules.states[this.descriptor.stateId]?.destroySpeed ?? 1; }
    getPreferredToolType() { return this.toolType; }
    minimumToolLevel() { return this.nativeMinimumToolLevel; }

    getDrop(world, x, y, z) {
        const result = getVanillaBlockDrop(this.descriptor.name, this.descriptor.properties, this.id);
        return resolveNativeDrop(result, this.id);
    }

    getDrops(world, x, y, z, context = {}) {
        if (!hasVanillaBlockLootTable(this.descriptor.name)) return [[this.id, 1]];
        return getVanillaBlockDrops(this.descriptor.name, this.descriptor.properties, { ...context, world, x, y, z })
            .map(drop => [resolveNativeDropItem(drop.name, this.id), drop.count])
            .filter(drop => drop[0] > 0 && drop[1] > 0);
    }

    getRotationForFace(face) {
        const name = face.getName();
        return this.descriptor.faceRotations?.[name === 'top' ? 'up' : name === 'bottom' ? 'down' : name] ?? 0;
    }

    onRender(world, x, y, z, renderer) {
        if (!this.descriptor.elements) return false;
        if (this.descriptor.cutout || this.descriptor.name === 'minecraft:grass_block') renderer.tessellator.material.alphaTest = Math.max(renderer.tessellator.material.alphaTest, 0.1);
        for (const element of this.descriptor.elements) {
            const box = new BoundingBox(...element.from.map(v => v / 16), ...element.to.map(v => v / 16));
            for (const [name, entry] of Object.entries(element.faces)) {
                if (world && entry.cullface && !this.shouldRenderFace(world, x, y, z, faces[entry.cullface])) continue;
                renderer.renderFace(world, this, box, faces[name], this.getAmbientOcclusion() && !!world?.minecraft?.settings?.ambientOcclusion,
                    x, y, z, { texture: textureKey(entry.texture), uv: entry.uv,
                        color: entry.tintindex === 0 ? (this.descriptor.constantTint ??
                            (this.descriptor.foliage ? vanillaBlockFoliageColor(world, this.descriptor.name, x, y, z) : vanillaGrassColor(world, x, y, z))) : 0xffffff });
            }
        }
        return true;
    }

    isSolid() { return this.descriptor.name !== 'minecraft:powder_snow'; }

    shouldRenderFace(world, x, y, z, face) {
        const neighbor = Block.getById(world.getBlockAtFace(x, y, z, face));
        if (neighbor?.descriptor) return !nativeFaceOccludes(neighbor, face);
        return neighbor?.descriptor?.cutout || super.shouldRenderFace(world, x, y, z, face);
    }

    isTranslucent() { return this.descriptor.translucent; }
    getOpacity() { return this.isTranslucent() || this.descriptor.cutout ? 1 / 255 : 1; }
}

function nativeFaceOccludes(block, face) {
    const rule = rules.states[block.descriptor.stateId];
    const opposite = { top: 0, bottom: 1, north: 3, south: 2, west: 5, east: 4 }[face.getName()];
    return !block.descriptor.cutout && !!rule?.canOcclude && !!(rule.faces.occlusion & (1 << opposite));
}

function closestQuadFace(normal) {
    let closest = EnumBlockFace.TOP;
    let closestDot = 0;
    for (const face of lightingFaces) {
        const dot = normal[0] * face.x + normal[1] * face.y + normal[2] * face.z;
        if (dot > closestDot) {
            closest = face;
            closestDot = dot;
        }
    }
    return closest;
}

class FeatureModel extends Block {
    constructor(id, descriptor) {
        super(id); this.descriptor = descriptor; this.quads = nativeFeatureQuads(descriptor);
        this.isBluestoneConsumer = /(?:_door|_trapdoor|_fence_gate)$/.test(descriptor.name);
        this.description = descriptor.name.replace('redstone', 'bluestone');
        const mining = getVanillaMiningRule(descriptor.name);
        this.toolType = mining.toolType;
        this.nativeMinimumToolLevel = mining.minimumToolLevel;
        this.requiresToolForDrops = mining.requiresToolForDrops;
        const points = this.quads.flatMap(quad => quad.points);
        if (points.length) this.boundingBox = new BoundingBox(...[0,1,2].map(i => Math.min(...points.map(p => p[i]))),
            ...[0,1,2].map(i => Math.max(...points.map(p => p[i]))));
    }
    onMouseButton(world, x, y, z, button) {
        return useNativeContainer(this.descriptor.name, world, x, y, z, button);
    }
    onNeighborBlockChange(world, x, y, z) { world.updateNativePoweredBlock?.(x, y, z); }
    onBlockTick(world, x, y, z) { world.updateNativePoweredBlock?.(x, y, z); }
    pickedItem() { return vanillaRenderedItems.get(this.descriptor.name)?.id ?? this.id; }
    isReplaceable(world, x, y, z) {
        return world?.getSpawnBlockRulesAt?.(x, y, z)?.replaceable ?? rules.states[this.descriptor.stateId]?.replaceable ?? false;
    }
    isSolid() { return this.descriptor.solid; }
    getHardness() { return rules.states[this.descriptor.stateId]?.destroySpeed ?? 1; }
    getPreferredToolType() { return this.toolType; }
    minimumToolLevel() { return this.nativeMinimumToolLevel; }
    getDrop(world, x, y, z) {
        const result = getVanillaBlockDrop(this.descriptor.name, this.descriptor.properties, this.id);
        return resolveNativeDrop(result, this.id);
    }
    getDrops(world, x, y, z, context = {}) {
        if (!hasVanillaBlockLootTable(this.descriptor.name)) return [[this.id, 1]];
        return getVanillaBlockDrops(this.descriptor.name, this.descriptor.properties, { ...context, world, x, y, z })
            .map(drop => [resolveNativeDropItem(drop.name, this.id), drop.count])
            .filter(drop => drop[0] > 0 && drop[1] > 0);
    }
    canPlaceAt(world, x, y, z, playerBoundingBox) {
        const name = this.descriptor.name;
        if (name.endsWith('_door')) {
            if (y + 1 >= world.maxY) return false;
            const aboveId = world.getBlockAt(x, y + 1, z);
            const above = aboveId ? Block.getById(aboveId) : null;
            if (aboveId && !above?.isReplaceable(world, x, y + 1, z)) return false;
            const support = world.getSpawnBlockRulesAt?.(x, y - 1, z);
            if (support && !support.sturdyUp) return false;
            const upper = world.getNativeRenderVariant?.(this.id, { half: 'upper' });
            if (!upper) return false;
            const boxes = world.getRenderBlockShape?.(upper.typeId, upper.data, true) ?? [];
            return !playerBoundingBox || !boxes.some(([a,b,c,d,e,f]) =>
                playerBoundingBox.intersects(new BoundingBox(x+a, y+1+b, z+c, x+d, y+1+e, z+f)));
        }
        if (!['minecraft:sunflower', 'minecraft:lilac', 'minecraft:rose_bush', 'minecraft:peony',
            'minecraft:tall_grass', 'minecraft:large_fern', 'minecraft:tall_seagrass'].includes(name) ||
            this.descriptor.properties?.half !== 'lower') return true;
        const upper = renderBlocks.find(block => block.name === name && block.properties?.half === 'upper');
        if (!upper || !ownedBlocks.get(upper.stateId)) return false;
        const aboveId = world.getBlockAt(x, y + 1, z);
        const above = aboveId ? Block.getById(aboveId) : null;
        if (aboveId && !above?.isReplaceable(world, x, y + 1, z)) return false;
        const support = world.getSpawnBlockRulesAt?.(x, y - 1, z);
        if (support && !support.sturdyUp) return false;
        if (playerBoundingBox?.intersects(new BoundingBox(x, y + 1, z, x + 1, y + 2, z + 1))) return false;
        return true;
    }
    onBlockPlaced(world, x, y, z) {
        const name = this.descriptor.name;
        if (name.endsWith('_door') && this.descriptor.properties?.half === 'lower') {
            const above = world.getNativeBlockStateAt?.(x, y + 1, z);
            if (above?.name === name && above.properties?.half === 'upper') return;
            const upper = world.getNativeRenderVariant?.(this.id, { half: 'upper' });
            if (upper) world.setBlockAt(x, y + 1, z, upper.typeId, upper.data);
            return;
        }
        if (!['minecraft:sunflower', 'minecraft:lilac', 'minecraft:rose_bush', 'minecraft:peony',
            'minecraft:tall_grass', 'minecraft:large_fern', 'minecraft:tall_seagrass'].includes(name) ||
            this.descriptor.properties?.half !== 'lower') return;
        const upper = renderBlocks.find(block => block.name === name && block.properties?.half === 'upper');
        const upperBlock = upper && ownedBlocks.get(upper.stateId);
        if (upperBlock) world.setBlockAt(x, y + 1, z, upperBlock.id, 0);
    }
    onBlockRemoved(world, x, y, z) {
        const name = this.descriptor.name;
        if (!name.endsWith('_door')) return;
        if (world.getNativeBlockStateAt?.(x, y, z)?.name === name) return;
        const half = this.descriptor.properties?.half;
        const otherY = y + (half === 'upper' ? -1 : 1);
        const other = world.getNativeBlockStateAt?.(x, otherY, z);
        if (other?.name === name && other.properties?.half !== half) {
            world.setBlockAt(x, otherY, z, 0);
            world.minecraft.worldRenderer?.refreshEditedBlock(x, otherY, z);
        }
    }
    isTranslucent() { return !this.descriptor.solid; }
    canCastAmbientOcclusion() { return !!rules.states[this.descriptor.stateId]?.solidRender; }
    getOpacity() { return rules.states[this.descriptor.stateId]?.solidRender ? 1 : 1 / 255; }
    getLightValue() { return rules.states[this.descriptor.stateId]?.lightEmission ?? 0; }
    shouldRenderFace(world, x, y, z, face) {
        const neighbor = Block.getById(world.getBlockAtFace(x, y, z, face));
        return neighbor?.descriptor ? !nativeFaceOccludes(neighbor, face) : super.shouldRenderFace(world, x, y, z, face);
    }
    onRender(world, x, y, z, renderer) {
        const t = renderer.tessellator;
        if (this.descriptor.cutout) t.material.alphaTest = Math.max(t.material.alphaTest, 0.1);
        for (const quad of this.quads) {
            if (world && quad.cullface && !this.shouldRenderFace(world, x, y, z, faces[quad.cullface])) continue;
            const lightFace = closestQuadFace(quad.normal);
            const level = world ? renderer.getEffectiveLightLevel(world, x + lightFace.x, y + lightFace.y, z + lightFace.z, lightFace) : 15;
            const shadeFace = faces[quad.shadeDirectionOverride] ?? lightFace;
            const shade = shadeFace === EnumBlockFace.BOTTOM ? 0.5 : shadeFace.getShading();
            const brightness = (0.1 + 0.9 * level / 15) * shade;
            const color = quad.tintType === 'foliage' ? vanillaBlockFoliageColor(world, this.descriptor.name, x, y, z)
                : quad.tintType === 'grass' ? vanillaGrassColor(world, x, y, z) : 0xffffff;
            t.setColor(((color >> 16) & 255) / 255 * brightness, ((color >> 8) & 255) / 255 * brightness, (color & 255) / 255 * brightness);
            const uv = renderer.worldRenderer.textureAtlas.getUVs(textureKey(quad.texture));
            // Tessellator.draw reverses each quad's winding for the legacy
            // BlockRenderer faces. Native model faces are authored outward,
            // so reverse their vertices here to keep FrontSide culling correct.
            for (let i = quad.points.length - 1; i >= 0; i--) {
                const p = quad.points[i];
                t.addVertexWithUV((x & 15) + p[0], (y & 15) + p[1], (z & 15) + p[2],
                    uv.minU + quad.uv[i][0] / 16 * (uv.maxU - uv.minU), 1 - (uv.minV + quad.uv[i][1] / 16 * (uv.maxV - uv.minV)));
            }
        }
        return true;
    }
}

function resolveNativeDrop(result, fallbackBlockId) {
    if (result === null) return [0, 0];
    if (result === 'apple') return [BlockRegistry.ITEM_APPLE.id, 1];
    if (result === 'stick') return [BlockRegistry.ITEM_STICK.id, 1];
    if (typeof result === 'string' && result.startsWith('minecraft:')) {
        const canonical = vanillaRenderedItems.get(result);
        if (canonical) return [canonical.id, 1];
        const registeredItem = BlockRegistry.get(result);
        if (registeredItem && Number.isInteger(registeredItem.id)) return [registeredItem.id, 1];
        const candidates = renderBlocks.filter(block => block.name === result);
        const propertyPenalty = properties => (properties.stage && properties.stage !== '0' ? 8 : 0) +
            (properties.age && properties.age !== '0' ? 4 : 0) +
            (properties.hanging === 'true' ? 2 : 0) + (properties.waterlogged === 'true' ? 1 : 0);
        candidates.sort((a, b) => propertyPenalty(a.properties ?? {}) - propertyPenalty(b.properties ?? {}) || a.stateId - b.stateId);
        const descriptor = candidates[0];
        const block = descriptor && ownedBlocks.get(descriptor.stateId);
        return block ? [block.id, 1] : [0, 0];
    }
    return [Number.isInteger(result) ? result : fallbackBlockId, 1];
}

function resolveNativeDropItem(name, fallbackBlockId) {
    const canonical = vanillaRenderedItems.get(name);
    if (canonical) return canonical.id;
    const item = BlockRegistry.get(name);
    return Number.isInteger(item?.id) ? item.id : fallbackBlockId;
}

class NativePreviewFluid extends BlockLiquid {
    constructor(id, name) {
        super(id, id, name);
        this.name = name;
    }

    getTextureForFace(face) {
        return textureKey(`minecraft:block/${this.name}_${face === EnumBlockFace.TOP || face === EnumBlockFace.BOTTOM ? 'still' : 'flow'}`);
    }

    getColor(world, x, y, z) {
        if (this.name === 'lava') return 0xffffff;
        return vanillaBlendedBiomeColor(world, x, y, z, biomeTintRadius(world), waterColorForBiome, 0x3f76e4);
    }

    getLightValue() { return this.name === 'lava' ? 15 : 0; }
    isLava() { return this.name === 'lava'; }
}

async function prepare(atlas, loadImage) {
    if ([manifest, decoration, features, blockItems, registry].some(m => m.source.sha256 !== VANILLA_SOURCE_SHA)) throw new Error('Terrain render source mismatch');
    const checkAtlas = () => {
        if (!atlas.loaded || !atlas.canvas || !atlas.textureMap) throw new Error('Terrain texture atlas is not ready');
    };
    checkAtlas();
    const canvas = atlas.canvas;
    const missing = Object.entries(renderTextures).filter(([name]) => !atlas.textureMap.has(textureKey(name)));
    const checkCapacity = () => {
        if (!Number.isInteger(atlas._nextModIndex) || atlas._nextModIndex + missing.length > atlas.texturesPerRow ** 2) {
            throw new Error('Not enough terrain texture atlas slots');
        }
    };
    checkCapacity();
    const bluestoneTextures = {
        'minecraft:block/redstone_ore': 'bluestone_ore.png',
        'minecraft:block/redstone_torch': 'bluestone_torch.png',
        'minecraft:block/redstone_torch_off': 'bluestone_torch_off.png'
    };
    const images = await Promise.all(missing.map(([name, texture]) => loadImage(bluestoneTextures[name]
        ? `terrain/pack/minecraft/textures/blocks/${bluestoneTextures[name]}`
        : texture.frames?.[0] ?? texture.dataUrl)));
    for (let i = 0; i < missing.length; i++) {
        if (missing[i][0] === 'minecraft:block/deepslate_redstone_ore') {
            images[i] = blueOre(images[i]);
        }
    }
    for (const image of images) {
        if (image.width !== 16 || image.height !== 16) throw new Error('Unsupported terrain texture dimensions');
    }
    checkAtlas();
    if (atlas.canvas !== canvas) throw new Error('Terrain atlas was reloaded while decoding textures');
    checkCapacity();
    const animationImages = await Promise.all(missing.map(([, texture], index) => texture.frames?.length > 1
        ? Promise.all([images[index], ...texture.frames.slice(1).map(frame => loadImage(frame))]) : null));
    checkAtlas();
    if (atlas.canvas !== canvas) throw new Error('Terrain atlas was reloaded while decoding animation frames');
    const available = [];
    for (let id = 256; id <= 4095; id++) if (!Block.getById(id)) available.push(id);
    const needsBlock = descriptor => {
        const block = ownedBlocks.get(descriptor.stateId);
        return !block || Block.getById(block.id) !== block;
    };
    const fluidStates = registry.states.filter(state => ['minecraft:water', 'minecraft:lava'].includes(state.name));
    if (available.length < renderBlocks.filter(needsBlock).length + ['water', 'lava'].filter(name =>
        !ownedBlocks.get(`fluid:${name}`) || Block.getById(ownedBlocks.get(`fluid:${name}`).id) !== ownedBlocks.get(`fluid:${name}`)).length) {
        throw new Error('No free terrain render block IDs');
    }
    missing.forEach(([name], i) => {
        const metadata = renderTextures[name];
        if (animationImages[i] && atlas.registerAnimatedModTexture) atlas.registerAnimatedModTexture(textureKey(name), animationImages[i], metadata.animation);
        else atlas.registerModTexture(textureKey(name), images[i]);
        if (!atlas.textureMap.has(textureKey(name))) throw new Error(`Terrain texture registration failed: ${name}`);
    });
    const mapping = new Map();
    for (const descriptor of renderBlocks) {
        if (needsBlock(descriptor)) ownedBlocks.set(descriptor.stateId, descriptor.parts ? new FeatureModel(available.shift(), descriptor) : new TerrainCube(available.shift(), descriptor));
        mapping.set(descriptor.stateId, ownedBlocks.get(descriptor.stateId).id << 4);
        for (const stateId of descriptor.stateIds ?? []) mapping.set(stateId, ownedBlocks.get(descriptor.stateId).id << 4);
    }
    for (const name of ['water', 'lava']) {
        const key = `fluid:${name}`;
        if (!ownedBlocks.get(key) || Block.getById(ownedBlocks.get(key).id) !== ownedBlocks.get(key)) {
            ownedBlocks.set(key, new NativePreviewFluid(available.shift(), name));
        }
        for (const state of fluidStates) if (state.name === `minecraft:${name}`) {
            mapping.set(state.id, (ownedBlocks.get(key).id << 4) | Number(state.properties.level));
        }
    }
    for (const state of registry.states) if (['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(state.name)) mapping.set(state.id, 0);
    for (const state of registry.states) {
        const packed = bluestoneState(state);
        if (packed !== null) mapping.set(state.id, packed);
    }
    // Existing BreakMine blocks can provide a renderable item and interaction
    // while a dedicated native model for that block is not yet available.
    for (const state of registry.states) {
        if (mapping.has(state.id)) continue;
        const block = BlockRegistry.get(state.name);
        if (block && !block.isItem() && block.id > 0 && block.id <= 4095) mapping.set(state.id, block.id << 4);
    }
    // Powered and unpowered versions use identical models. Keep the native
    // powered state in the chunk while sharing the matching unpowered model.
    const rendered = new Set(renderBlocks.flatMap(block => [block.stateId, ...(block.stateIds ?? [])]));
    const byState = new Map(registry.states.map(state => [`${state.name}|${JSON.stringify(state.properties ?? {})}`, state]));
    for (const state of registry.states) {
        if (state.properties?.powered !== 'true' || !(state.name.endsWith('_door') || state.name.endsWith('_trapdoor') || state.name.endsWith('_fence_gate'))) continue;
        const base = byState.get(`${state.name}|${JSON.stringify({ ...state.properties, powered: 'false' })}`);
        if (base && rendered.has(base.id)) mapping.set(state.id, mapping.get(base.id));
    }
    return mapping;
}

export function prepareVanillaTerrainAtlas(atlas, loadImage = url => atlas.loadImage(url)) {
    const previous = pendingAtlases.get(atlas) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => prepare(atlas, loadImage));
    pendingAtlases.set(atlas, next);
    return next.finally(() => {
        if (pendingAtlases.get(atlas) === next) pendingAtlases.delete(atlas);
    });
}

export function registerVanillaRenderedBlockItems() {
    let registered = 0;
    vanillaRenderedItems.clear();
    for (const [name, stateId] of Object.entries(rules.defaults ?? {})) {
        if (isExcludedVanillithContent(name)) continue;
        if (name === 'minecraft:redstone_wire') continue;
        const bluestone = bluestoneItems()[name];
        if (bluestone) {
            vanillaRenderedItems.set(name, bluestone);
            continue;
        }
        const descriptor = renderBlocks.find(block => block.stateId === stateId || block.stateIds?.includes(stateId));
        const block = descriptor && ownedBlocks.get(descriptor.stateId);
        if (!block) continue;
        block.nativeBlockName = name;
        vanillaRenderedItems.set(name, block);
        // Keep the legacy registry aliases intact for BreakMine worlds. A
        // separate canonical map lets Vanillith recipes resolve to the exact
        // runtime block ID used by terrain, drops, picking and placement.
        if (BlockRegistry.registry.has(name)) continue;
        block.inventoryTab = /(_flower|_sapling|_leaves|_log|_wood|_coral|_plant|_tulip|_orchid|_fern|_grass|_mushroom|_vine|_bush|_roots|_petals|_propagule)$/.test(name)
            ? EnumCreativeInventoryTab.DECORATION
            : /(_ore|_wire|_lamp|_lever|_button|_pressure_plate|_repeater|_comparator|_piston|_observer)$/.test(name)
                ? EnumCreativeInventoryTab.MACHINES : EnumCreativeInventoryTab.BUILDING_BLOCKS;
        BlockRegistry.registry.set(name, block);
        registered++;
    }
    return { registered, items: new Map(vanillaRenderedItems) };
}
