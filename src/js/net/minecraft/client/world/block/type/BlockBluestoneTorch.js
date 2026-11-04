import Block from "../Block.js";
import BlockTorch from "./BlockTorch.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

// Six neighbours, the way bluestone reads power.
const NEIGHBOURS = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1]
];

// The mount lives in the low three bits of the block data (0-5, 0 = floor), so
// the lit state is the bit above them.
const UNLIT_BIT = 8;

/**
 * A bluestone torch: a torch that is also a power source, and the inverted one.
 *
 * It mounts, sits and gets knocked off exactly like the plain torch (see
 * BlockTorch), but it powers the cells around it at 15 and lights its cell.
 * Like a redstone torch it is inverted: while the block it is mounted on is
 * being powered by something else, the torch goes dark and stops supplying
 * power, and it comes back on when that block loses its power.
 *
 * The state it reports is always worked out from the world on the spot, so a
 * client whose block ticks are switched off (multiplayer) still answers
 * honestly. Only the server writes the state bit, because that is what makes
 * it broadcast a block change to everyone.
 */
export default class BlockBluestoneTorch extends BlockTorch {

    // world -> Map("x,y,z" -> last lit state the torch saw). Rendering and
    // power never read this; it only exists to notice that something flipped.
    static litState = new WeakMap();

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Bluestone Torch";
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;

        // Read by dust and by every consumer looking for a source.
        this.isPowerSource = true;
    }

    /**
     * Lit torches use bluestone_torch, inverted ones bluestone_torch_off. The
     * torch model asks with the position, so an unlit torch is drawn dark; the
     * icon, which has no world to ask, always shows the lit texture.
     */
    getTextureForFace(face, data, x, y, z, world) {
        if (world && typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
            return this.isLit(world, x, y, z) ? 'bluestone_torch' : 'bluestone_torch_off';
        }

        return 'bluestone_torch';
    }

    /**
     * True while the torch is burning. Worked out live from the block it hangs
     * on rather than read from the stored bit, so the answer is right even
     * where block ticks do not run - a client connected to a server never ticks
     * blocks, and the torch still has to report an honest level to dust, to
     * lamps and to the light engine.
     */
    isLit(world, x, y, z) {
        return !this.isInverted(world, x, y, z);
    }

    /** The cell the torch hangs from, taken from its mount data. */
    getSupportCell(world, x, y, z) {
        const data = (world && typeof world.getBlockDataAt === 'function')
            ? (world.getBlockDataAt(x, y, z) || 0)
            : 0;
        const index = (data & 7) - 1;

        if (index < 0 || index >= this.dataFaces.length) {
            // A torch standing on the floor rests on the block below it.
            return {x: x, y: y - 1, z: z};
        }

        const face = this.dataFaces[index];
        return {x: x + face.x, y: y + face.y, z: z + face.z};
    }

    /** True when the cell this torch is mounted against is still solid. */
    hasSupport(world, x, y, z) {
        if (!world || typeof world.isSolidBlockAt !== 'function') {
            return false;
        }

        const support = this.getSupportCell(world, x, y, z);
        return world.isSolidBlockAt(support.x, support.y, support.z);
    }

    /**
     * True when the block this torch is mounted on is powered by something
     * other than this torch.
     *
     * A wire sitting against the torch itself is skipped: it is very likely
     * being fed by this very torch, and counting it would make the pair
     * oscillate - torch on, wire on, torch off, wire off, forever. Sources and
     * wires around the rest of the mounting block are the real input.
     */
    isInverted(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== 'function') {
            return false;
        }

        const support = this.getSupportCell(world, x, y, z);

        for (const [dx, dy, dz] of NEIGHBOURS) {
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

    /** Full power on every read face while it is lit, nothing once inverted. */
    getPower(world, x, y, z, neighborFace) {
        return this.isLit(world, x, y, z) ? 15 : 0;
    }

    getLightValue(world, x, y, z) {
        return this.isLit(world, x, y, z) ? 14 : 0;
    }

    /** Last state this torch announced for one position. */
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

    /**
     * Re-evaluate the inversion and, if it changed, make the change visible and
     * audible to the rest of the world.
     *
     * The mount bits are never touched: writing the state bit from a client that
     * has not received the mount data yet is what turned wall torches into
     * floor torches. Only the server owns the block data, and its data write is
     * what broadcasts the block change to every player.
     */
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

        // Server worlds can broadcast; the client cannot, and must not rewrite
        // the authoritative data.
        if (typeof world.broadcastBlockChange === 'function') {
            const data = world.getBlockDataAt(x, y, z) || 0;
            world.setBlockDataAt(x, y, z, (data & 7) | (lit ? 0 : UNLIT_BIT));
        }

        world.onBlockChanged(x, y, z);

        // Dust, lamps and doors have to hear about the new level.
        if (typeof world.notifyNeighborBlockChange === 'function') {
            world.notifyNeighborBlockChange(x, y, z);
        }
    }

    /** Keep watching the mounting block: every two ticks is quick enough. */
    scheduleRefresh(world, x, y, z) {
        if (world && typeof world.scheduleBlockTick === 'function') {
            world.scheduleBlockTick(x, y, z, 2);
        }
    }

    /**
     * Keep the mount the player clicked. BlockTorch.onBlockAdded re-derives it
     * by scanning for the first solid neighbour, which turns a wall torch into a
     * floor torch whenever the block underneath happens to be solid - so only
     * let that scan run when the chosen mount has nothing to hold on to.
     */
    onBlockAdded(world, x, y, z) {
        if (!this.hasSupport(world, x, y, z)) {
            super.onBlockAdded(world, x, y, z);
        }

        this.refresh(world, x, y, z);
        this.scheduleRefresh(world, x, y, z);
    }

    onBlockTick(world, x, y, z) {
        // The inherited tick knocks the torch off when its block is gone.
        super.onBlockTick(world, x, y, z);

        if (!world || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        this.refresh(world, x, y, z);
        this.scheduleRefresh(world, x, y, z);
    }
}
