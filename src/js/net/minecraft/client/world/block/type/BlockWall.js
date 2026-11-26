import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const PIXEL = 1 / 16;

/**
 * A wall: a full height centre post with slightly lower arms that reach into
 * solid neighbours and other walls. The arms are computed from the world each
 * time the block is rendered, so they follow blocks being placed or broken
 * around it without storing anything in block data.
 *
 * The post is left out when a wall runs straight through, so the run reads as
 * one continuous beam instead of a row of columns. Ends, junctions and corners
 * keep it. Arms always reach the middle of the cell, so they stay connected when
 * the post is not drawn.
 */
export default class BlockWall extends Block {

    constructor(id, textureSlotId, textureName, displayName, sound = null, options = {}) {
        super(id, textureSlotId);
        this.textureName = textureName;
        this.description = displayName;
        this.hardness = options.hardness ?? 1.8;
        this.tool = options.tool ?? 'pickaxe';
        if (sound) {
            this.sound = sound;
        }

        this.multipart = true;
        this.noFaceCull = true;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getPreferredToolType() {
        return this.tool;
    }

    getTextureForFace(face, data, x, y, z, world) {
        return this.textureName;
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    static getPostBox() {
        return new BoundingBox(4 * PIXEL, 0, 4 * PIXEL, 12 * PIXEL, 1, 12 * PIXEL);
    }

    static getArmBox(dx, dz) {
        const top = 14 * PIXEL;
        const low = 5 * PIXEL;
        const high = 11 * PIXEL;
        const middle = 8 * PIXEL;

        if (dx === 1) {
            return new BoundingBox(middle, 0, low, 1, top, high);
        }
        if (dx === -1) {
            return new BoundingBox(0, 0, low, middle, top, high);
        }
        if (dz === 1) {
            return new BoundingBox(low, 0, middle, high, top, 1);
        }
        return new BoundingBox(low, 0, 0, high, top, middle);
    }

    // True when the two connections are opposite each other (north/south or
    // east/west), i.e. the wall passes straight through the cell.
    static isStraightThrough(connections) {
        if (connections.length !== 2) {
            return false;
        }
        const [a, b] = connections;
        return (a.dx !== 0 && b.dx !== 0) || (a.dz !== 0 && b.dz !== 0);
    }

    static canConnectTo(block) {
        if (block === null || block === undefined) {
            return false;
        }
        if (block instanceof BlockWall) {
            return true;
        }
        return block.isSolid() && block.multipart !== true;
    }

    getMultipart(world, x, y, z) {
        const neighbours = [
            {dx: 0, dz: -1}, {dx: 0, dz: 1},
            {dx: -1, dz: 0}, {dx: 1, dz: 0}
        ];

        // No world means an inventory or dropped item icon: draw the post and
        // every arm so it reads as a wall instead of a bare post.
        if (world === null) {
            const parts = [["block", this.id, BlockWall.getPostBox()]];
            for (const {dx, dz} of neighbours) {
                parts.push(["block", this.id, BlockWall.getArmBox(dx, dz)]);
            }
            return parts;
        }

        const connections = [];
        for (const {dx, dz} of neighbours) {
            const neighbour = Block.getById(world.getBlockAt(x + dx, y, z + dz));
            if (BlockWall.canConnectTo(neighbour)) {
                connections.push({dx, dz});
            }
        }

        const parts = [];
        if (!BlockWall.isStraightThrough(connections)) {
            parts.push(["block", this.id, BlockWall.getPostBox()]);
        }
        for (const {dx, dz} of connections) {
            parts.push(["block", this.id, BlockWall.getArmBox(dx, dz)]);
        }

        return parts;
    }
}
