import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockEntityBluestoneRepeater from "../entity/BlockEntityBluestoneRepeater.js";

const DELAY_TICKS = 2;

export default class BlockBluestoneRepeater extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Repeater";
        this.hardness = 0.2;
        this.isBluestoneConsumer = true;
        this.isPowerSource = false; // Kept false so instance logic checks specific face power
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
        this.noFaceCull = true;
    }

    getAmbientOcclusion() { return false; }

    isSolid() { return false; }

    hasBlockEntity() { return true; }

    createBlockEntity(world, x, y, z) {
        return new BlockEntityBluestoneRepeater(world, x, y, z);
    }

    getBoundingBox(world, x, y, z) {
        return new BoundingBox(0, 0, 0, 1, 0.1875, 1);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    onBlockPlaced(world, x, y, z, face) {
        const player = world.minecraft?.player;
        if (!player) return;

        // Direction mapping: 0: SOUTH, 1: WEST, 2: NORTH, 3: EAST
        const dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
        const currentPower = world.getBlockDataAt(x, y, z) & 1;

        world.setBlockDataAt(x, y, z, (dirIndex << 1) | currentPower);

        // onBlockAdded ran before the direction was known, so re-check the
        // input now that the direction is set (an existing power source
        // behind the repeater turns it on immediately).
        this.updateState(world, x, y, z);
    }

    _getDirectionFaces(data) {
        const direction = (data >> 1) & 3; // 0: SOUTH, 1: WEST, 2: NORTH, 3: EAST
        
        switch (direction) {
            case 1: // WEST
                return { front: [ -1, 0, 0 ], back: [ 1, 0, 0 ], frontFace: EnumBlockFace.WEST };
            case 2: // NORTH
                return { front: [ 0, 0, -1 ], back: [ 0, 0, 1 ], frontFace: EnumBlockFace.NORTH };
            case 3: // EAST
                return { front: [ 1, 0, 0 ], back: [ -1, 0, 0 ], frontFace: EnumBlockFace.EAST };
            case 0: // SOUTH
            default:
                return { front: [ 0, 0, 1 ], back: [ 0, 0, -1 ], frontFace: EnumBlockFace.SOUTH };
        }
    }

    isPoweredFromInput(world, x, y, z) {
        const data = world.getBlockDataAt(x, y, z);
        const { back } = this._getDirectionFaces(data);
        
        const inputX = x + back[0];
        const inputY = y + back[1];
        const inputZ = z + back[2];

        const blockId = world.getBlockAt(inputX, inputY, inputZ);
        if (blockId === undefined || blockId === null || blockId === -1) return false;

        const block = Block.getById(blockId);
        if (!block) return false;

        if (typeof block.getPower === 'function') {
            return block.getPower(world, inputX, inputY, inputZ, this._getDirectionFaces(data).frontFace) > 0;
        }

        return block.isPowerSource;
    }

    getPower(world, x, y, z, face) {
        const data = world.getBlockDataAt(x, y, z);
        const isPowered = (data & 1) === 1;
        if (!isPowered) return 0;

        // If a query face is specified, only output power through the front face
        if (face !== undefined && face !== null) {
            const { frontFace } = this._getDirectionFaces(data);
            return face === frontFace ? 15 : 0;
        }

        return 15;
    }

    getTextureForFace(face, data, x, y, z, world) {
        const direction = (data >> 1) & 3;
        const isPowered = (data & 1) === 1;

        let frontFace = EnumBlockFace.SOUTH;
        let backFace = EnumBlockFace.NORTH;

        if (direction === 1) {
            frontFace = EnumBlockFace.WEST;
            backFace = EnumBlockFace.EAST;
        } else if (direction === 2) {
            frontFace = EnumBlockFace.NORTH;
            backFace = EnumBlockFace.SOUTH;
        } else if (direction === 3) {
            frontFace = EnumBlockFace.EAST;
            backFace = EnumBlockFace.WEST;
        }

        if (face === EnumBlockFace.TOP) return isPowered ? 'bluestoneRepeaterTopOn' : 'bluestoneRepeaterTopOff';
        if (face === EnumBlockFace.BOTTOM) return 'cobblestone_frame';
        if (face === backFace || face === frontFace) return 'bluestoneObserverBackOff';

        return 'cobblestone_frame';
    }

    getRotationForFace(face, data, x, y, z, world) {
        // The top face texture's "front" points SOUTH at rotation 0, which
        // matches the direction encoding (0: SOUTH, 1: WEST, 2: NORTH, 3: EAST).
        if (face === EnumBlockFace.TOP) {
            return ((data >> 1) & 3) || 0;
        }
        return 0;
    }

    _scheduleOutputNeighbors(world, x, y, z) {
        const data = world.getBlockDataAt(x, y, z);
        const { front } = this._getDirectionFaces(data);

        const outX = x + front[0];
        const outY = y + front[1];
        const outZ = z + front[2];

        world.scheduleBlockTick(outX, outY, outZ, 1);
        world.onBlockChanged(outX, outY, outZ);
    }

    updateState(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;

        const shouldPower = this.isPoweredFromInput(world, x, y, z);
        const currentData = world.getBlockDataAt(x, y, z);
        const currentPowerState = (currentData & 1) === 1;

        if (shouldPower !== currentPowerState) {
            const newData = (currentData & ~1) | (shouldPower ? 1 : 0);
            world.setBlockDataAt(x, y, z, newData);
            world.onBlockChanged(x, y, z);
            this._scheduleOutputNeighbors(world, x, y, z);
        }
    }

    onBlockAdded(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, DELAY_TICKS);
    }

    onNeighborBlockChange(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, DELAY_TICKS);
    }

    onBlockTick(world, x, y, z) {
        this.updateState(world, x, y, z);
    }
}