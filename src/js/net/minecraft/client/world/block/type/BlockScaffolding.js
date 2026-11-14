import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BoundingBox from "../../../../util/BoundingBox.js";

function scaffoldingTexture(face) {
    switch (face) {
        case EnumBlockFace.TOP:
            return 'scaffolding_top';
        case EnumBlockFace.BOTTOM:
            return 'scaffolding_bottom';
        default:
            return 'scaffolding_side';
    }
}

class ScaffoldingPart {
    constructor(topAlign) {
        this.topAlign = topAlign;
    }

    getTextureForFace(face) {
        return scaffoldingTexture(face);
    }

    getRotationForFace() {
        return 0;
    }

    getColor() {
        return 0xffffff;
    }

    isTranslucent() {
        return false;
    }

    // Renderer interface: translucent-looking parts must not hide other blocks,
    // but parts of the same multipart class may still cull their shared faces.
    occludesNeighborFaces() {
        return false;
    }
}

export default class BlockScaffolding extends Block {

    static TOP_PLATE = new BoundingBox(0.0, 0.875, 0.0, 1.0, 1.0, 1.0);

    static BOTTOM_RAIL = new BoundingBox(0.0, 0.0, 0.0, 1.0, 0.125, 1.0);
    static POSTS = [
        new BoundingBox(0.0, 0, 0.0, 0.125, 0.875, 0.125),
        new BoundingBox(0.875, 0, 0.0, 1.0, 0.875, 0.125),
        new BoundingBox(0.0, 0, 0.875, 0.125, 0.875, 1.0),
        new BoundingBox(0.875, 0, 0.875, 1.0, 0.875, 1.0)
    ];

    static PLATE_PART = new ScaffoldingPart(true);
    static FRAME_PART = new ScaffoldingPart(false);

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Scaffolding";
        this.hardness = 0.4;

        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;

        this.multipart = true;
    }

    getMultipart(world, x, y, z) {
        const parts = [
            ["blockClass", 0, { block: BlockScaffolding.PLATE_PART, bbox: BlockScaffolding.TOP_PLATE }]
        ];

        if (!this.hasScaffoldBelow(world, x, y, z)) {
            parts.push(["blockClass", 0, { block: BlockScaffolding.FRAME_PART, bbox: BlockScaffolding.BOTTOM_RAIL }]);
        }

        for (const post of BlockScaffolding.POSTS) {
            parts.push(["blockClass", 0, { block: BlockScaffolding.FRAME_PART, bbox: post }]);
        }
        return parts;
    }

    hasScaffoldBelow(world, x, y, z) {
        return world !== null && world !== undefined && world.getBlockAt(x, y - 1, z) === this.id;
    }

    
    usesMultipartShape() {
        return false;
    }

    getTextureForFace(face) {
        return scaffoldingTexture(face);
    }

    isSolid() {
        return false;
    }

    getCollisionBoundingBox(world, x, y, z) {
        return null;
    }

    getCollisionBoundingBoxFor(world, x, y, z, query) {
        if (!query) {
            return null;
        }

        if (query.sneaking === true) {
            return null;
        }

        if (query.downward === true) {
            return BlockScaffolding.TOP_PLATE;
        }

        const plateTop = BlockScaffolding.TOP_PLATE.maxY;
        if (query.region && query.region.minY >= y + plateTop - 1e-4) {
            return BlockScaffolding.TOP_PLATE;
        }
        return null;
    }

    isClimbable() {
        return true;
    }

    isTranslucent() {
        return true;
    }

    getOpacity() {
        return 0;
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }
}
