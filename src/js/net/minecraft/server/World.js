// Server-side World emulation for block ticking using game code BlockRegistry.
// This implements the subset of the client World API that the game's block
// classes touch (getBlockAt / getBlockDataAt / setBlockAt / setBlockDataAt /
// onBlockChanged / scheduleBlockTick) so the *same* bluestone logic that runs
// in single-player (dust propagation, lamps, repeaters, observers, pushers,
// bulbs, doors) runs authoritatively on the server in multiplayer. Every
// state change is persisted and broadcast to all connected players.
import { getBlockAt, getBlockMetadata, addWorldChange } from './world.js';
import { getPlayers } from './players.js';
import { sendBlockChange } from './packets.js';
import Block from '../client/world/block/Block.js';

const TICK_MS = 50; // 20 game ticks per second

// Blocks touch `world.minecraft` to play sounds / open GUIs / read the local
// player. On the server those become harmless no-ops (player stays undefined
// so player-rotation code in onBlockPlaced early-returns and trusts the
// metadata sent by the placing client).
const MINECRAFT_STUB = {
    displayScreen: () => {},
    soundManager: { playSoundMono: () => {} },
    player: undefined,
    worldRenderer: undefined
};

class ServerWorld {
    constructor() {
        this.scheduledBlockTicks = new Map();
        this.blockTickQueue = [];
        this.minecraft = MINECRAFT_STUB;
    }

    getBlockAt(x, y, z) {
        return getBlockAt(x, y, z);
    }

    getBlockAtFace(x, y, z, face) {
        return this.getBlockAt(x + face.x, y + face.y, z + face.z);
    }

    getBlockDataAt(x, y, z) {
        return getBlockMetadata(x, y, z);
    }

    isSolidBlockAt(x, y, z) {
        const typeId = this.getBlockAt(x, y, z);
        if (typeId === 0) {
            return false;
        }
        const block = Block.getById(typeId);
        return block !== null && !!block.isSolid();
    }

    setBlockDataAt(x, y, z, data) {
        this._set(x, y, z, getBlockAt(x, y, z), data);
    }

    // Kept deliberately narrow: waking the neighbours when a block disappears.
// Without it a wire that loses a block (or a door whose other half was
    // removed) keeps its old state until something else happens to tick it.
    // Block placement/removal callbacks are NOT fired here -- onBlockRemoved
    // can cascade (the pusher head tears down its own base), and running
    // placement logic from the simulation made networks unstable instead of
    // settling. Placements are seeded by the placement handler's onBlockAdded.
    setBlockAt(x, y, z, type, data) {
        this._set(x, y, z, type, data === undefined ? 0 : data);

        if (type === 0) {
            this.scheduleNeighborTicks(x, y, z);
            this.notifyNeighborBlockChange(x, y, z);
        }
    }

    _set(x, y, z, type, data) {
        const metadata = (data & 0xF);
        addWorldChange(x, y, z, type, metadata);
        this.broadcastBlockChange(x, y, z, type, metadata);
    }

    // Blocks call this to request a visual refresh; on the server that means
    // re-broadcasting the current state so every client re-renders it.
    onBlockChanged(x, y, z) {
        this.broadcastBlockChange(x, y, z, getBlockAt(x, y, z), getBlockMetadata(x, y, z));
    }

    scheduleBlockTick(x, y, z, delay) {
        const key = `${x},${y},${z}`;
        const tickTime = Date.now() + (delay * TICK_MS);
        this.scheduledBlockTicks.set(key, { x, y, z, tickTime });
    }

    broadcastBlockChange(x, y, z, blockId, blockData) {
        const blockState = (blockId << 4) | (blockData & 0xF);
        const players = getPlayers();
        for (const p of players.values()) {
            if (p.ws && p.ws.readyState === 1) {
                sendBlockChange(p.ws, x, y, z, blockState);
            }
        }
    }

    // Schedule ticks for all adjacent blocks that have an onBlockTick.
    scheduleNeighborTicks(x, y, z) {
        const faces = [
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: -1, z: 0 }
        ];

        for (const face of faces) {
            const checkX = x + face.x;
            const checkY = y + face.y;
            const checkZ = z + face.z;

            const typeId = this.getBlockAt(checkX, checkY, checkZ);
            if (typeId !== 0) {
                const block = Block.getById(typeId);
                if (block && block.onBlockTick) {
                    this.scheduleBlockTick(checkX, checkY, checkZ, 1);
                }
            }
        }
    }

    // Notify adjacent blocks that the block at (x, y, z) changed type.
    notifyNeighborBlockChange(x, y, z) {
        const faces = [
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: -1, z: 0 }
        ];

        for (const face of faces) {
            const checkX = x + face.x;
            const checkY = y + face.y;
            const checkZ = z + face.z;

            const typeId = this.getBlockAt(checkX, checkY, checkZ);
            if (typeId === 0) continue;

            const block = Block.getById(typeId);
            if (!block) continue;

            if (typeof block.onNeighborBlockChange === 'function') {
                block.onNeighborBlockChange(this, checkX, checkY, checkZ);
            } else if (typeof block.onBlockTick === 'function') {
                // Plenty of bluestone blocks (pusher, pusher head, sticky
                // pusher, rod pillar, ...) have no onNeighborBlockChange hook.
                // Calling only the hook meant those blocks were skipped
                // entirely and silently kept their old state. Anything that
                // ticks gets scheduled instead, so a neighbour change can
                // never be dropped on the floor.
                this.scheduleBlockTick(checkX, checkY, checkZ, 1);
            }
        }
    }

    // After a world load, queue ticks for every saved block that participates
    // in block ticking so saved bluestone networks settle to their correct
    // state again.
    seedScheduledTicks(subChunks) {
        subChunks.forEachModifiedBlock((x, y, z, blockState) => {
            const block = Block.getById(blockState >> 4);
            if (block && (block.onBlockTick || block.onBlockAdded)) {
                this.scheduleBlockTick(x, y, z, 1);
            }
        });
    }

    // Process block ticks (called from the server tick loop).
    onTick() {
        const now = Date.now();

        for (const [key, tick] of this.scheduledBlockTicks.entries()) {
            if (now >= tick.tickTime) {
                this.blockTickQueue.push({ x: tick.x, y: tick.y, z: tick.z });
                this.scheduledBlockTicks.delete(key);
            }
        }

        while (this.blockTickQueue.length > 0) {
            const { x, y, z } = this.blockTickQueue.shift();
            const blockId = this.getBlockAt(x, y, z);
            const block = Block.getById(blockId);

            if (block && block.onBlockTick) {
                try {
                    block.onBlockTick(this, x, y, z);
                } catch (e) {
                    console.error(`Error ticking block at ${x},${y},${z}:`, e);
                }
            }
        }
    }
}

let instance = null;
function getServerWorld() {
    if (!instance) {
        instance = new ServerWorld();
    }
    return instance;
}

export default getServerWorld;
export { ServerWorld };
