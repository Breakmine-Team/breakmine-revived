import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const MAX_LAYERS = 8;

/**
 * A pavement layer block in the style of snow layers. The low three metadata
 * bits store layers - 1, so data 0 is one 1/8 block layer and data 7 is a
 * full-height pavement block.
 */
export default class BlockPavementSlope extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 1.5;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
        this.noFaceCull = true;
        this.isPavementSlope = true;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    getTextureForFace(face) {
        return this.textureName;
    }

    static getLayerCount(data) {
        return Math.min(MAX_LAYERS, ((data ?? 0) & 7) + 1);
    }

    getLayerCount(data) {
        return BlockPavementSlope.getLayerCount(data);
    }

    getBoundingBox(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const height = this.getLayerCount(data) / MAX_LAYERS;
        return new BoundingBox(0, 0, 0, 1, height, 1);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        return 0;
    }

    // Layers are thin: a side face of a taller layer next to a shorter one is
    // visible, so let the mesher decide per face instead of culling the whole
    // block against a solid neighbour.
    shouldRenderFace(world, x, y, z, face) {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getAmbientOcclusion() {
        return true;
    }
}
