import Block from "./Block.js";
import ShaftRenderer from "../../render/ShaftRenderer.js";

export default class ShaftDrive {

    
    static MAX_MEMBERS = 512;

    
    static IDLE = Object.freeze({rpm: 0, direction: 1});

    
    static NEIGHBOURS = Object.freeze([
        {delta: [0, -1, 0], axis: ShaftRenderer.AXIS.Y},
        {delta: [0, 1, 0], axis: ShaftRenderer.AXIS.Y},
        {delta: [-1, 0, 0], axis: ShaftRenderer.AXIS.X},
        {delta: [1, 0, 0], axis: ShaftRenderer.AXIS.X},
        {delta: [0, 0, -1], axis: ShaftRenderer.AXIS.Z},
        {delta: [0, 0, 1], axis: ShaftRenderer.AXIS.Z}
    ]);

    static cache = new WeakMap();

    
    static resolve(world, x, y, z, tick) {
        if (!world || typeof world.getBlockAt !== "function" || typeof world.getBlockDataAt !== "function") {
            return ShaftDrive.IDLE;
        }

        const tickKey = Number(tick) || 0;
        let cache = ShaftDrive.cache.get(world);
        if (!cache || cache.tick !== tickKey) {
            cache = {tick: tickKey, results: new Map()};
            ShaftDrive.cache.set(world, cache);
        }

        const ownKey = ShaftDrive.keyOf(x, y, z);
        const cached = cache.results.get(ownKey);
        if (cached !== undefined) {
            return cached;
        }

        const assembly = ShaftDrive.compute(world, x, y, z);
        const result = assembly.drive;

        cache.results.set(ownKey, result);
        for (const member of assembly.members) {
            if (result.rpm === 0) {
                cache.results.set(member.key, ShaftDrive.IDLE);
            } else {
                cache.results.set(member.key, {
                    rpm: Math.abs(result.rpm * member.ratio),
                    direction: (result.direction * member.ratio) >= 0 ? 1 : -1
                });
            }
        }

        return result;
    }

    
    static invalidate(world) {
        if (world) {
            ShaftDrive.cache.delete(world);
        }
    }

    
    static refreshAround(world, x, y, z) {
        ShaftDrive.invalidate(world);

        if (!world || typeof world.onBlockChanged !== "function") {
            return;
        }

        world.onBlockChanged(x, y, z);
        for (const step of ShaftDrive.NEIGHBOURS) {
            world.onBlockChanged(x + step.delta[0], y + step.delta[1], z + step.delta[2]);
        }
    }

    
    static compute(world, x, y, z) {
        const block = ShaftDrive.blockAt(world, x, y, z);
        if (!ShaftDrive.isShaftPart(block)) {
            return {drive: ShaftDrive.IDLE, members: []};
        }

        const startKey = ShaftDrive.keyOf(x, y, z);

        const ratioByKey = new Map();
        ratioByKey.set(startKey, 1);

        const queue = [{
            x: x, y: y, z: z,
            block: block,
            axis: ShaftDrive.axisOf(world, x, y, z, block),
            ratio: 1,
            key: startKey
        }];

        let source = null;

        const drivers = [];

        for (let i = 0; i < queue.length; i++) {
            const member = queue[i];

            const driver = ShaftDrive.findDriver(world, member);
            if (driver !== null) {
                const scale = Math.abs(member.ratio) || 1;
                const drive = {
                    rpm: driver.rpm / scale,
                    direction: (driver.direction * member.ratio) >= 0 ? 1 : -1,
                    key: member.key
                };
                drivers.push(drive);

                if (source === null || drive.rpm > source.rpm) {
                    source = {rpm: drive.rpm, direction: drive.direction};
                }
            }

            if (ratioByKey.size >= ShaftDrive.MAX_MEMBERS) {
                continue;
            }

            const visit = (nx, ny, nz, neighbour, neighbourAxis, link) => {
                if (link === 0) {
                    return;
                }

                const neighbourKey = ShaftDrive.keyOf(nx, ny, nz);
                if (ratioByKey.has(neighbourKey)) {
                    return;
                }

                const neighbourRatio = member.ratio * link;
                ratioByKey.set(neighbourKey, neighbourRatio);
                queue.push({
                    x: nx, y: ny, z: nz,
                    block: neighbour,
                    axis: neighbourAxis,
                    ratio: neighbourRatio,
                    key: neighbourKey
                });
            };

            for (const step of ShaftDrive.NEIGHBOURS) {
                const nx = member.x + step.delta[0];
                const ny = member.y + step.delta[1];
                const nz = member.z + step.delta[2];

                const neighbour = ShaftDrive.blockAt(world, nx, ny, nz);
                if (!ShaftDrive.isShaftPart(neighbour)) {
                    continue;
                }

                const neighbourAxis = ShaftDrive.axisOf(world, nx, ny, nz, neighbour);
                visit(nx, ny, nz, neighbour, neighbourAxis,
                    ShaftDrive.link(member.block, member.axis, neighbour, neighbourAxis, step.axis));
            }

            if (ShaftDrive.isCog(member.block)) {
                for (const delta of ShaftDrive.diagonalSteps(member.axis)) {
                    const nx = member.x + delta[0];
                    const ny = member.y + delta[1];
                    const nz = member.z + delta[2];

                    const neighbour = ShaftDrive.blockAt(world, nx, ny, nz);
                    if (!ShaftDrive.isCog(neighbour)) {
                        continue;
                    }

                    if (!ShaftDrive.isLargeCog(member.block) && !ShaftDrive.isLargeCog(neighbour)) {
                        continue;
                    }

                    const neighbourAxis = ShaftDrive.axisOf(world, nx, ny, nz, neighbour);
                    if (neighbourAxis !== member.axis) {
                        continue;
                    }

                    visit(nx, ny, nz, neighbour, neighbourAxis,
                        -ShaftDrive.ratioBetween(member.block, neighbour));
                }
            }
        }

        const members = [];
        for (const entry of queue) {
            members.push({
                key: entry.key,
                ratio: entry.ratio,
                x: entry.x,
                y: entry.y,
                z: entry.z,
                block: entry.block
            });
        }

        const conflict = drivers.some((driver) => drivers.some((other) =>
            other !== driver &&
            (other.direction >= 0) !== (driver.direction >= 0)));

        return {
            drive: conflict || source === null
                ? ShaftDrive.IDLE
                : {rpm: source.rpm, direction: source.direction >= 0 ? 1 : -1},
            members: members,
            conflict: conflict,
            drivers: drivers
        };
    }

    
    static findSnapCandidate(world, x, y, z) {
        const assembly = ShaftDrive.compute(world, x, y, z);
        if (!assembly || assembly.conflict !== true) {
            return null;
        }

        let candidate = null;
        for (const member of assembly.members) {
            const block = member.block;
            if (!block || block.isShaftMotor === true || block.isWaterWheel === true) {
                continue;
            }

            if (candidate === null || member.key < candidate) {
                candidate = member.key;
            }
        }

        return candidate;
    }

    
    static findDriver(world, member) {
        if (member.block && member.block.isWaterWheel === true &&
            typeof member.block.getWaterDrive === "function") {
            const waterDrive = member.block.getWaterDrive(world, member.x, member.y, member.z);
            if (waterDrive !== null) {
                return waterDrive;
            }
        }

        for (const step of ShaftDrive.NEIGHBOURS) {
            const nx = member.x + step.delta[0];
            const ny = member.y + step.delta[1];
            const nz = member.z + step.delta[2];

            const block = ShaftDrive.blockAt(world, nx, ny, nz);
            if (!block || block.isShaftMotor !== true) {
                continue;
            }

            const data = world.getBlockDataAt(nx, ny, nz);
            const normal = block.getOutputNormal(data);

            if (member.x - nx !== normal[0] ||
                member.y - ny !== normal[1] ||
                member.z - nz !== normal[2]) {
                continue;
            }

            let direction = block.getOutputDirection(data);
            if (block.getOutputAxis(data) !== member.axis) {
                if (!ShaftDrive.isGearbox(member.block) || member.block.vertical === true) {
                    continue;
                }
                direction = -direction;
            }

            return {
                rpm: block.getOutputRpm(data),
                direction: direction
            };
        }

        return null;
    }

    
    static link(blockA, axisA, blockB, axisB, deltaAxis) {
        if (ShaftDrive.isGearbox(blockA) || ShaftDrive.isGearbox(blockB)) {
            const gear = ShaftDrive.isGearbox(blockA) ? blockA : blockB;
            const gearAxis = ShaftDrive.isGearbox(blockA) ? axisA : axisB;
            const otherAxis = ShaftDrive.isGearbox(blockA) ? axisB : axisA;

            if (deltaAxis !== otherAxis) {
                return 0;
            }

            if (gear.vertical === true) {
                if (otherAxis !== gearAxis && otherAxis !== ShaftRenderer.AXIS.Y) {
                    return 0;
                }
            } else if (otherAxis === ShaftRenderer.AXIS.Y) {
                return 0;
            }

            return otherAxis === gearAxis ? 1 : -1;
        }

        if (axisA !== axisB) {
            return 0;
        }

        if (deltaAxis === axisA) {
            return 1;
        }

        if (ShaftDrive.isCog(blockA) && ShaftDrive.isCog(blockB)) {
            if (ShaftDrive.isLargeCog(blockA) || ShaftDrive.isLargeCog(blockB)) {
                return 0;
            }

            return -ShaftDrive.ratioBetween(blockA, blockB);
        }

        return 0;
    }

    static blockAt(world, x, y, z) {
        return Block.getById(world.getBlockAt(x, y, z));
    }

    static axisOf(world, x, y, z, block) {
        if (block && typeof block.getAxis === "function") {
            return block.getAxis(world.getBlockDataAt(x, y, z));
        }
        return ShaftRenderer.getAxis(world.getBlockDataAt(x, y, z));
    }

    static isShaftPart(block) {
        return block !== null && block !== undefined && block.isShaftPart === true;
    }

    static isGearbox(block) {
        return block !== null && block !== undefined && block.isGearbox === true;
    }

    static isCog(block) {
        return block !== null && block !== undefined &&
            typeof block.isCog === "function" && block.isCog() === true;
    }

    static isLargeCog(block) {
        return block !== null && block !== undefined && block.isLargeCog === true;
    }

    
    static cogRadius(block) {
        if (block === null || block === undefined || typeof block.getCogRadius !== "function") {
            return 0;
        }

        const radius = Number(block.getCogRadius());
        return Number.isFinite(radius) && radius > 0 ? radius : 0;
    }

    
    static ratioBetween(blockA, blockB) {
        const radiusA = ShaftDrive.cogRadius(blockA);
        const radiusB = ShaftDrive.cogRadius(blockB);

        if (radiusA <= 0 || radiusB <= 0) {
            return 1;
        }

        return radiusA / radiusB;
    }

    
    static diagonalSteps(axis) {
        const coordinate = axis === ShaftRenderer.AXIS.X ? 0
            : axis === ShaftRenderer.AXIS.Z ? 2
                : 1;

        const plane = [0, 1, 2].filter((candidate) => candidate !== coordinate);

        const steps = [];
        for (const first of [-1, 1]) {
            for (const second of [-1, 1]) {
                const delta = [0, 0, 0];
                delta[plane[0]] = first;
                delta[plane[1]] = second;
                steps.push(delta);
            }
        }

        return steps;
    }

    static keyOf(x, y, z) {
        return x + "," + y + "," + z;
    }
}
