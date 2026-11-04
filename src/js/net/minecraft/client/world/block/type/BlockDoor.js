import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const DOOR_THICKNESS = 3 / 16;

const DOOR_BOTTOM = 160;
const DOOR_TOP = 161;

/**
 * Oak door. The bottom half (id 160) places a linked top half (id 161) above
 * itself; both share the same data format — rotation in bits 0-2
 * (2=N, 3=S, 4=W, 5=E, matching chests/furnaces), open state in bit 3.
 */
export default class BlockDoor extends Block {

    
    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Oak Door";
        this.hardness = 3.0;
        this.multipart = true;
        this.noFaceCull = true;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
        this.renderAsItemInInventory = true;
        this.itemTextureInventory = 'oak_door';
    }

    getPreferredToolType() {
        return 'axe';
    }

    getAmbientOcclusion() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getTextureForFace() {
        return this.id === DOOR_BOTTOM ? 'oak_door_bottom' : 'oak_door_top';
    }

    isSolid() {
        return false;
    }

    getDoorBoundingBox(data) {
        const t = DOOR_THICKNESS;
        const open = (data & 8) !== 0;

        let facing = data & 7;
        if (facing !== 3 && facing !== 4 && facing !== 5) facing = 2;

        switch (facing) {
            case 2:
                return open
                    ? new BoundingBox(0, 0, 0, t, 1, 1)
                    : new BoundingBox(0, 0, 0, 1, 1, t);
            case 3:
                return open
                    ? new BoundingBox(1 - t, 0, 0, 1, 1, 1)
                    : new BoundingBox(0, 0, 1 - t, 1, 1, 1);
            case 4:
                return open
                    ? new BoundingBox(0, 0, 1 - t, 1, 1, 1)
                    : new BoundingBox(0, 0, 0, t, 1, 1);
            case 5:
                return open
                    ? new BoundingBox(0, 0, 0, 1, 1, t)
                    : new BoundingBox(1 - t, 0, 0, 1, 1, 1);
        }
        return new BoundingBox(0, 0, 0, 1, 1, 1);
    }

    isTranslucent() {
        return true;
    }

    shouldRenderFace(world, x, y, z, face) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        
        // Bottom half doors cull top face when not open
        if (this.id === DOOR_BOTTOM && (data & 8) === 0) {
            if (face === EnumBlockFace.TOP) {
                return false;
            }
        }
        
        // Top half doors cull bottom face when not open
        if (this.id === DOOR_TOP && (data & 8) === 0) {
            if (face === EnumBlockFace.BOTTOM) {
                return false;
            }
        }
        
        return true;
    }

    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return [["block", this.id, this.getDoorBoundingBox(data)]];
    }

    getBoundingBox(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return this.getDoorBoundingBox(data);
    }

    getCollisionBoundingBox(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return this.getDoorBoundingBox(data);
    }

    getDrop(world, x, y, z) {
        return this.id === DOOR_TOP ? [DOOR_BOTTOM, 1] : [this.id, 1];
    }

    onBlockPlaced(world, x, y, z, face) {
        if (!world || !world.minecraft || !world.minecraft.player) {
            return;
        }

        let player = world.minecraft.player;
        let dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
        let facing = [2, 5, 3, 4][dirIndex];

        world.setBlockDataAt(x, y, z, facing);
        
        if (this.id === DOOR_BOTTOM) {
            const aboveY = y + 1;
            const aboveBlock = world.getBlockAt(x, aboveY, z);
            if (aboveBlock !== DOOR_TOP) {
                world.setBlockAt(x, aboveY, z, DOOR_TOP, facing);
            }
        }

        world.onBlockChanged(x, y, z);
    }

    isPowered(world, x, y, z) {
        const neighbors = [
            [x + 1, y, z],
            [x - 1, y, z],
            [x, y, z + 1],
            [x, y, z - 1],
            [x, y - 1, z],
            [x, y + 1, z],
        ];

        for (const [nx, ny, nz] of neighbors) {
            const blockId = world.getBlockAt(nx, ny, nz);
            if (blockId === undefined || blockId === null || blockId === -1) continue;

            const block = Block.getById(blockId);
            if (!block) continue;

            if (typeof block.getPower === 'function') {
                if (block.getPower(world, nx, ny, nz) > 0) return true;
            } else if (block.isPowerSource) {
                return true;
            }
        }

        return false;
    }

    updateState(world, x, y, z) {
        // Resolve to the bottom half so both halves stay in sync.
        if (this.id === DOOR_TOP && world.getBlockAt(x, y - 1, z) === DOOR_BOTTOM) {
            y = y - 1;
        }
        if (this.id !== DOOR_BOTTOM || world.getBlockAt(x, y, z) !== DOOR_BOTTOM) return;

        const powered = this.isPowered(world, x, y, z) || this.isPowered(world, x, y + 1, z);
        const data = world.getBlockDataAt(x, y, z);
        const isOpen = (data & 8) !== 0;

        if (powered === isOpen) return;

        world.setBlockDataAt(x, y, z, powered ? (data | 8) : (data & ~8));

        if (world.getBlockAt(x, y + 1, z) === DOOR_TOP) {
            const aboveData = world.getBlockDataAt(x, y + 1, z);
            world.setBlockDataAt(x, y + 1, z, powered ? (aboveData | 8) : (aboveData & ~8));
        }

        world.onBlockChanged(x, y, z);
        world.onBlockChanged(x, y + 1, z);

        const soundName = powered ? 'random.door_open' : 'random.door_close';
        if (world.minecraft && world.minecraft.soundManager) {
            world.minecraft.soundManager.playSoundMono(soundName, 1.0, 1.0, true);
        }
    }

    onBlockAdded(world, x, y, z) {
        // Intentionally a no-op (base class). Do NOT schedule a self-tick here:
        // setBlockDataAt() routes through Chunk.setBlockAt(), which fires
        // onBlockAdded on every data change — including the manual toggle in
        // onMouseButton(). A self-tick would re-run updateState() and
        // immediately close an unpowered door that was just opened by hand.
        // Initial power checks on placement and power-source changes are
        // handled via onNeighborBlockChange().
    }

    onNeighborBlockChange(world, x, y, z) {
        if (this.id === DOOR_BOTTOM) {
            world.scheduleBlockTick(x, y, z, 1);
        } else if (world.getBlockAt(x, y - 1, z) === DOOR_BOTTOM) {
            world.scheduleBlockTick(x, y - 1, z, 1);
        }
    }

    onBlockTick(world, x, y, z) {
        this.updateState(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        if (this.id === DOOR_BOTTOM) {
            if (world.getBlockAt(x, y + 1, z) === DOOR_TOP) {
                world.setBlockAt(x, y + 1, z, 0);
            }
        } else if (world.getBlockAt(x, y - 1, z) === DOOR_BOTTOM) {
            world.setBlockAt(x, y - 1, z, 0);
        }
    }

    onMouseButton(world, x, y, z, button) {
        if (button === 2) {
            let bottomY = y;
            if (world.getBlockAt(x, y - 1, z) === DOOR_BOTTOM) {
                bottomY = y - 1;
            }

            const rootData = world.getBlockDataAt(x, bottomY, z);
            const isOpen = (rootData & 8) !== 0;
            const newData = isOpen ? (rootData & ~8) : (rootData | 8);

            world.setBlockDataAt(x, bottomY, z, newData);

            const aboveId = world.getBlockAt(x, bottomY + 1, z);
            if (aboveId === DOOR_BOTTOM || aboveId === DOOR_TOP) {
                const aboveData = world.getBlockDataAt(x, bottomY + 1, z);
                world.setBlockDataAt(x, bottomY + 1, z, isOpen ? (aboveData & ~8) : (aboveData | 8));
            }

            world.onBlockChanged(x, bottomY, z);
            world.onBlockChanged(x, bottomY + 1, z);
            
            const willBeOpen = (newData & 8) !== 0;
            const soundName = willBeOpen ? 'random.door_open' : 'random.door_close';

            if (world.minecraft && world.minecraft.soundManager) {
                world.minecraft.soundManager.playSoundMono(soundName, 1.0, 1.0, true);
            }

            if (world.minecraft && world.minecraft.player) {
                world.minecraft.player.swingArm();
            }
            return true;
        }
        return false;
    }
}
