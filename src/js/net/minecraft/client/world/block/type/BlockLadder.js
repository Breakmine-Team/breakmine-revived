import BoundingBox from "../../../../util/BoundingBox.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ItemEntity from "../../../entity/ItemEntity.js";

export default class BlockLadder extends Block {
    static FACE_OFFSETS = [
        [0, -1, 0],
        [0, 1, 0],
        [0, 0, -1],
        [0, 0, 1],
        [-1, 0, 0],
        [1, 0, 0]
    ];

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Ladder";
        this.hardness = 0.2;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
        this.itemTextureInventory = 'ladder';
    }

    getRenderType() {
        return BlockRenderType.ITEM;
    }

    getLightValue(world, x, y, z) {
        return 0;
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        return true;
    }

    canPlaceAt(world, x, y, z, face) {
        const direction = BlockLadder.getFaceDirection(face);
        if (direction < 2 || direction > 5) {
            return false;
        }

        const [dx, dy, dz] = BlockLadder.FACE_OFFSETS[direction];
        return world.isSolidBlockAt(x - dx, y - dy, z - dz);
    }

    getPlacementMetadata(world, x, y, z, face) {
        return BlockLadder.getFaceDirection(face);
    }

    onBlockPlaced(world, x, y, z, face) {
        if (face === null || face === undefined) {
            return;
        }
        world.setBlockDataAt(x, y, z, BlockLadder.getFaceDirection(face));
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

    isClimbable() {
        return true;
    }

    isTranslucent() {
        return true;
    }

    getOpacity() {
        return 0;
    }

    getTextureForFace(face) {
        return 'ladder';
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
            // Only predict the drop in a purely local world. In an integrated
            // or remote session the server runs the same neighbour hook and
            // broadcasts its own item; adding one locally as well made a
            // support break drop two ladders.
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