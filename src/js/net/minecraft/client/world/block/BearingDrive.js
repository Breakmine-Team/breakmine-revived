import Block from "./Block.js";
import ShaftDrive from "./ShaftDrive.js";
import { getOrBindField } from "../../render/OffGridClientSync.js";

/**
 * The contraption half of the mechanical bearing.
 *
 * A bearing does not turn blocks in the chunk grid: arbitrary angles cannot be
 * baked into it. Instead it hands the structure sitting on its face to the
 * off-grid renderer (the OGR), which owns the cells as a posed group. The real
 * blocks are taken out of the world while they belong to the OGR, so they are
 * drawn once, in the posed space.
 *
 *   attach()   gather the connected blocks on the bearing's top face, remove
 *              them from the world, write them into the field and pin the
 *              field's rotation pivot to the bearing's own axle. The group
 *              also keeps a live copy of those cells
 *   spin()     turn the field by this tick's share of the drive
 *   release()  put back exactly what the live copy holds - blocks the player
 *              placed on the structure included, blocks they broke excluded -
 *              and empty the field
 *
 * Only the field that already exists is used, and only while it is empty: the
 * off-grid renderer holds one group per world, so a second bearing waits until
 * the first one lets go instead of mixing its blocks into someone else's OGR.
 */
export default class BearingDrive {

    /** Most blocks one bearing may carry. */
    static MAX_CELLS = 64;

    /** Cells walked while searching for the structure, shafts included. */
    static MAX_VISITED = 256;

    /** One RPM is one turn a minute: 360 / 60 / 20 degrees a tick. */
    static DEGREES_PER_RPM = 0.3;

    /**
     * Undriven ticks a bearing waits before its structure comes back down. One
     * stalled tick must not pull the whole load out of the world and back in.
     */
    static RELEASE_TICKS = 10;

    // world -> Map("x,y,z" of the bearing -> {cells, pivot})
    static groups = new WeakMap();

    // world -> Map("x,y,z" -> {x, y, z}) of bearings that want driving. The
    // world tick asks here every tick, because block ticks never run on a
    // client in multiplayer.
    static bearings = new WeakMap();

    /** Degrees the field turns each tick at `rpm`, signed by `direction`. */
    static stepFor(rpm, direction) {
        const rate = Number(rpm);
        if (!Number.isFinite(rate) || rate === 0) {
            return 0;
        }

        return (direction < 0 ? -1 : 1) * rate * BearingDrive.DEGREES_PER_RPM;
    }

    static keyOf(x, y, z) {
        return x + "," + y + "," + z;
    }

    static getGroup(world, x, y, z) {
        const groups = world ? BearingDrive.groups.get(world) : null;
        return groups ? groups.get(BearingDrive.keyOf(x, y, z)) || null : null;
    }

    /**
     * True while the field still holds the structure this group carries. A
     * field that was cleared or replaced under the group must not be spun: the
     * group's cells are not in it any more, and turning it would move another
     * system's cells while this group's blocks were lost.
     */
    static stillCarried(group) {
        if (!group || !group.field || !group.live || group.live.size === 0) {
            return false;
        }

        for (const cell of group.live.values()) {
            if (group.field.covers(cell.x, cell.y, cell.z)) {
                return true;
            }
        }

        return false;
    }

    /** Ask the world tick to drive the bearing at (x, y, z). */
    static register(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== "function") {
            return;
        }

        let bearings = BearingDrive.bearings.get(world);
        if (!bearings) {
            bearings = new Map();
            BearingDrive.bearings.set(world, bearings);
        }

        const key = BearingDrive.keyOf(x, y, z);
        if (!bearings.has(key)) {
            bearings.set(key, {x: x, y: y, z: z});
        }
    }

    static unregister(world, x, y, z) {
        const bearings = world ? BearingDrive.bearings.get(world) : null;
        if (bearings) {
            bearings.delete(BearingDrive.keyOf(x, y, z));
        }
    }

    /**
     * Drive every registered bearing once. This is the multiplayer path: the
     * client's block ticks are switched off there, so the world tick calls in
     * instead. A bearing that has been broken or replaced unregisters itself.
     */
    static tickWorld(world) {
        const bearings = world ? BearingDrive.bearings.get(world) : null;
        if (!bearings || bearings.size === 0) {
            return;
        }

        for (const [key, pos] of bearings) {
            const block = Block.getById(world.getBlockAt(pos.x, pos.y, pos.z));
            if (!block || block.isMechanicalBearing !== true) {
                bearings.delete(key);
                BearingDrive.release(world, pos.x, pos.y, pos.z);
                continue;
            }

            let group = BearingDrive.getGroup(world, pos.x, pos.y, pos.z);

            // The field the structure was written into is gone or was replaced
            // (world switch, another system resetting it). Put the blocks back
            // first: the drive re-attaches them to the current field below.
            if (group !== null &&
                (group.field !== world.offGridField || !BearingDrive.stillCarried(group))) {
                BearingDrive.release(world, pos.x, pos.y, pos.z);
                group = null;
            }

            const tick = world.ticks !== undefined ? world.ticks : world.time;
            const rpm = block.getShaftRpm(world, pos.x, pos.y, pos.z, tick);
            const direction = block.getShaftDirection(world, pos.x, pos.y, pos.z, tick);

            if (Number.isFinite(rpm) && rpm > 0) {
                if (group === null) {
                    group = BearingDrive.attach(world, pos.x, pos.y, pos.z);
                }
                if (group !== null) {
                    // Each driven tick keeps the structure up; only a drive
                    // that has stopped counts down to the release.
                    group.idle = 0;
                    BearingDrive.spin(world, pos.x, pos.y, pos.z, rpm, direction);
                }
            } else if (group !== null) {
                group.idle = (group.idle || 0) + 1;
                if (group.idle >= BearingDrive.RELEASE_TICKS) {
                    BearingDrive.release(world, pos.x, pos.y, pos.z);
                }
            }
        }
    }

    /**
     * Cells that would be carried by a bearing at (x, y, z): everything
     * connected to the cell on top of it, stopping at air and at other machine
     * parts (shafts, cogs, bearings), which stay bolted down.
     */
    static collect(world, x, y, z) {
        const cells = [];
        if (!world || typeof world.getBlockAt !== "function") {
            return cells;
        }

        const start = {x: x, y: y + 1, z: z};
        const seen = new Set([BearingDrive.keyOf(start.x, start.y, start.z)]);
        const queue = [start];
        let visited = 0;

        while (queue.length > 0 && visited < BearingDrive.MAX_VISITED) {
            const cell = queue.shift();
            visited++;

            const typeId = world.getBlockAt(cell.x, cell.y, cell.z);
            if (!typeId) {
                continue;
            }

            const block = Block.getById(typeId);
            if (!block) {
                continue;
            }

            // Machine parts are the frame, not the load.
            const machine = block.isShaftPart === true || block.isMechanicalBearing === true;
            if (!machine && cells.length < BearingDrive.MAX_CELLS) {
                cells.push({
                    x: cell.x,
                    y: cell.y,
                    z: cell.z,
                    typeId: typeId,
                    data: world.getBlockDataAt(cell.x, cell.y, cell.z)
                });
            }

            if (machine || cells.length >= BearingDrive.MAX_CELLS) {
                continue;
            }

            for (const step of ShaftDrive.NEIGHBOURS) {
                const nx = cell.x + step.delta[0];
                const ny = cell.y + step.delta[1];
                const nz = cell.z + step.delta[2];
                const key = BearingDrive.keyOf(nx, ny, nz);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                queue.push({x: nx, y: ny, z: nz});
            }
        }

        return cells;
    }

    /**
     * Take the structure on top of the bearing into the off-grid renderer.
     *
     * @returns {object|null} the group that was created, or null when there was
     *          nothing to carry or the field already belongs to another OGR
     */
    static attach(world, x, y, z) {
        if (!world || BearingDrive.getGroup(world, x, y, z) !== null) {
            return null;
        }

        const field = getOrBindField(world.minecraft || null);
        if (!field || field.cells.size > 0) {
            return null;
        }

        const cells = BearingDrive.collect(world, x, y, z);
        if (cells.length === 0) {
            return null;
        }

        // Cell sync stays off for the whole attach, not just for the bulk
        // fill: the server's field has never held these cells (a bearing
        // structure is local), so any cell packet from this window is rejected
        // there and answered with a full snapshot, which empties the field -
        // and with it the structure. release() turns sync back on.
        field._suppressCellSync = true;

        // Lift the blocks out of the world first, so the field is the only
        // place they are drawn.
        for (const cell of cells) {
            world.setBlockAt(cell.x, cell.y, cell.z, 0);
        }

        for (const cell of cells) {
            field.fill(cell.x, cell.y, cell.z, 1, 1, 1, cell.typeId, cell.data);
        }

        // The OGR turns about the bearing's own axle, not about the middle of
        // the structure, so the load swings around the bearing.
        const pivot = {x: x + 0.5, y: y + 1, z: z + 0.5};
        field.setPose({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, pivot);

        // The live copy is what release() restores. Every edit made while the
        // structure is carried - a block placed on it, one broken off it -
        // updates the copy, so a field reset can never make the carrier put
        // back less than the player left behind, and can never resurrect a
        // block the player broke.
        const group = {cells: cells, live: new Map(), field: field, pivot: pivot, idle: 0};
        for (const cell of cells) {
            group.live.set(BearingDrive.keyOf(cell.x, cell.y, cell.z), {
                x: cell.x, y: cell.y, z: cell.z,
                typeId: cell.typeId,
                data: cell.data || 0
            });
        }

        field.onCellEdit = (ex, ey, ez, typeId, data) => {
            const cellKey = BearingDrive.keyOf(ex, ey, ez);
            if (typeId > 0) {
                group.live.set(cellKey, {x: ex, y: ey, z: ez, typeId: typeId, data: data || 0});
            } else {
                group.live.delete(cellKey);
            }
        };

        let groups = BearingDrive.groups.get(world);
        if (!groups) {
            groups = new Map();
            BearingDrive.groups.set(world, groups);
        }
        groups.set(BearingDrive.keyOf(x, y, z), group);

        return group;
    }

    /** Turn the carried structure by one tick's worth of the drive. */
    static spin(world, x, y, z, rpm, direction) {
        const group = BearingDrive.getGroup(world, x, y, z);
        const field = group === null ? null : group.field;
        const step = BearingDrive.stepFor(rpm, direction);

        if (!field || field !== world.offGridField || step === 0) {
            return false;
        }

        // rotate() only re-applies the group transform, so spinning costs one
        // matrix update a tick instead of re-tessellating the structure.
        field.rotate(step, "y");
        return true;
    }

    /**
     * Put the structure back: the live copy returns to the grid and the field is
     * emptied. Blocks the player broke while it was carried are already out of
     * the copy, and blocks they placed on it are in it, so both edits stick.
     *
     * The copy - not the field - decides what is restored: a field that was
     * reset (a server snapshot, another system clearing it) used to make every
     * cell look broken, and everything the field no longer covered was simply
     * dropped. These blocks are deleted from the world at attach, so dropping
     * them removed the whole structure from the save.
     */
    static release(world, x, y, z) {
        const groups = world ? BearingDrive.groups.get(world) : null;
        if (!groups) {
            return false;
        }

        const key = BearingDrive.keyOf(x, y, z);
        const group = groups.get(key);
        if (!group) {
            return false;
        }
        groups.delete(key);

        // Only touch the field this group filled: a replacement field belongs
        // to whoever created it.
        const field = group.field !== null && group.field === world.offGridField
            ? group.field : null;
        if (field) {
            field.onCellEdit = null;
            field._suppressCellSync = false;

            // Drop the pose first: cells go back on the grid, where the blocks
            // about to be restored belong.
            field.setPose({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, null);
        }

        for (const cell of group.live.values()) {
            if (field !== null && field.covers(cell.x, cell.y, cell.z)) {
                // fromNetwork: these cells never reached the server.
                field.applyWrite(cell.x, cell.y, cell.z, 0, 0, true);
            }

            // Something else already occupies the cell (the player built there
            // while the structure was carried): never overwrite it.
            if (world.getBlockAt(cell.x, cell.y, cell.z) !== 0) {
                continue;
            }

            world.setBlockAt(cell.x, cell.y, cell.z, cell.typeId);
            if (cell.data) {
                world.setBlockDataAt(cell.x, cell.y, cell.z, cell.data);
            }
        }

        // Anything left in the field was ours and did not make it back (a cell
        // the live copy never saw). Clear it so the field is free for the next
        // structure instead of blocking every bearing that comes after.
        if (field) {
            for (const cell of [...field.cells.values()]) {
                field.applyWrite(cell.x, cell.y, cell.z, 0, 0, true);
            }
        }

        return true;
    }
}
