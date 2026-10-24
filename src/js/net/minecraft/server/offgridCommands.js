// Server-side counterpart of the client OffGridBlockRendererCommand.
//
// The command classes stay client-side because they render, but the shared
// structure itself is server-authoritative now. These handlers validate the
// same limits, mutate server/offgrid.js and broadcast a snapshot so every
// connected client (including the executor) renders exactly the same result.
import Block from '../client/world/block/Block.js';
import { BlockRegistry } from '../client/world/block/BlockRegistry.js';
import {
    OFF_GRID_MAX_CELLS,
    OFF_GRID_MAX_DIM,
    OFF_GRID_WORLD_HEIGHT
} from '../util/OffGridConstants.js';
import { getBlockAt, getBlockMetadata } from './world.js';
import { isOp } from './players.js';
import { sendChatMessageToPlayer } from './CommandContext.js';
import * as offgrid from './offgrid.js';

const USAGE = '<x> <y> <z> <rx> <ry> <rz> [block] | fill <x> <y> <z> <w> <h> <d> <block> [data] | move <dx> <dy> <dz> | rotate <deg> [x|y|z] | clear';

function usage(player) {
    sendChatMessageToPlayer(player, '§c/offgridrenderer ' + USAGE);
}

/** Resolve a numeric id or registry name to a Block. */
function resolveBlock(blockArg) {
    const blockIdNum = parseInt(blockArg);
    if (!isNaN(blockIdNum)) {
        const byId = Block.getById(blockIdNum) || BlockRegistry.get(blockIdNum);
        if (byId) return byId;
    }
    return BlockRegistry.get(blockArg);
}

/** Only real blocks can be summoned or rendered as ghost blocks. */
function resolvePlaceableBlock(blockArg) {
    const block = resolveBlock(blockArg);
    if (!block) return null;
    if (typeof block.isItem === 'function' && block.isItem()) return null;
    return block;
}

function blockName(block) {
    return block.name || block.getId();
}

/**
 * Handle a command already known to be one of ours. Returns true so callers
 * can stop dispatching to the client command classes.
 */
function handleOffGridCommand(player, cmd, args) {
    if (!isOp(player)) {
        sendChatMessageToPlayer(player, '§cYou do not have permission to use this command.');
        return true;
    }

    if (cmd === 'ofr') {
        executeShortcut(player);
        return true;
    }
    if (cmd === 'ofrclear') {
        executeClear(player);
        return true;
    }

    const sub = args.length > 0 ? String(args[0]).toLowerCase() : '';
    if (sub === 'clear') {
        executeClear(player);
    } else if (sub === 'fill') {
        executeFill(player, args.slice(1));
    } else if (sub === 'move') {
        executeMove(player, args.slice(1));
    } else if (sub === 'rotate') {
        executeRotate(player, args.slice(1));
    } else {
        executeSingle(player, args);
    }
    return true;
}

/** Render one block from a source position to a render position. */
function executeSingle(player, args) {
    if (args.length < 6) {
        usage(player);
        return;
    }

    const blockX = parseInt(args[0]);
    const blockY = parseInt(args[1]);
    const blockZ = parseInt(args[2]);
    const renderX = parseFloat(args[3]);
    const renderY = parseFloat(args[4]);
    const renderZ = parseFloat(args[5]);

    if (isNaN(blockX) || isNaN(blockY) || isNaN(blockZ)) {
        sendChatMessageToPlayer(player, '§cInvalid source coordinates.');
        return;
    }
    if (isNaN(renderX) || isNaN(renderY) || isNaN(renderZ)) {
        sendChatMessageToPlayer(player, '§cInvalid render coordinates.');
        return;
    }

    let block;
    let sourceData = 0;

    if (args.length >= 7) {
        block = resolvePlaceableBlock(args.slice(6).join(' ').trim());
        if (!block) {
            sendChatMessageToPlayer(player, '§cUnknown block: ' + args.slice(6).join(' '));
            return;
        }
    } else {
        if (blockY < 0 || blockY >= OFF_GRID_WORLD_HEIGHT) {
            sendChatMessageToPlayer(player, '§cThe source position is outside the world.');
            return;
        }
        const sourceId = getBlockAt(blockX, blockY, blockZ);
        if (!sourceId) {
            sendChatMessageToPlayer(player, '§cThe source position is air.');
            return;
        }
        block = Block.getById(sourceId) || BlockRegistry.get(sourceId);
        if (!block) {
            sendChatMessageToPlayer(player, '§cThe source position is not a known block.');
            return;
        }
        sourceData = getBlockMetadata(blockX, blockY, blockZ);
    }

    if (!offgrid.addGhost(renderX, renderY, renderZ, block.getId(), sourceData)) {
        sendChatMessageToPlayer(player, '§cCould not render that block (vertex limit reached or invalid position).');
        return;
    }

    offgrid.broadcastState();
    sendChatMessageToPlayer(player, '§aRendered §f' + blockName(block) +
        (args.length >= 7 ? ' at ' : ' from (' + blockX + ', ' + blockY + ', ' + blockZ + ') to ') +
        '(' + renderX + ', ' + renderY + ', ' + renderZ + ').');
}

/** Summon a volume of one block type at (x,y,z). */
function executeFill(player, args) {
    if (args.length < 7) {
        usage(player);
        return;
    }

    const x = parseInt(args[0]);
    const y = parseInt(args[1]);
    const z = parseInt(args[2]);
    const w = parseInt(args[3]);
    const h = parseInt(args[4]);
    const d = parseInt(args[5]);

    if (isNaN(x) || isNaN(y) || isNaN(z) || isNaN(w) || isNaN(h) || isNaN(d)) {
        sendChatMessageToPlayer(player, '§cInvalid coordinates or sizes.');
        return;
    }
    if (w < 1 || h < 1 || d < 1 || w > OFF_GRID_MAX_DIM || h > OFF_GRID_MAX_DIM || d > OFF_GRID_MAX_DIM) {
        sendChatMessageToPlayer(player, '§cEach size must be 1..' + OFF_GRID_MAX_DIM + '.');
        return;
    }
    if (w * h * d > OFF_GRID_MAX_CELLS) {
        sendChatMessageToPlayer(player, '§cToo many blocks: ' + (w * h * d) + ' > ' + OFF_GRID_MAX_CELLS + '.');
        return;
    }
    if (y < 0 || y + h > OFF_GRID_WORLD_HEIGHT) {
        sendChatMessageToPlayer(player, '§cHeight out of world (y 0..' + (OFF_GRID_WORLD_HEIGHT - 1) + ').');
        return;
    }

    const block = resolvePlaceableBlock(args[6]);
    if (!block) {
        sendChatMessageToPlayer(player, '§cUnknown block: ' + args[6]);
        return;
    }

    let data = 0;
    if (args.length >= 8) {
        data = parseInt(args[7]);
        if (isNaN(data) || data < 0 || data > 15) {
            sendChatMessageToPlayer(player, '§cBlock data must be 0..15.');
            return;
        }
    }

    const count = offgrid.applyFill(x, y, z, w, h, d, block.getId(), data);
    offgrid.broadcastState();
    sendChatMessageToPlayer(player, '§aSummoned §f' + count + ' §rblock(s) of §f' + blockName(block) +
        ' §aat (' + x + ', ' + y + ', ' + z + ')-(' +
        (x + w - 1) + ', ' + (y + h - 1) + ', ' + (z + d - 1) + ').');
}

/** Move the summoned structure by a (possibly fractional) delta. */
function executeMove(player, args) {
    if (args.length < 3) {
        usage(player);
        return;
    }

    const dx = parseFloat(args[0]);
    const dy = parseFloat(args[1]);
    const dz = parseFloat(args[2]);

    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
        sendChatMessageToPlayer(player, '§cInvalid offsets, FYI decimals are allowed (e.g. 0.5 -1 2.25).');
        return;
    }
    if (offgrid.getCellCount() === 0) {
        sendChatMessageToPlayer(player, '§cNothing summoned yet.');
        return;
    }

    const result = offgrid.applyMove(dx, dy, dz);
    offgrid.broadcastState();

    const wholeMove = Number.isInteger(dx) && Number.isInteger(dy) && Number.isInteger(dz);
    if (wholeMove && !result.shifted) {
        sendChatMessageToPlayer(player, '§eThe structure did not move (out-of-world destination or zero offset).');
    } else {
        sendChatMessageToPlayer(player, '§aMoved the summoned group by (' + dx + ', ' + dy + ', ' + dz + ').');
    }
}

/** Rotate the summoned structure around its own centre. */
function executeRotate(player, args) {
    if (args.length < 1) {
        usage(player);
        return;
    }

    const degrees = parseFloat(args[0]);
    if (!Number.isFinite(degrees)) {
        sendChatMessageToPlayer(player, '§cInvalid angle.');
        return;
    }

    const axis = args.length >= 2 ? String(args[1]).toLowerCase() : 'y';
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') {
        sendChatMessageToPlayer(player, '§cAxis must be x, y or z.');
        return;
    }
    if (offgrid.getCellCount() === 0) {
        sendChatMessageToPlayer(player, '§cNothing summoned yet.');
        return;
    }

    offgrid.applyRotate(degrees, axis);
    offgrid.broadcastState();
    sendChatMessageToPlayer(player, '§aRotated the summoned group by ' + degrees + '° around ' + axis.toUpperCase());
}

/** Remove summoned blocks and every off-grid rendering. */
function executeClear(player) {
    const removed = offgrid.getCellCount();
    offgrid.applyClear();
    offgrid.broadcastState();
    sendChatMessageToPlayer(player, '§aCleared off-grid renderings' +
        (removed > 0 ? ' and ' + removed + ' summoned block(s)' : '') + '.');
}

/** /ofr: summon a rotated stone block field at the player's feet. */
function executeShortcut(player) {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(player.z)) {
        sendChatMessageToPlayer(player, '§cInvalid player position.');
        return;
    }

    const x = Math.floor(player.x);
    const y = Math.floor(player.y);
    const z = Math.floor(player.z);

    if (y < 0 || y + 8 > OFF_GRID_WORLD_HEIGHT) {
        sendChatMessageToPlayer(player, '§cNot enough room in the world for the 8x8x8 field here.');
        return;
    }

    const stone = BlockRegistry.STONE || resolveBlock('stone');
    if (!stone) {
        sendChatMessageToPlayer(player, '§cStone is not registered on this server.');
        return;
    }

    // Match the client shortcut: replace the current summoned field (but not
    // any separately rendered ghost blocks) with the stone block at the feet.
    offgrid.applyClearField();
    const count = offgrid.applyFill(x, y, z, 8, 8, 8, stone.getId(), 0);
    offgrid.applyRotate(45, 'x');
    offgrid.applyRotate(45, 'y');
    offgrid.applyRotate(45, 'z');
    offgrid.broadcastState();

    sendChatMessageToPlayer(player, '§aSummoned §f' + count + ' §rblocks of stone at (' +
        x + ', ' + y + ', ' + z + '), rotated 45° on all axes');
}

export { handleOffGridCommand };
