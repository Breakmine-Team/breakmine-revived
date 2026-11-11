import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockBed extends Block {

    static FOOT_ID = 410;
    static HEAD_ID = 411;

    static HEIGHT = 9 / 16;

    // Facing metadata: 0 = south (+Z), 1 = west (-X), 2 = north (-Z), 3 = east (+X).
    static OFFSETS = [
        [0, 1],
        [-1, 0],
        [0, -1],
        [1, 0]
    ];

    // The long side that is mirrored for each facing so the pillow/board end
    // lines up with the head direction.
    static SIDE_FLIP_FACE = [
        EnumBlockFace.EAST,
        EnumBlockFace.SOUTH,
        EnumBlockFace.WEST,
        EnumBlockFace.NORTH
    ];

    static getFacingFromYaw(yaw) {
        return Math.floor((yaw * 4 / 360) + 0.5) & 3;
    }

    static getDirectionIndex(face) {
        switch (face) {
            case EnumBlockFace.SOUTH: return 0;
            case EnumBlockFace.WEST: return 1;
            case EnumBlockFace.NORTH: return 2;
            case EnumBlockFace.EAST: return 3;
            default: return -1;
        }
    }

    constructor(id, textureSlotId, isHead = false) {
        super(id, textureSlotId);
        this.isHead = isHead;
        this.description = "Red Bed";
        this.hardness = 0.2;
        this.sound = Block.sounds.cloth;
        this.boundingBox = new BoundingBox(0, 0, 0, 1, BlockBed.HEIGHT, 1);
        this.inventoryTab = isHead
            ? EnumCreativeInventoryTab.NOTLISTED
            : EnumCreativeInventoryTab.DECORATION;
        this.noFaceCull = true;
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    getOpacity() {
        return 1 / 255;
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getCollisionBoundingBox() {
        return this.boundingBox;
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        if (face === EnumBlockFace.TOP) {
            return true;
        }

        // Faces shared horizontally with another bed are interior faces.
        if (world && face.y === 0) {
            const neighborId = prefetchedTypeId !== undefined
                ? prefetchedTypeId
                : world.getBlockAtFace(x, y, z, face);
            if (neighborId === BlockBed.FOOT_ID || neighborId === BlockBed.HEAD_ID) {
                return false;
            }
        }

        return super.shouldRenderFace(world, x, y, z, face, prefetchedTypeId);
    }

    getTextureForFace(face, data = 0) {
        const isHead = this.isHead;
        const top = isHead ? "bed_head_top" : "bed_feet_top";
        const side = isHead ? "bed_head_side" : "bed_feet_side";
        const end = isHead ? "bed_head_end" : "bed_feet_end";

        if (face === EnumBlockFace.TOP) return top;
        if (face === EnumBlockFace.BOTTOM) return side;

        const facing = data & 3;
        const endDirection = isHead ? facing : (facing + 2) & 3;
        return BlockBed.getDirectionIndex(face) === endDirection ? end : side;
    }

    getFlipForFace(face, data = 0) {
        const facing = data & 3;

        if (face === EnumBlockFace.TOP) {
            if (!this.isHead) {
                return Block.FLIP_BOTH;
            }
            return facing === 1 ? Block.FLIP_U : Block.FLIP_NONE;
        }

        return BlockBed.SIDE_FLIP_FACE[facing] === face ? Block.FLIP_U : Block.FLIP_NONE;
    }

    getRotationForFace(face, data = 0) {
        if (face !== EnumBlockFace.TOP) {
            return 0;
        }

        // The pillow is authored on the +X half. Quarter-turn the top face so
        // it points at the head end when the bed runs along the Z axis.
        const facing = data & 3;
        if (facing === 0) {
            return 3;
        }
        if (facing === 2) {
            return 1;
        }
        return 0;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        return BlockBed.getFacingFromYaw(yaw);
    }

    canPlaceAt(world, x, y, z, face) {
        if (!world || this.isHead) {
            return true;
        }

        const player = world.minecraft ? world.minecraft.player : null;
        const facing = BlockBed.getFacingFromYaw(player ? player.rotationYaw : 0);
        const [dx, dz] = BlockBed.OFFSETS[facing];

        const headId = world.getBlockAt(x + dx, y, z + dz);
        if (headId === 0) {
            return true;
        }

        const headBlock = Block.getById(headId);
        if (!headBlock || headBlock instanceof BlockBed) {
            return false;
        }
        return headBlock.isReplaceable(world, x + dx, y, z + dz);
    }

    onBlockPlaced(world, x, y, z, face) {
        if (!world || this.isHead || face === null || face === undefined) {
            return;
        }

        const player = world.minecraft ? world.minecraft.player : null;
        if (!player) {
            return;
        }

        const facing = BlockBed.getFacingFromYaw(player.rotationYaw);
        world.setBlockDataAt(x, y, z, facing);

        const [dx, dz] = BlockBed.OFFSETS[facing];
        const headX = x + dx;
        const headZ = z + dz;

        const headId = world.getBlockAt(headX, y, headZ);
        if (headId === BlockBed.HEAD_ID) {
            return;
        }

        const headBlock = Block.getById(headId);
        if (headId !== 0 && (!headBlock || !headBlock.isReplaceable(world, headX, y, headZ))) {
            return;
        }

        world.setBlockAt(headX, y, headZ, BlockBed.HEAD_ID, facing);
    }

    getDrop() {
        return [BlockBed.FOOT_ID, 1];
    }

    pickedItem() {
        return BlockBed.FOOT_ID;
    }

    onBlockRemoved(world, x, y, z) {
        if (!world) {
            return;
        }

        // Find the part that actually points at this cell so neighbouring beds
        // placed end to end are not removed by mistake.
        for (const [dx, dz] of BlockBed.OFFSETS) {
            const otherX = x + dx;
            const otherZ = z + dz;
            const otherId = world.getBlockAt(otherX, y, otherZ);
            if (otherId !== BlockBed.FOOT_ID && otherId !== BlockBed.HEAD_ID) {
                continue;
            }

            const otherFacing = world.getBlockDataAt(otherX, y, otherZ) & 3;
            const [facingX, facingZ] = BlockBed.OFFSETS[otherFacing];

            const pointsHere = otherId === BlockBed.HEAD_ID
                ? otherX - facingX === x && otherZ - facingZ === z
                : otherX + facingX === x && otherZ + facingZ === z;

            if (pointsHere) {
                world.setBlockAt(otherX, y, otherZ, 0);
                return;
            }
        }
    }
}
