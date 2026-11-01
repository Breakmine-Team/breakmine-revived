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

/**
 * Descriptor for one rendered part of the build.
 *
 * It deliberately is not a Block: BlockRenderer's hidden-face pass skips any
 * part whose block reports isTranslucent() (it assumes blending needs both
 * surfaces), and scaffolding's parts were drawn as the scaffolding block
 * itself. That left the parts' coplanar faces - the posts' tops against the
 * plate's underside, the posts' feet against the rail's top - drawn on top of
 * each other. Reporting each part as opaque lets that pass cull whichever
 * face another part (or a neighbouring block) actually covers.
 *
 * The rendering pass is not affected by this: whether a block is translucent
 * is decided from the block in the section mesh, not from the part.
 */
class ScaffoldingPart {
    constructor(topAlign) {
        // topAlign keeps a part anchored to the top of its texture instead of
        // the bottom (BlockRenderer shifts the sampled rows for short boxes).
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
}

/**
 * Scaffolding: an open framework block, built from parts like a fence or a
 * stair rather than drawn as one cube:
 *
 *   - a two-pixel plate across the top (walked on)
 *   - a two-pixel rail across the bottom
 *   - four corner posts joining them
 *
 * The sides and bottom carry no collision, so players walk through the
 * framework and climb it like a ladder (holding jump rises, sneaking descends,
 * letting go of the keys holds them in place). Only the thin plate at the top
 * is solid, and only for something coming down onto it, so a scaffold platform
 * can be walked on and still be entered from the side.
 */
export default class BlockScaffolding extends Block {

    // Top two pixels of the block: the part a player stands on. It is also the
    // one-way collision box (see getCollisionBoundingBoxFor).
    static TOP_PLATE = new BoundingBox(0.0, 0.875, 0.0, 1.0, 1.0, 1.0);

    // The rail across the bottom and the posts that connect it to the plate.
    static BOTTOM_RAIL = new BoundingBox(0.0, 0.0, 0.0, 1.0, 0.125, 1.0);
    static POSTS = [
        new BoundingBox(0.0, 0, 0.0, 0.125, 0.875, 0.125),
        new BoundingBox(0.875, 0, 0.0, 1.0, 0.875, 0.125),
        new BoundingBox(0.0, 0, 0.875, 0.125, 0.875, 1.0),
        new BoundingBox(0.875, 0, 0.875, 1.0, 0.875, 1.0)
    ];

    // The plate is anchored to the top rows of the textures, the rail to the
    // bottom rows, and the posts span between them.
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

        // A scaffold standing on another scaffold is one continuous column, so
        // the rail is only drawn at the bottom of a stack: in the middle it
        // would be a lid across the column you climb up through.
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

    /**
     * The frame is walked through, so the parts must not become the collision
     * shape (see getCollisionBoundingBoxFor) or the hit selection.
     */
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

        // Sneaking is how a player gets down: with the plate out of the way the
        // body drops into the framework, where the climb logic (isClimbable)
        // takes over and lowers them at the climbing speed.
        if (query.sneaking === true) {
            return null;
        }

        // Landing: only a downward sweep can catch the plate, which leaves
        // jumping up into the framework and climbing through it unblocked.
        if (query.downward === true) {
            return BlockScaffolding.TOP_PLATE;
        }

        // Sideways and step sweeps only see the plate once the entity's feet
        // are at or above it. Putting it in their way below that would turn
        // every scaffold into a one-block wall with no way to step up.
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
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }
}
