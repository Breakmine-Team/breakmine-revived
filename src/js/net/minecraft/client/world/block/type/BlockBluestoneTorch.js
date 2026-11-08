import Block from "../Block.js";
import BlockTorch from "./BlockTorch.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockBluestoneTorch extends BlockTorch {

    static NEIGHBOURS = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
    ];
    static UNLIT_BIT = 8;
    static litState = new WeakMap();

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Bluestone Torch";
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;

        this.isPowerSource = true;
    }

    
    getTextureForFace(face, data, x, y, z, world) {
        if (world && typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
            return this.isLit(world, x, y, z) ? 'bluestone_torch' : 'bluestone_torch_off';
        }

        return 'bluestone_torch';
    }

    
    isLit(world, x, y, z) {
        return !this.isInverted(world, x, y, z);
    }

    
    getSupportCell(world, x, y, z) {
        const data = (world && typeof world.getBlockDataAt === 'function')
            ? (world.getBlockDataAt(x, y, z) || 0)
            : 0;
        const index = (data & 7) - 1;

        if (index < 0 || index >= this.dataFaces.length) {
            return {x: x, y: y - 1, z: z};
        }

        const face = this.dataFaces[index];
        return {x: x + face.x, y: y + face.y, z: z + face.z};
    }

    
    hasSupport(world, x, y, z) {
        if (!world || typeof world.isSolidBlockAt !== 'function') {
            return false;
        }

        const support = this.getSupportCell(world, x, y, z);
        return world.isSolidBlockAt(support.x, support.y, support.z);
    }

    
    isInverted(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== 'function') {
            return false;
        }

        const support = this.getSupportCell(world, x, y, z);

        for (const [dx, dy, dz] of BlockBluestoneTorch) {
            const nx = support.x + dx;
            const ny = support.y + dy;
            const nz = support.z + dz;

            if (nx === x && ny === y && nz === z) {
                continue;
            }

            const block = Block.getById(world.getBlockAt(nx, ny, nz));
            if (!block) {
                continue;
            }

            const touchesTorch = Math.abs(nx - x) + Math.abs(ny - y) + Math.abs(nz - z) === 1;
            const isWire = typeof block.getPower === 'function' && block.isPowerSource !== true;
            if (touchesTorch && isWire) {
                continue;
            }

            if (typeof block.getPower === 'function') {
                if (block.getPower(world, nx, ny, nz) > 0) {
                    return true;
                }
            } else if (block.isPowerSource === true) {
                return true;
            }
        }

        return false;
    }

    
    getPower(world, x, y, z, neighborFace) {
        return this.isLit(world, x, y, z) ? 15 : 0;
    }

    getLightValue(world, x, y, z) {
        return this.isLit(world, x, y, z) ? 14 : 0;
    }

    
    static getRememberedLit(world, x, y, z) {
        const states = world ? BlockBluestoneTorch.litState.get(world) : null;
        if (!states) {
            return null;
        }

        const known = states.get(x + "," + y + "," + z);
        return known === undefined ? null : known;
    }

    static rememberLit(world, x, y, z, lit) {
        if (!world) {
            return;
        }

        let states = BlockBluestoneTorch.litState.get(world);
        if (!states) {
            states = new Map();
            BlockBluestoneTorch.litState.set(world, states);
        }
        states.set(x + "," + y + "," + z, lit);
    }

    
    refresh(world, x, y, z) {
        if (!world || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        const lit = !this.isInverted(world, x, y, z);
        const known = BlockBluestoneTorch.getRememberedLit(world, x, y, z);
        if (known === lit) {
            return;
        }
        BlockBluestoneTorch.rememberLit(world, x, y, z, lit);

        if (known === null) {
            return;
        }

        if (typeof world.broadcastBlockChange === 'function') {
            const data = world.getBlockDataAt(x, y, z) || 0;
            world.setBlockDataAt(x, y, z, (data & 7) | (lit ? 0 : BlockBluestoneTorch.UNLIT_BIT));
        }

        world.onBlockChanged(x, y, z);

        if (typeof world.notifyNeighborBlockChange === 'function') {
            world.notifyNeighborBlockChange(x, y, z);
        }
    }

    
    scheduleRefresh(world, x, y, z) {
        if (world && typeof world.scheduleBlockTick === 'function') {
            world.scheduleBlockTick(x, y, z, 2);
        }
    }

    
    onBlockAdded(world, x, y, z) {
        if (!this.hasSupport(world, x, y, z)) {
            super.onBlockAdded(world, x, y, z);
        }

        this.refresh(world, x, y, z);
        this.scheduleRefresh(world, x, y, z);
    }

    onBlockTick(world, x, y, z) {
        super.onBlockTick(world, x, y, z);

        if (!world || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        this.refresh(world, x, y, z);
        this.scheduleRefresh(world, x, y, z);
    }
}
