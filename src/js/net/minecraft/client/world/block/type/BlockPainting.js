import BoundingBox from "../../../../util/BoundingBox.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ItemEntity from "../../../entity/ItemEntity.js";

/**
 * A framed picture hanging on a wall.
 *
 * Paintings are ordinary blocks, so they need no entity or renderer of their
 * own: the block occupies the cell in front of the wall and its bounding box is
 * a 1/16 thick plate pressed against that wall, which makes the painting face
 * the room. `getBlockDataAt` stores the wall direction exactly like ladders do
 * (2 = -z, 3 = +z, 4 = -x, 5 = +x), so a painting follows the face it was
 * placed on and pops off when its supporting wall is removed.
 */
export default class BlockPainting extends Block {

    static FACE_OFFSETS = [
        [0, -1, 0],
        [0, 1, 0],
        [0, 0, -1],
        [0, 0, 1],
        [-1, 0, 0],
        [1, 0, 0]
    ];

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 0.5;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
        this.itemTextureInventory = textureName;
    }

    getRenderType() {
        // ITEM draws the flat texture as a billboard in the inventory and as
        // the thin bounding box in the world, which is what a painting wants.
        return BlockRenderType.ITEM;
    }

    getTextureForFace(face) {
        return this.textureName;
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        if (!world) {
            return true;
        }

        // The back of the plate lies exactly on the wall's surface, so drawing
        // it would z-fight with the wall texture. The other five faces form the
        // thin edge of the frame and the picture itself.
        const direction = world.getBlockDataAt(x, y, z);
        if (direction === 2 && face === EnumBlockFace.SOUTH) return false;
        if (direction === 3 && face === EnumBlockFace.NORTH) return false;
        if (direction === 4 && face === EnumBlockFace.EAST) return false;
        if (direction === 5 && face === EnumBlockFace.WEST) return false;
        return true;
    }

    canPlaceAt(world, x, y, z, face) {
        const direction = BlockPainting.getFaceDirection(face);
        if (direction < 2 || direction > 5) {
            return false;
        }

        const [dx, dy, dz] = BlockPainting.FACE_OFFSETS[direction];
        return world.isSolidBlockAt(x - dx, y - dy, z - dz);
    }

    getPlacementMetadata(world, x, y, z, face) {
        return BlockPainting.getFaceDirection(face);
    }

    onBlockPlaced(world, x, y, z, face) {
        if (face === null || face === undefined) {
            return;
        }
        world.setBlockDataAt(x, y, z, BlockPainting.getFaceDirection(face));
    }

    getBoundingBox(world, x, y, z) {
        const direction = world ? world.getBlockDataAt(x, y, z) : 2;
        switch (direction) {
            case 3:
                return new BoundingBox(0, 0, 0, 1, 1, 0.0625);
            case 4:
                return new BoundingBox(0.9375, 0, 0, 1, 1, 1);
            case 5:
                return new BoundingBox(0, 0, 0, 0.0625, 1, 1);
            case 2:
                return new BoundingBox(0, 0, 0.9375, 1, 1, 1);
            default:
                return new BoundingBox(0, 0, 0, 1, 1, 0.0625);
        }
    }

    getCollisionBoundingBox(world, x, y, z) {
        return null;
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    getOpacity() {
        return 0;
    }

    onNeighborBlockChange(world, x, y, z) {
        if (!this.canPlaceAt(world, x, y, z, world.getBlockDataAt(x, y, z))) {
            this.breakWithDrop(world, x, y, z);
        }
    }

    breakWithDrop(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        world.setBlockAt(x, y, z, 0);
        const [itemId, count] = this.getDrop(world, x, y, z);
        if (typeof world.dropItem === "function") {
            // Authoritative server: spawn the item and broadcast it to clients.
            world.dropItem(itemId, x, y, z);
        } else if (world.minecraft?.worldRenderer
            && typeof world.addEntity === "function"
            && (typeof world.minecraft.isSingleplayer !== "function" || world.minecraft.isSingleplayer())) {
            // Only predict the drop in a purely local world, so a supported
            // break in multiplayer does not spawn a second copy.
            for (let i = 0; i < count; i++) {
                world.addEntity(new ItemEntity(world.minecraft, world, itemId, x, y, z));
            }
        }
    }

    static getFaceDirection(face) {
        if (typeof face === "number") {
            return face;
        }
        if (face?.z === -1) return 2;
        if (face?.z === 1) return 3;
        if (face?.x === -1) return 4;
        if (face?.x === 1) return 5;
        return face?.y === 1 ? 1 : 0;
    }
}
