






import { getBlockAt, getBlockMetadata, addWorldChange, getActiveDimension } from './world.js';
import { getPlayers } from './players.js';
import { addItemEntity } from './entities.js';
import { createSpawnObjectPacket, sendBlockChange } from './packets.js';
import Block from '../client/world/block/Block.js';
import config from './config.js';

const TICK_MS = 50; 





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

        this.neighborUpdateQueue = [];
        this.processingNeighborUpdates = false;

    }

    get allowTNT() {
        return config.allowTNT !== false;
    }

    get allowLiquidFlow() {
        return config.allowLiquidFlow !== false;
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

    onBlockChanged(x, y, z) {
        this.broadcastBlockChange(x, y, z, getBlockAt(x, y, z), getBlockMetadata(x, y, z));
    }

    dropItem(blockId, x, y, z) {
        const entity = addItemEntity(
            blockId,
            x + 0.5,
            y + 0.5,
            z + 0.5,
            (Math.random() - 0.5) * 0.15,
            0.2,
            (Math.random() - 0.5) * 0.15,
            null
        );
        const packet = createSpawnObjectPacket(entity);
        for (const player of getPlayers().values()) {
            if (player.ws?.readyState === 1) {
                player.ws.send(packet);
            }
        }
    }

    scheduleBlockTick(x, y, z, delay) {
        const key = `${x},${y},${z}`;
        const tickTime = Date.now() + (delay * TICK_MS);
        this.scheduledBlockTicks.set(key, { x, y, z, tickTime });
    }

    broadcastBlockChange(x, y, z, blockId, blockData) {
        const blockState = (blockId << 4) | (blockData & 0xF);
        const dimension = getActiveDimension();
        const players = getPlayers();
        for (const p of players.values()) {
            if ((p.dimension ?? 0) === dimension && p.ws && p.ws.readyState === 1) {
                sendBlockChange(p.ws, x, y, z, blockState);
            }
        }
    }

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

    notifyNeighborBlockChange(x, y, z) {
        this.neighborUpdateQueue.push([x, y, z]);
        if (this.processingNeighborUpdates) return;

        this.processingNeighborUpdates = true;
        try {
            const faces = [
                { x: 1, y: 0, z: 0 },
                { x: -1, y: 0, z: 0 },
                { x: 0, y: 0, z: 1 },
                { x: 0, y: 0, z: -1 },
                { x: 0, y: 1, z: 0 },
                { x: 0, y: -1, z: 0 }
            ];

            let steps = 0;
            while (this.neighborUpdateQueue.length > 0 && steps < 16384) {
                const [cx, cy, cz] = this.neighborUpdateQueue.pop();
                steps++;

                for (const face of faces) {
                    const checkX = cx + face.x;
                    const checkY = cy + face.y;
                    const checkZ = cz + face.z;

                    const typeId = this.getBlockAt(checkX, checkY, checkZ);
                    if (typeId === 0) continue;

                    const block = Block.getById(typeId);
                    if (!block) continue;

                    if (typeof block.onNeighborBlockChange === 'function') {
                        block.onNeighborBlockChange(this, checkX, checkY, checkZ);
                    } else if (typeof block.onBlockTick === 'function') {
                        this.scheduleBlockTick(checkX, checkY, checkZ, 1);
                    }
                }
            }

            if (steps >= 16384) {
                console.warn("notifyNeighborBlockChange: propagation cascade capped after 16384 steps (oscillating redstone circuit?)");
            }
        } finally {
            this.neighborUpdateQueue = [];
            this.processingNeighborUpdates = false;
        }
    }

    seedScheduledTicks(subChunks) {
        subChunks.forEachModifiedBlock((x, y, z, blockState) => {
            const block = Block.getById(blockState >> 4);
            if (block && (block.onBlockTick || block.onBlockAdded)) {
                this.scheduleBlockTick(x, y, z, 1);
            }
        });
    }

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
