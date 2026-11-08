








import Block from "../client/world/block/Block.js";
import { addWorldChange } from "./world.js";
import { getPlayers, isOp } from "./players.js";
import { sendBlockChange } from "./packets.js";
import { sendChatMessageToPlayer } from "./CommandContext.js";


const MAX_VOLUME = 262144;
const MAX_SIDE = 128;
const WORLD_HEIGHT = 256;
const MAX_NAME_LENGTH = 64;

function isValidSize(size) {
    if (!size || !Number.isInteger(size.x) || !Number.isInteger(size.y) || !Number.isInteger(size.z)) {
        return false;
    }
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
        return false;
    }
    if (size.x > MAX_SIDE || size.y > MAX_SIDE || size.z > MAX_SIDE) {
        return false;
    }
    return size.x * size.y * size.z <= MAX_VOLUME;
}

function handleStructurePaste(player, payload) {
    if (!player || !player.ws) {
        return;
    }

    if (!isOp(player)) {
        sendChatMessageToPlayer(player, "§cYou do not have permission to paste structures!");
        return;
    }

    const size = payload.size;
    const originX = payload.x;
    const originY = payload.y;
    const originZ = payload.z;
    const blocks = payload.blocks;

    if (!isValidSize(size)
        || !Number.isInteger(originX) || !Number.isInteger(originY) || !Number.isInteger(originZ)
        || !Array.isArray(blocks) || blocks.length > MAX_VOLUME) {
        sendChatMessageToPlayer(player, "§cInvalid structure paste.");
        return;
    }

    if (originY < 0 || originY + size.y > WORLD_HEIGHT) {
        sendChatMessageToPlayer(player, "§cThe structure does not fit in the world from y " + originY + ".");
        return;
    }

    const name = typeof payload.name === "string" && payload.name.length > 0
        ? payload.name.slice(0, MAX_NAME_LENGTH)
        : "structure";

    const players = [...getPlayers().values()];
    let placed = 0;

    for (const entry of blocks) {
        if (!Array.isArray(entry) || entry.length < 4) {
            continue;
        }

        const dx = entry[0];
        const dy = entry[1];
        const dz = entry[2];
        const id = entry[3];
        const metadata = entry.length >= 5 ? entry[4] : 0;

        if (!Number.isInteger(dx) || !Number.isInteger(dy) || !Number.isInteger(dz)
            || dx < 0 || dy < 0 || dz < 0 || dx >= size.x || dy >= size.y || dz >= size.z) {
            continue;
        }
        if (!Number.isInteger(id) || id < 0 || id > 4095
            || !Number.isInteger(metadata) || metadata < 0 || metadata > 15) {
            continue;
        }
        if (id !== 0 && Block.getById(id) === null) {
            continue;
        }

        const blockX = originX + dx;
        const blockY = originY + dy;
        const blockZ = originZ + dz;
        if (blockY < 0 || blockY >= WORLD_HEIGHT) {
            continue;
        }

        addWorldChange(blockX, blockY, blockZ, id, metadata);

        const blockState = (id << 4) | (metadata & 15);
        for (const other of players) {
            if (other.ws && other.ws.readyState === 1) {
                sendBlockChange(other.ws, blockX, blockY, blockZ, blockState);
            }
        }

        placed++;
    }

    sendChatMessageToPlayer(player, "§aPasted §f" + name + " §7(" + size.x + "x" + size.y + "x" + size.z +
        ", " + placed + " blocks) §aat §f" + originX + ", " + originY + ", " + originZ + "§a.");
}

export { handleStructurePaste };
