import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockEntityBluestoneMemoryCell from "../entity/BlockEntityBluestoneMemoryCell.js";

export default class BlockBluestoneMemoryCell extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Memory Cell";
        this.hardness = 0.2;
        this.isBluestoneConsumer = true;
        this.isPowerSource = false; 
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
        this.noFaceCull = true;
    }

    getAmbientOcclusion() { return false; }

    canCastAmbientOcclusion() { return false; }

    getOpacity() {
        return 0;
    }

    isSolid() { return false; }

    hasBlockEntity() { return true; }

    createBlockEntity(world, x, y, z) {
        return new BlockEntityBluestoneMemoryCell(world, x, y, z);
    }

    getBoundingBox(world, x, y, z) {
        return new BoundingBox(0, 0, 0, 1, 0.1875, 1);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return dirIndex << 1;
    }

    onBlockPlaced(world, x, y, z, face) {
        const player = world.minecraft?.player;

        if (player) {
            const dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
            const currentPower = world.getBlockDataAt(x, y, z) & 1;

            world.setBlockDataAt(x, y, z, (dirIndex << 1) | currentPower);
        }

        this.updateState(world, x, y, z);
    }

    onMouseButton(world, x, y, z, button) {
        return false;
    }

    _getDirectionFaces(data) {
        const direction = (data >> 1) & 3; 

        switch (direction) {
            case 1: 
                return {
                    front: [ -1, 0, 0 ],    
                    back: [ 1, 0, 0 ],     
                    right: [ 0, 0, -1 ],   
                    frontFace: EnumBlockFace.WEST,
                    backFace: EnumBlockFace.EAST,
                    rightFace: EnumBlockFace.NORTH
                };
            case 2: 
                return {
                    front: [ 0, 0, -1 ],    
                    back: [ 0, 0, 1 ],     
                    right: [ 1, 0, 0 ],    
                    frontFace: EnumBlockFace.NORTH,
                    backFace: EnumBlockFace.SOUTH,
                    rightFace: EnumBlockFace.EAST
                };
            case 3: 
                return {
                    front: [ 1, 0, 0 ],     
                    back: [ -1, 0, 0 ],    
                    right: [ 0, 0, 1 ],    
                    frontFace: EnumBlockFace.EAST,
                    backFace: EnumBlockFace.WEST,
                    rightFace: EnumBlockFace.SOUTH
                };
            case 0: 
            default:
                return {
                    front: [ 0, 0, 1 ],     
                    back: [ 0, 0, -1 ],    
                    right: [ -1, 0, 0 ],   
                    frontFace: EnumBlockFace.SOUTH,
                    backFace: EnumBlockFace.NORTH,
                    rightFace: EnumBlockFace.WEST
                };
        }
    }

    _isPoweredAt(world, x, y, z, dx, dy, dz, targetFace) {
        const blockId = world.getBlockAt(x + dx, y + dy, z + dz);
        if (blockId === undefined || blockId === null || blockId === -1) return false;

        const block = Block.getById(blockId);
        if (!block) return false;

        if (typeof block.getPower === 'function') {
            return block.getPower(world, x + dx, y + dy, z + dz, targetFace) > 0;
        }

        return block.isPowerSource;
    }

    updateState(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;

        const data = world.getBlockDataAt(x, y, z);
        const { back, right, backFace, rightFace } = this._getDirectionFaces(data);
        const currentPowerState = (data & 1) === 1;

        const setPowered = this._isPoweredAt(world, x, y, z, right[0], right[1], right[2], rightFace);
        const resetPowered = this._isPoweredAt(world, x, y, z, back[0], back[1], back[2], backFace);

        let shouldPower = currentPowerState;
        if (setPowered) {
            shouldPower = true;
        } else if (resetPowered) {
            shouldPower = false;
        }

        if (shouldPower !== currentPowerState) {
            const newData = (data & ~1) | (shouldPower ? 1 : 0);
            world.setBlockDataAt(x, y, z, newData);
            world.onBlockChanged(x, y, z);
            this._scheduleOutputNeighbors(world, x, y, z);
        }
    }

    getPower(world, x, y, z, face) {
        const data = world.getBlockDataAt(x, y, z);
        const isPowered = (data & 1) === 1;
        if (!isPowered) return 0;

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
        let rightFace = EnumBlockFace.WEST;

        if (direction === 1) {
            frontFace = EnumBlockFace.WEST;
            backFace = EnumBlockFace.EAST;
            rightFace = EnumBlockFace.NORTH;
        } else if (direction === 2) {
            frontFace = EnumBlockFace.NORTH;
            backFace = EnumBlockFace.SOUTH;
            rightFace = EnumBlockFace.EAST;
        } else if (direction === 3) {
            frontFace = EnumBlockFace.EAST;
            backFace = EnumBlockFace.WEST;
            rightFace = EnumBlockFace.SOUTH;
        }

        if (face === EnumBlockFace.TOP) {
            if (!world) {
                return isPowered ? 'bluestoneMemoryTopOn' : 'bluestoneMemoryTopOff';
            }

            const { back, right, backFace, rightFace } = this._getDirectionFaces(data);
            const setPowered = this._isPoweredAt(world, x, y, z, right[0], right[1], right[2], rightFace);
            const resetPowered = this._isPoweredAt(world, x, y, z, back[0], back[1], back[2], backFace);

            if (!isPowered) {
                if (setPowered && resetPowered) {
                    return 'bluestoneMemoryTopSetOnResetOnOff';
                }
                return 'bluestoneMemoryTopOff';
            }

            if (!setPowered && !resetPowered) {
                return 'bluestoneMemoryTopSetOffResetOffOn';
            } else if (setPowered && !resetPowered) {
                return 'bluestoneMemoryTopSetOnResetOff';
            } else if (!setPowered && resetPowered) {
                return 'bluestoneMemoryTopSetOffResetOn';
            }

            return 'bluestoneMemoryTopOn';
        }

        if (face === EnumBlockFace.BOTTOM) return 'cobblestone_frame';
        if (face === backFace) return 'bluestoneObserverBackOff';
        if (face === rightFace) return 'bluestoneObserverBackOff';
        if (face === frontFace) return 'bluestoneObserverBackOff';

        return 'cobblestone_frame';
    }

    getRotationForFace(face, data, x, y, z, world) {
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
        world.notifyNeighborBlockChange(outX, outY, outZ);

        const outBlockId = world.getBlockAt(outX, outY, outZ);
        const outBlock = Block.getById(outBlockId);
        if (outBlock && (outBlock.isBluestoneDust || outBlock.isBluestoneRod)) {
            outBlock.onBlockTick(world, outX, outY, outZ);
        }
    }

    onBlockAdded(world, x, y, z) {
        this.updateState(world, x, y, z);
    }

    onNeighborBlockChange(world, x, y, z) {
        this.updateState(world, x, y, z);
    }

    onBlockTick(world, x, y, z) {
        this.updateState(world, x, y, z);
    }
}
