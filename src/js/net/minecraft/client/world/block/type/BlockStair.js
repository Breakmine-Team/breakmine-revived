import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";

export default class BlockStair extends Block {

    static EAST = 0;
    static WEST = 1;
    static SOUTH = 2;
    static NORTH = 3;

    constructor(id, textureSlotId, woodId, description) {
        super(id, textureSlotId);
        this.woodId = woodId;
        this.description = description + " Stairs";
        this.hardness = 2.0;
        this.multipart = true;
        this.noFaceCull = true;
    }

    getPreferredToolType() {
        return 'axe';
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return true;
    }

    getTextureForFace(face, data) {
        const block = Block.getById(this.woodId);
        return block ? block.getTextureForFace(face) : 'oak_planks';
    }

    getBoundingBox(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const top = (data & 4) !== 0;

        if (!top) {
            return new BoundingBox(0, 0, 0, 1, 0.5, 1);
        } else {
            return new BoundingBox(0, 0.5, 0, 1, 1, 1);
        }
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    onBlockPlaced(world, x, y, z, face) {
        if (face === null) return;

        let player = world.minecraft?.player;
        if (!player) return;

        let dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
        let facing = [BlockStair.NORTH, BlockStair.EAST, BlockStair.SOUTH, BlockStair.WEST][dirIndex];
        let data = facing;

        if (face === EnumBlockFace.BOTTOM) {
            data |= 4;
        }

        world.setBlockDataAt(x, y, z, data);
    }

    getMultipart(world, x, y, z) {
        if (world === null) {
            return this.getModel(world, x, y, z);
        }

        const data = world.getBlockDataAt(x, y, z);
        const facing = data & 3;
        const top = (data & 4) !== 0;

        const boxes = this._getStairBoxesWithCorners(world, x, y, z, facing, top);
        return boxes.map(box => ["block", this.woodId, box]);
    }

    getModel(world, x, y, z) {
        const boxes = this._getStairBoxes(BlockStair.EAST, false);
        return [
            ["block", this.woodId, boxes[0]],
            ["block", this.woodId, boxes[1]],
        ];
    }

    _isStair(world, x, y, z, top) {
        const neighborId = world.getBlockAt(x, y, z);
        if (neighborId === this.id) {
            const neighborData = world.getBlockDataAt(x, y, z);
            const neighborTop = (neighborData & 4) !== 0;
            if (neighborTop === top) {
                return neighborData & 3;
            }
        }
        return null;
    }

    _getDirectionOffsets(facing) {
        switch (facing) {
            case BlockStair.EAST:  return { front: [1, 0],  back: [-1, 0], left: [0, -1], right: [0, 1] };
            case BlockStair.WEST:  return { front: [-1, 0], back: [1, 0],  left: [0, 1],  right: [0, -1] };
            case BlockStair.SOUTH: return { front: [0, 1],  back: [0, -1], left: [1, 0],  right: [-1, 0] };
            case BlockStair.NORTH: return { front: [0, -1], back: [0, 1],  left: [-1, 0], right: [1, 0] };
        }
    }

    _isOppositeFacing(facing1, facing2) {
        return (facing1 === BlockStair.EAST && facing2 === BlockStair.WEST) ||
               (facing1 === BlockStair.WEST && facing2 === BlockStair.EAST) ||
               (facing1 === BlockStair.NORTH && facing2 === BlockStair.SOUTH) ||
               (facing1 === BlockStair.SOUTH && facing2 === BlockStair.NORTH);
    }

    _getEffectiveShape(world, x, y, z, top) {
        const facing = this._isStair(world, x, y, z, top);
        if (facing === null) return null;

        const offsets = this._getDirectionOffsets(facing);
        
        const frontFacing = this._isStair(world, x + offsets.front[0], y, z + offsets.front[1], top);
        if (frontFacing !== null && !this._isOppositeFacing(facing, frontFacing)) {
            const leftFacing = this._isStair(world, x + offsets.left[0], y, z + offsets.left[1], top);
            const rightFacing = this._isStair(world, x + offsets.right[0], y, z + offsets.right[1], top);

            if (frontFacing === this._getRotatedFacing(facing, 1) && leftFacing !== facing) {
                return { facing, shape: "inner_left" };
            } else if (frontFacing === this._getRotatedFacing(facing, -1) && rightFacing !== facing) {
                return { facing, shape: "inner_right" };
            }
        }

        const backFacing = this._isStair(world, x + offsets.back[0], y, z + offsets.back[1], top);
        if (backFacing !== null && !this._isOppositeFacing(facing, backFacing)) {
            if (backFacing === this._getRotatedFacing(facing, 1)) {
                return { facing, shape: "outer_left" };
            } else if (backFacing === this._getRotatedFacing(facing, -1)) {
                return { facing, shape: "outer_right" };
            }
        }

        return { facing, shape: "straight" };
    }

    _getStairBoxesWithCorners(world, x, y, z, facing, top) {
        const yBase0 = top ? 0.5 : 0;
        const yBase1 = top ? 1.0 : 0.5;
        const yStep0 = top ? 0 : 0.5;
        const yStep1 = top ? 0.5 : 1.0;

        const baseBox = new BoundingBox(0, yBase0, 0, 1, yBase1, 1);
        const offsets = this._getDirectionOffsets(facing);

        const frontShape = this._getEffectiveShape(world, x + offsets.front[0], y, z + offsets.front[1], top);
        let innerCornerDirection = null;

        if (frontShape !== null && !this._isOppositeFacing(facing, frontShape.facing)) {
            const leftShape = this._getEffectiveShape(world, x + offsets.left[0], y, z + offsets.left[1], top);
            const rightShape = this._getEffectiveShape(world, x + offsets.right[0], y, z + offsets.right[1], top);

            if (frontShape.facing === this._getRotatedFacing(facing, 1) && (!leftShape || leftShape.facing !== facing)) {
                innerCornerDirection = "left";
            } else if (frontShape.facing === this._getRotatedFacing(facing, -1) && (!rightShape || rightShape.facing !== facing)) {
                innerCornerDirection = "right";
            }
        }

        const backShape = this._getEffectiveShape(world, x + offsets.back[0], y, z + offsets.back[1], top);
        let outerCornerDirection = null;

        if (backShape !== null && innerCornerDirection === null && !this._isOppositeFacing(facing, backShape.facing)) {
            if (backShape.facing === this._getRotatedFacing(facing, 1)) {
                outerCornerDirection = "left";
            } else if (backShape.facing === this._getRotatedFacing(facing, -1)) {
                outerCornerDirection = "right";
            }
        }

        let stepBoxes = [];

        if (outerCornerDirection) {
            stepBoxes = [this._getStepQuadrant(facing, outerCornerDirection, yStep0, yStep1)];
        } else if (innerCornerDirection) {
            stepBoxes = this._getInnerCornerStepBoxes(facing, innerCornerDirection, yStep0, yStep1);
        } else {
            stepBoxes = [this._getStandardStepBox(facing, yStep0, yStep1)];
        }

        return [baseBox, ...stepBoxes];
    }

    _getRotatedFacing(facing, dir) {
        const order = [BlockStair.NORTH, BlockStair.EAST, BlockStair.SOUTH, BlockStair.WEST];
        let idx = order.indexOf(facing);
        idx = (idx + dir + 4) % 4;
        return order[idx];
    }

    _getStandardStepBox(facing, y0, y1) {
        switch (facing) {
            case BlockStair.EAST:  return new BoundingBox(0, y0, 0, 0.5, y1, 1);
            case BlockStair.WEST:  return new BoundingBox(0.5, y0, 0, 1, y1, 1);
            case BlockStair.SOUTH: return new BoundingBox(0, y0, 0, 1, y1, 0.5);
            case BlockStair.NORTH: return new BoundingBox(0, y0, 0.5, 1, y1, 1);
        }
    }

    _getStepQuadrant(facing, side, y0, y1) {
        const key = `${facing}_${side}`;
        switch (key) {
            case `${BlockStair.EAST}_left`:   return new BoundingBox(0, y0, 0, 0.5, y1, 0.5);
            case `${BlockStair.EAST}_right`:  return new BoundingBox(0, y0, 0.5, 0.5, y1, 1);
            case `${BlockStair.WEST}_left`:   return new BoundingBox(0.5, y0, 0.5, 1, y1, 1);
            case `${BlockStair.WEST}_right`:  return new BoundingBox(0.5, y0, 0, 1, y1, 0.5);
            case `${BlockStair.SOUTH}_left`:  return new BoundingBox(0.5, y0, 0, 1, y1, 0.5);
            case `${BlockStair.SOUTH}_right`: return new BoundingBox(0, y0, 0, 0.5, y1, 0.5);
            case `${BlockStair.NORTH}_left`:  return new BoundingBox(0, y0, 0.5, 0.5, y1, 1);
            case `${BlockStair.NORTH}_right`: return new BoundingBox(0.5, y0, 0.5, 1, y1, 1);
        }
    }

    _getInnerCornerStepBoxes(facing, extraSide, y0, y1) {
        const mainStep = this._getStandardStepBox(facing, y0, y1);
        
        // Place the 3rd quadrant on the FRONT side of the stair step
        let extraCorner = null;
        switch (facing) {
            case BlockStair.EAST:
                // Main step is WEST (x: 0 - 0.5). Front extra quadrant is EAST (x: 0.5 - 1.0).
                extraCorner = (extraSide === "left") 
                    ? new BoundingBox(0.5, y0, 0, 1.0, y1, 0.5)     // North/Left front
                    : new BoundingBox(0.5, y0, 0.5, 1.0, y1, 1.0);  // South/Right front
                break;

            case BlockStair.WEST:
                // Main step is EAST (x: 0.5 - 1.0). Front extra quadrant is WEST (x: 0 - 0.5).
                extraCorner = (extraSide === "left") 
                    ? new BoundingBox(0, y0, 0.5, 0.5, y1, 1.0)     // South/Left front
                    : new BoundingBox(0, y0, 0, 0.5, y1, 0.5);     // North/Right front
                break;

            case BlockStair.SOUTH:
                // Main step is NORTH (z: 0 - 0.5). Front extra quadrant is SOUTH (z: 0.5 - 1.0).
                extraCorner = (extraSide === "left") 
                    ? new BoundingBox(0.5, y0, 0.5, 1.0, y1, 1.0)   // East/Left front
                    : new BoundingBox(0, y0, 0.5, 0.5, y1, 1.0);   // West/Right front
                break;

            case BlockStair.NORTH:
                // Main step is SOUTH (z: 0.5 - 1.0). Front extra quadrant is NORTH (z: 0 - 0.5).
                extraCorner = (extraSide === "left") 
                    ? new BoundingBox(0, y0, 0, 0.5, y1, 0.5)       // West/Left front
                    : new BoundingBox(0.5, y0, 0, 1.0, y1, 0.5);   // East/Right front
                break;
        }

        return [mainStep, extraCorner];
    }

    _getStairBoxes(facing, top) {
        const y0 = top ? 0 : 0.5;
        const y1 = top ? 0.5 : 1;
        const baseBox = top ? new BoundingBox(0, 0.5, 0, 1, 1, 1) : new BoundingBox(0, 0, 0, 1, 0.5, 1);
        const stepBox = this._getStandardStepBox(facing, y0, y1);
        return [baseBox, stepBox];
    }

    shouldRenderFace(world, x, y, z, face) {
        if (world === null) return true;
        const data = world.getBlockDataAt(x, y, z);
        const isTop = (data & 4) !== 0;

        if (isTop && face === EnumBlockFace.BOTTOM) return true;
        if (!isTop && face === EnumBlockFace.TOP) return true;

        const neighborId = world.getBlockAtFace(x, y, z, face);
        if (neighborId === 0) return true;

        const neighbor = Block.getById(neighborId);
        if (!neighbor) return true;

        return !(neighbor.isSolid() && !neighbor.isTranslucent() && !neighbor.noFaceCull && !neighbor.multipart && !neighbor.path);
    }
}