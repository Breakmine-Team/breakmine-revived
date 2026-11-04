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
 *              field's rotation pivot to the bearing's own axle
 *   spin()     turn the field by this tick's share of the drive
 *   release()  put every block back where it came from and empty the field
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

            const tick = world.ticks !== undefined ? world.ticks : world.time;
            const rpm = block.getShaftRpm(world, pos.x, pos.y, pos.z, tick);
            const direction = block.getShaftDirection(world, pos.x, pos.y, pos.z, tick);

            if (Number.isFinite(rpm) && rpm > 0) {
                if (BearingDrive.getGroup(world, pos.x, pos.y, pos.z) === null) {
                    BearingDrive.attach(world, pos.x, pos.y, pos.z);
                }
                BearingDrive.spin(world, pos.x, pos.y, pos.z, rpm, direction);
            } else {
                // Nothing is turning it: the structure comes back down.
                BearingDrive.release(world, pos.x, pos.y, pos.z);
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

        const group = {cells: cells, pivot: pivot};
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
        const field = group === null ? null : world.offGridField;
        const step = BearingDrive.stepFor(rpm, direction);

        if (!field || step === 0) {
            return false;
        }

        // rotate() only re-applies the group transform, so spinning costs one
        // matrix update a tick instead of re-tessellating the structure.
        field.rotate(step, "y");
        return true;
    }

    /**
     * Put the structure back: every block returns to the cell it was taken
     * from and the field is emptied. A cell the player broke while it was in
     * the OGR is not restored, so breaking part of a contraption still works.
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

        const field = world.offGridField || null;
        if (field) {
            // Drop the pose first: cells go back on the grid, where the blocks
            // about to be restored belong.
            field.setPose({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, null);
        }

        for (const cell of group.cells) {
            const carried = field !== null && field.covers(cell.x, cell.y, cell.z);
            if (carried) {
                // fromNetwork: these cells never reached the server.
                field.applyWrite(cell.x, cell.y, cell.z, 0, 0, true);
            }

            if (!carried && field !== null) {
                continue;
            }
            if (world.getBlockAt(cell.x, cell.y, cell.z) !== 0) {
                continue;
            }

            world.setBlockAt(cell.x, cell.y, cell.z, cell.typeId);
            if (cell.data) {
                world.setBlockDataAt(cell.x, cell.y, cell.z, cell.data);
            }
        }

        return true;
    }
}
