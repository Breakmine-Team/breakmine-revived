import BoundingBox from "../../../../util/BoundingBox.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

const MAX_POWER = 15;
// Two game ticks per flip, so the clock changes state 10 times a second.
const TICK_DELAY = 2;

export default class BlockBluestoneClock extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Clock";
        this.hardness = 0.2;
        this.isPowerSource = true;
        this.inventoryTab = EnumCreativeInventoryTab.BLUESTONE;
        this.noFaceCull = true;
    }

    getAmbientOcclusion() { return false; }

    canCastAmbientOcclusion() { return false; }

    getOpacity() {
        return 0;
    }

    isSolid() { return false; }

    getBoundingBox(world, x, y, z) {
        return new BoundingBox(0, 0, 0, 1, 0.1875, 1);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    isOn(world, x, y, z) {
        if (!world || typeof x !== 'number') return false;
        return (world.getBlockDataAt(x, y, z) & 1) === 1;
    }

    getFrontFace(world, x, y, z) {
        switch ((world.getBlockDataAt(x, y, z) >> 1) & 3) {
            case 1: return EnumBlockFace.WEST;
            case 2: return EnumBlockFace.NORTH;
            case 3: return EnumBlockFace.EAST;
            default: return EnumBlockFace.SOUTH;
        }
    }

    getPower(world, x, y, z, face) {
        if (!this.isOn(world, x, y, z)) return 0;
        if (face === undefined || face === null) return MAX_POWER;
        return face === this.getFrontFace(world, x, y, z) ? MAX_POWER : 0;
    }

    getTextureForFace(face, data, x, y, z, world) {
        if (face === EnumBlockFace.TOP) {
            const on = (world && typeof x === 'number')
                ? (world.getBlockDataAt(x, y, z) & 1) === 1
                : (data & 1) === 1;
            return on ? 'bluestoneClockOn' : 'bluestoneClockOff';
        }
        return 'cobblestone_frame';
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return dirIndex << 1;
    }

    onBlockPlaced(world, x, y, z, face) {
        const player = world.minecraft?.player;

        if (player) {
            const dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
            const currentState = world.getBlockDataAt(x, y, z) & 1;

            world.setBlockDataAt(x, y, z, (dirIndex << 1) | currentState);
        }
    }

    getRotationForFace(face, data, x, y, z, world) {
        if (face === EnumBlockFace.TOP) {
            // The clock's front is drawn at the bottom of the texture, which
            // is the opposite of the repeater's indexing, so rotate backwards.
            return (-((data >> 1) & 3)) & 3;
        }
        return 0;
    }

    _notifyOutputs(world, x, y, z) {
        const offsets = [
            [1, 0, 0], [-1, 0, 0],
            [0, 0, 1], [0, 0, -1],
            [0, 1, 0], [0, -1, 0]
        ];

        world.notifyNeighborBlockChange(x, y, z);

        for (const [dx, dy, dz] of offsets) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;

            const neighbor = Block.getById(world.getBlockAt(nx, ny, nz));
            if (neighbor && (neighbor.isBluestoneDust || neighbor.isBluestoneRod)) {
                neighbor.onBlockTick(world, nx, ny, nz);
            }
        }
    }

    onBlockAdded(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, TICK_DELAY);
    }

    onNeighborBlockChange(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, TICK_DELAY);
    }

    onBlockTick(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;

        // Flip the output, then queue the next flip.
        const data = world.getBlockDataAt(x, y, z) || 0;
        world.setBlockDataAt(x, y, z, (data & ~1) | ((data & 1) ? 0 : 1));
        world.onBlockChanged(x, y, z);

        this._notifyOutputs(world, x, y, z);

        world.scheduleBlockTick(x, y, z, TICK_DELAY);
    }
}
