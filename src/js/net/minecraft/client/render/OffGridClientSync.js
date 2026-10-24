import OffGridBlockField from "./OffGridBlockField.js";
import OffGridBlockRenderer from "./OffGridBlockRenderer.js";
import Block from "../world/block/Block.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import ClientOffGridCellPacket from "../network/packet/play/client/ClientOffGridCellPacket.js";
import {
    OFF_GRID_UPDATE_ADD_GHOST,
    OFF_GRID_UPDATE_CLEAR_FIELD,
    OFF_GRID_UPDATE_CLEAR_GHOSTS,
    OFF_GRID_UPDATE_POSE,
    OFF_GRID_UPDATE_SET_CELL,
    OFF_GRID_WORLD_HEIGHT
} from "../../util/OffGridConstants.js";

function resolveBlock(typeId) {
    return Block.getById(typeId) || BlockRegistry.get(typeId);
}

/**
 * Route local field writes to the server. The field calls this after any
 * interactive edit (break, place, door/data update) and after the local
 * lifecycle writes that follow it, so every client converges on the server's
 * cell set. Server-originated writes pass fromNetwork=true and never echo.
 */
function attachCellSync(minecraft, field) {
    if (field._offGridSyncAttached) return;
    field._offGridSyncAttached = true;

    field.onCellChanged = (x, y, z, typeId, data) => {
        const networkHandler = minecraft.playerController?.getNetworkHandler?.();
        if (!networkHandler) return;
        const networkManager = networkHandler.getNetworkManager?.();
        if (!networkManager || !networkManager.isConnected()) return;
        networkHandler.sendPacket(new ClientOffGridCellPacket(x, y, z, typeId, data));
    };
}

/** Get the field bound to the current world, recreating it after a switch. */
function getOrBindField(minecraft) {
    if (!minecraft || !minecraft.world) return null;

    let field = minecraft.offGridBlockField;
    if (field && field.world === minecraft.world) {
        attachCellSync(minecraft, field);
        field.bind(minecraft.world);
        return field;
    }

    if (field) {
        field.dispose();
    }

    field = new OffGridBlockField(minecraft);
    attachCellSync(minecraft, field);
    field.bind(minecraft.world);
    minecraft.offGridBlockField = field;
    return field;
}

/** Get the ghost-block renderer bound to the current world. */
function getOrBindRenderer(minecraft) {
    if (!minecraft || !minecraft.world) return null;

    if (minecraft.offGridBlockRenderer) {
        minecraft.offGridBlockRenderer.world = minecraft.world;
        minecraft.offGridBlockRenderer.minecraft = minecraft;
        return minecraft.offGridBlockRenderer;
    }

    const renderer = new OffGridBlockRenderer(minecraft.world, minecraft);
    minecraft.offGridBlockRenderer = renderer;
    return renderer;
}

/** Apply a full server snapshot: replace the field and rebuild ghost meshes. */
function applyOffGridState(minecraft, state) {
    if (!minecraft || !minecraft.world || !state) return;

    const field = getOrBindField(minecraft);
    if (!field) return;

    field.applyNetworkSnapshot(state.cells, state.rotation, state.offset, state.pivot);

    let renderer = minecraft.offGridBlockRenderer;
    if (renderer) {
        renderer.clear();
    }

    const ghosts = Array.isArray(state.ghosts) ? state.ghosts : [];
    if (ghosts.length === 0) return;

    renderer = getOrBindRenderer(minecraft);
    for (const ghost of ghosts) {
        const block = resolveBlock(ghost.typeId);
        if (!block) continue;
        renderer.renderBlock(block, ghost.x, ghost.y, ghost.z, ghost.data || 0);
    }
}

/** Apply one incremental server update (cell edit, pose, ghost render, ...). */
function applyOffGridUpdate(minecraft, update) {
    if (!minecraft || !minecraft.world || !update) return;

    switch (update.action) {
        case OFF_GRID_UPDATE_SET_CELL: {
            if (!Number.isFinite(update.x) || !Number.isFinite(update.y) || !Number.isFinite(update.z)) return;
            if (update.y < 0 || update.y >= OFF_GRID_WORLD_HEIGHT) return;
            if (!Number.isFinite(update.typeId) || update.typeId < 0) return;
            if (update.typeId !== 0 && !resolveBlock(update.typeId)) return;
            if (update.typeId === 0) {
                // Removing a cell from an empty field is a no-op; don't create
                // a field (and its scene group) just to delete nothing.
                const field = minecraft.offGridBlockField;
                if (!field || field.world !== minecraft.world) return;
                field.applyRemoteWrite(update.x, update.y, update.z, 0, 0);
                return;
            }
            const field = getOrBindField(minecraft);
            if (field) {
                field.applyRemoteWrite(update.x, update.y, update.z, update.typeId, update.data || 0);
            }
            return;
        }

        case OFF_GRID_UPDATE_POSE: {
            const field = minecraft.offGridBlockField;
            if (!field || field.world !== minecraft.world) return;
            field.setPose(update.rotation, update.offset, update.pivot);
            return;
        }

        case OFF_GRID_UPDATE_CLEAR_FIELD: {
            const field = minecraft.offGridBlockField;
            if (field && field.world === minecraft.world) {
                field.clear();
            }
            return;
        }

        case OFF_GRID_UPDATE_ADD_GHOST: {
            const block = resolveBlock(update.typeId);
            if (!block) return;
            const renderer = getOrBindRenderer(minecraft);
            if (!renderer) return;
            renderer.renderBlock(block, update.x, update.y, update.z, update.data || 0);
            return;
        }

        case OFF_GRID_UPDATE_CLEAR_GHOSTS: {
            const renderer = minecraft.offGridBlockRenderer;
            if (renderer) renderer.clear();
            return;
        }

        default:
            return;
    }
}

export {
    getOrBindField,
    getOrBindRenderer,
    applyOffGridState,
    applyOffGridUpdate
};
