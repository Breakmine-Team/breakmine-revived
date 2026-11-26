import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const HALF = 0.5;

/**
 * A vertical slab: a half-width panel standing in one half of the cell at full
 * height, unlike the flat bottom/top half of a normal slab. It is its own block
 * with its own ids, so it can be placed next to a normal slab of the same
 * material without sharing block data with it.
 *
 * Block data stores which half holds the panel, using the same face numbers as
 * the rest of the game: 2 north, 3 south, 4 west, 5 east.
 */
export default class BlockVerticalSlab extends Block {

    // The half a panel occupies when placed against each clicked face: a panel
    // placed on the north face of a block sits against it, in the south half.
    static OPPOSITE = {2: 3, 3: 2, 4: 5, 5: 4};

    // The one face of the cell that is cut in two, i.e. the face the panel
    // shows towards the empty half of its own cell. It is never culled by a
    // neighbour because the empty half is part of this same cell.
    static CUT_FACE = {
        2: {x: 0, y: 0, z: 1},
        3: {x: 0, y: 0, z: -1},
        4: {x: 1, y: 0, z: 0},
        5: {x: -1, y: 0, z: 0}
    };

    constructor(id, textureSlotId, textureName, displayName, sound = null, options = {}) {
        super(id, textureSlotId);
        this.textureName = textureName;
        this.description = displayName;
        this.hardness = options.hardness ?? 2.0;
        this.tool = options.tool ?? null;
        if (sound) {
            this.sound = sound;
        }

        // The panel fills half a cell. Neighbours must keep the faces they
        // show into this cell's empty half instead of culling them against a
        // block that only covers part of the boundary.
        this.noFaceCull = true;

        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getPreferredToolType() {
        return this.tool;
    }

    isSolid() {
        return false;
    }

    occludesNeighborFaces() {
        return false;
    }

    getTextureForFace(face, data, x, y, z, world) {
        return this.textureName;
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return true;
    }

    static normalizeFace(face) {
        if (typeof face === 'number') {
            return face;
        }
        if (!face) {
            return -1;
        }
        if (face.y > 0) return 1;
        if (face.y < 0) return 0;
        if (face.z < 0) return 2;
        if (face.z > 0) return 3;
        if (face.x < 0) return 4;
        if (face.x > 0) return 5;
        return -1;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const clicked = BlockVerticalSlab.normalizeFace(face);

        // Placed against a side, the panel hugs the block that was clicked.
        if (clicked >= 2 && clicked <= 5) {
            return BlockVerticalSlab.OPPOSITE[clicked];
        }

        // Placed on a floor or ceiling, stand it on the far side of the cell,
        // the way the player faces, so the cut face looks back at them. This
        // matches the side placements above, which always hug the clicked
        // block rather than the player.
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return [3, 4, 2, 5][dirIndex];
    }

    onBlockPlaced(world, x, y, z, face) {
        // setBlockAt has no click face to pass on; those placements are
        // corrected by the metadata the server sends back.
        if (!world || face === null || face === undefined) {
            return;
        }

        const player = world.minecraft ? world.minecraft.player : null;
        world.setBlockDataAt(x, y, z, this.getPlacementMetadata(
            world, x, y, z, face, player ? player.rotationYaw : 0
        ));
    }

    getBoundingBox(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 4;

        switch (data) {
            case 2:
                return new BoundingBox(0, 0, 0, 1, 1, HALF);
            case 3:
                return new BoundingBox(0, 0, HALF, 1, 1, 1);
            case 5:
                return new BoundingBox(HALF, 0, 0, 1, 1, 1);
            case 4:
            default:
                return new BoundingBox(0, 0, 0, HALF, 1, 1);
        }
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        if (world) {
            const cut = BlockVerticalSlab.CUT_FACE[world.getBlockDataAt(x, y, z)];
            if (cut && face.x === cut.x && face.y === cut.y && face.z === cut.z) {
                return true;
            }
        }

        const typeId = prefetchedTypeId !== undefined
            ? prefetchedTypeId
            : (world ? world.getBlockAtFace(x, y, z, face) : 0);
        if (typeId === 0) {
            return true;
        }

        const neighbour = Block.getById(typeId);
        if (neighbour === null) {
            return true;
        }

        // Only a block that fills the whole shared face may hide this one. A
        // partial neighbour (another vertical slab, a slab, a wall, leaves)
        // covers at most part of it, so the rest has to stay visible.
        return !(neighbour.isSolid() && neighbour.occludesNeighborFaces()
            && !neighbour.noFaceCull && !neighbour.multipart && !neighbour.path);
    }
}
