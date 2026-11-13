import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockDoor extends Block {

    static DOOR_THICKNESS = 3 / 16;

    static DOOR_BOTTOM = 160;
    static DOOR_TOP = 161;

    constructor(id, textureSlotId, options = {}) {
        super(id, textureSlotId);
        this.doorBottomId = options.bottomId ?? BlockDoor.DOOR_BOTTOM;
        this.doorTopId = options.topId ?? BlockDoor.DOOR_TOP;
        this.doorTexture = options.texture ?? 'oak_door';
        this.description = options.description ?? "Oak Door";
        this.hardness = options.hardness ?? 3.0;
        this.multipart = true;
        this.noFaceCull = true;
        this.sound = options.sound ?? Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
        this.renderAsItemInInventory = true;
        this.itemTextureInventory = options.itemTexture ?? 'oak_door';
        this.preferredToolType = options.tool ?? 'axe';
    }

    getPreferredToolType() {
        return this.preferredToolType;
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getTextureForFace() {
        return `${this.doorTexture}_${this.id === this.doorBottomId ? 'bottom' : 'top'}`;
    }

    isSolid() {
        return false;
    }

    getOpacity() {
        return 1 / 255;
    }

    getDoorBoundingBox(data) {
        const t = BlockDoor.DOOR_THICKNESS;
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
        
        if (this.id === this.doorBottomId && (data & 8) === 0) {
            if (face === EnumBlockFace.TOP) {
                return false;
            }
        }
        
        if (this.id === this.doorTopId && (data & 8) === 0) {
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
        return this.id === this.doorTopId ? [this.doorBottomId, 1] : [this.id, 1];
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return [2, 5, 3, 4][dirIndex];
    }

    onBlockPlaced(world, x, y, z, face) {
        if (!world || !world.minecraft || !world.minecraft.player) {
            return;
        }

        let player = world.minecraft.player;
        let dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
        let facing = [2, 5, 3, 4][dirIndex];

        world.setBlockDataAt(x, y, z, facing);
        
        if (this.id === this.doorBottomId) {
            const aboveY = y + 1;
            const aboveBlock = world.getBlockAt(x, aboveY, z);
            if (aboveBlock !== this.doorTopId) {
                world.setBlockAt(x, aboveY, z, this.doorTopId, facing);
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
        if (this.id === this.doorTopId && world.getBlockAt(x, y - 1, z) === this.doorBottomId) {
            y = y - 1;
        }
        if (this.id !== this.doorBottomId || world.getBlockAt(x, y, z) !== this.doorBottomId) return;

        const powered = this.isPowered(world, x, y, z) || this.isPowered(world, x, y + 1, z);
        const data = world.getBlockDataAt(x, y, z);
        const isOpen = (data & 8) !== 0;

        if (powered === isOpen) return;

        world.setBlockDataAt(x, y, z, powered ? (data | 8) : (data & ~8));

        if (world.getBlockAt(x, y + 1, z) === this.doorTopId) {
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
    }

    onNeighborBlockChange(world, x, y, z) {
        if (this.id === this.doorBottomId) {
            world.scheduleBlockTick(x, y, z, 1);
        } else if (world.getBlockAt(x, y - 1, z) === this.doorBottomId) {
            world.scheduleBlockTick(x, y - 1, z, 1);
        }
    }

    onBlockTick(world, x, y, z) {
        this.updateState(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        if (this.id === this.doorBottomId) {
            if (world.getBlockAt(x, y + 1, z) === this.doorTopId) {
                world.setBlockAt(x, y + 1, z, 0);
            }
        } else if (world.getBlockAt(x, y - 1, z) === this.doorBottomId) {
            world.setBlockAt(x, y - 1, z, 0);
        }
    }

    onMouseButton(world, x, y, z, button) {
        if (button === 2) {
            let bottomY = y;
            if (world.getBlockAt(x, y - 1, z) === this.doorBottomId) {
                bottomY = y - 1;
            }

            const rootData = world.getBlockDataAt(x, bottomY, z);
            const isOpen = (rootData & 8) !== 0;
            const newData = isOpen ? (rootData & ~8) : (rootData | 8);

            world.setBlockDataAt(x, bottomY, z, newData);

            const aboveId = world.getBlockAt(x, bottomY + 1, z);
            if (aboveId === this.doorBottomId || aboveId === this.doorTopId) {
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
