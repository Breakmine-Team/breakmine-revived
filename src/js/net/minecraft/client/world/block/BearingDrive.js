import Block from "./Block.js";
import ShaftDrive from "./ShaftDrive.js";
import { getOrBindField } from "../../render/OffGridClientSync.js";

export default class BearingDrive {

    
    static MAX_CELLS = 64;

    
    static MAX_VISITED = 256;

    
    static DEGREES_PER_RPM = 0.3;

    
    static RELEASE_TICKS = 10;

    static groups = new WeakMap();

    static bearings = new WeakMap();

    
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

        field._suppressCellSync = true;

        for (const cell of cells) {
            world.setBlockAt(cell.x, cell.y, cell.z, 0);
        }

        for (const cell of cells) {
            field.fill(cell.x, cell.y, cell.z, 1, 1, 1, cell.typeId, cell.data);
        }

        const pivot = {x: x + 0.5, y: y + 1, z: z + 0.5};
        field.setPose({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, pivot);

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

    
    static spin(world, x, y, z, rpm, direction) {
        const group = BearingDrive.getGroup(world, x, y, z);
        const field = group === null ? null : group.field;
        const step = BearingDrive.stepFor(rpm, direction);

        if (!field || field !== world.offGridField || step === 0) {
            return false;
        }

        field.rotate(step, "y");
        return true;
    }

    
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

        const field = group.field !== null && group.field === world.offGridField
            ? group.field : null;
        if (field) {
            field.onCellEdit = null;
            field._suppressCellSync = false;

            field.setPose({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, null);
        }

        for (const cell of group.live.values()) {
            if (field !== null && field.covers(cell.x, cell.y, cell.z)) {
                field.applyWrite(cell.x, cell.y, cell.z, 0, 0, true);
            }

            if (world.getBlockAt(cell.x, cell.y, cell.z) !== 0) {
                continue;
            }

            world.setBlockAt(cell.x, cell.y, cell.z, cell.typeId);
            if (cell.data) {
                world.setBlockDataAt(cell.x, cell.y, cell.z, cell.data);
            }
        }

        if (field) {
            for (const cell of [...field.cells.values()]) {
                field.applyWrite(cell.x, cell.y, cell.z, 0, 0, true);
            }
        }

        return true;
    }
}
