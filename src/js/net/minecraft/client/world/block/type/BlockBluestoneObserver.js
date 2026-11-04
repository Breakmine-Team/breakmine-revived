import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockEntityBluestoneObserver from "../entity/BlockEntityBluestoneObserver.js";

export default class BlockBluestoneObserver extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Observer";
        this.hardness = 0.5;
        this.isPowerSource = false;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    isSolid() { return true; }

    hasBlockEntity() { return true; }

    createBlockEntity(world, x, y, z) {
        return new BlockEntityBluestoneObserver(world, x, y, z);
    }

    onBlockPlaced(world, x, y, z, face) {
        const player = world.minecraft?.player;
        if (!player) return;

        const dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
        const currentPower = world.getBlockDataAt(x, y, z) & 1;

        world.setBlockDataAt(x, y, z, (dirIndex << 1) | currentPower);
        this.updateState(world, x, y, z);
    }

    _getDirectionFaces(data) {
        const direction = (data >> 1) & 3;
        
        switch (direction) {
            case 1:
                return { front: [ -1, 0, 0 ], back: [ 1, 0, 0 ], frontFace: EnumBlockFace.WEST, backFace: EnumBlockFace.EAST };
            case 2: 
                return { front: [ 0, 0, -1 ], back: [ 0, 0, 1 ], frontFace: EnumBlockFace.NORTH, backFace: EnumBlockFace.SOUTH };
            case 3:
                return { front: [ 1, 0, 0 ], back: [ -1, 0, 0 ], frontFace: EnumBlockFace.EAST, backFace: EnumBlockFace.WEST };
            case 0:
            default:
                return { front: [ 0, 0, 1 ], back: [ 0, 0, -1 ], frontFace: EnumBlockFace.SOUTH, backFace: EnumBlockFace.NORTH };
        }
    }

    bluestoneConnectingFaces(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const { frontFace, backFace } = this._getDirectionFaces(data);
        return [frontFace, backFace];
    }

    hasBlockInFront(world, x, y, z) {
        const data = world.getBlockDataAt(x, y, z);
        const { front } = this._getDirectionFaces(data);

        const inFrontX = x + front[0];
        const inFrontY = y + front[1];
        const inFrontZ = z + front[2];

        const targetId = world.getBlockAt(inFrontX, inFrontY, inFrontZ);
        return targetId !== undefined && targetId !== null && targetId !== 0 && targetId !== -1;
    }

    getPower(world, x, y, z, face) {
        const data = world.getBlockDataAt(x, y, z);
        const isPowered = (data & 1) === 1;
        if (!isPowered) return 0;

        // Strictly output power through the back side (output) ONLY
        if (face !== undefined && face !== null) {
            const { backFace } = this._getDirectionFaces(data);
            return face === backFace ? 15 : 0;
        }

        return 15;
    }

    getTextureForFace(face, data, x, y, z, world) {
        if (face === EnumBlockFace.TOP || face === EnumBlockFace.BOTTOM) {
            return 'cobblestone_frame';
        }

        const isPowered = (data & 1) === 1;
        const { frontFace, backFace } = this._getDirectionFaces(data);

        if (face === frontFace) return 'bluestoneObserverFront';
        if (face === backFace) return isPowered ? 'bluestoneObserverBackOn' : 'bluestoneObserverBackOff';

        return 'cobblestone_frame';
    }

    _notifyNeighbors(world, x, y, z) {
        const data = world.getBlockDataAt(x, y, z);
        const { back } = this._getDirectionFaces(data);

        const outX = x + back[0];
        const outY = y + back[1];
        const outZ = z + back[2];

        world.scheduleBlockTick(outX, outY, outZ, 1);
        world.onBlockChanged(outX, outY, outZ);
    }

    updateState(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;

        const shouldPower = this.hasBlockInFront(world, x, y, z);
        const currentData = world.getBlockDataAt(x, y, z);
        const isCurrentlyPowered = (currentData & 1) === 1;

        if (shouldPower !== isCurrentlyPowered) {
            const newData = (currentData & ~1) | (shouldPower ? 1 : 0);
            world.setBlockDataAt(x, y, z, newData);
            world.onBlockChanged(x, y, z);
            this._notifyNeighbors(world, x, y, z);
        } else if (isCurrentlyPowered) {
            // Re-notify neighbors to ensure newly placed bluestone blocks sync with existing power state
            this._notifyNeighbors(world, x, y, z);
        }
    }

    onBlockAdded(world, x, y, z) {
        this.updateState(world, x, y, z);
        world.scheduleBlockTick(x, y, z, 1);
    }

    onNeighborBlockChange(world, x, y, z) {
        this.updateState(world, x, y, z);
        world.scheduleBlockTick(x, y, z, 1);
    }

    onBlockTick(world, x, y, z) {
        this.updateState(world, x, y, z);
    }
}