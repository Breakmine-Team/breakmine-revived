import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockLeave extends Block {

    static fancyLeaves = false;

    static setFancyLeaves(fancy) {
        BlockLeave.fancyLeaves = fancy === true;
    }

    constructor(id, textureSlotId, woodType = "oak", displayName = "Oak Leaves") {
        super(id, textureSlotId);
        this.description = displayName;
        this.woodType = woodType;
        this.hardness = 0.2;

        this.sound = Block.sounds.leaves;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face) {
        return BlockLeave.fancyLeaves
            ? `${this.woodType}_leaves`
            : `leaves_${this.woodType}_opaque`;
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        // Fancy leaves are layered, so keep every face.
        if (BlockLeave.fancyLeaves || !world) return true;

        // Fast leaves use glass-style culling: only hide the face against
        // another leaf of the same type.
        const typeId = prefetchedTypeId !== undefined
            ? prefetchedTypeId
            : world.getBlockAtFace(x, y, z, face);
        return typeId === 0 || typeId !== this.id;
    }

    isTranslucent() {
        return BlockLeave.fancyLeaves;
    }

    occludesNeighborFaces() {
        // Leaves are cutouts, so neighboring blocks must render their faces
        // behind them even when leaves use the fast opaque render pass.
        return false;
    }

    canCastAmbientOcclusion() {
        return true;
    }

    getDrop(world, x, y, z) {
        const rnd = Math.random();
        const rnd2 = Math.random();
        if (rnd2 > 0.5) {
            if (rnd < 0.4) {
                return [BlockRegistry.ITEM_APPLE.getId(), 1];
            } else {
                return [BlockRegistry.ITEM_STICK.getId(), 1];
            }
        }
    }

    getColor(world, x, y, z, face) {
        if (world === null) {
            return 0 << 16 | 255 << 8 | 0;
        }

        let temperature = world.getTemperature(x, y, z);
        let humidity = world.getHumidity(x, y, z);
        return world.minecraft.grassColorizer.getColor(temperature, humidity);
    }
}