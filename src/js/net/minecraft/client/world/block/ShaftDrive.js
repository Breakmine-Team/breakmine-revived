import Block from "./Block.js";
import ShaftRenderer from "../../render/ShaftRenderer.js";

/**
 * Works out what turns a shaft-style block, and how fast.
 *
 * Power does not live in the blocks: a motor is the only source, and turning
 * spreads through the assembly from it. Ask this class for the drive at a
 * position and it walks the connected parts, finds any motor feeding them and
 * returns the RPM and direction that reach that block. A shaft or cog with no
 * motor anywhere in its assembly gets 0 RPM and therefore stands still.
 *
 * Two parts connect when
 *  - their axles line up and they touch end to end (a run of shafts, a cog on
 *    a shaft), keeping the same turning direction, or
 *  - they are both cogs with the same axle direction and touch rim to rim,
 *    which reverses the direction, exactly like two gears in mesh. Their
 *    speeds then go by radius, so a small cog driving a large one turns it
 *    slower, once round for every turn-and-two-thirds of the small one (a
 *    large cog only reaches the cogs on its diagonals, see compute), or
 *  - one of them is a gearbox and the other's axle runs straight into the face
 *    they share. A gearbox passes its own axle straight through, and its
 *    crossed axle meets it like bevel gears, which reverses the direction.
 *
 * Anything else - a shaft pressed against the side of a cog, two cogs on
 * crossed axles - does not transmit.
 */
export default class ShaftDrive {

    /** Most parts one assembly may contain before it stops spreading. */
    static MAX_MEMBERS = 512;

    /** A block nothing turns. */
    static IDLE = Object.freeze({rpm: 0, direction: 1});

    /** Six neighbours, with the axis each one lies along. */
    static NEIGHBOURS = Object.freeze([
        {delta: [0, -1, 0], axis: ShaftRenderer.AXIS.Y},
        {delta: [0, 1, 0], axis: ShaftRenderer.AXIS.Y},
        {delta: [-1, 0, 0], axis: ShaftRenderer.AXIS.X},
        {delta: [1, 0, 0], axis: ShaftRenderer.AXIS.X},
        {delta: [0, 0, -1], axis: ShaftRenderer.AXIS.Z},
        {delta: [0, 0, 1], axis: ShaftRenderer.AXIS.Z}
    ]);

    // One resolution per world per tick, shared by every part of the assembly.
    static cache = new WeakMap();

    /**
     * How `world` turns the part at (x, y, z) this tick.
     *
     * @returns {{rpm: number, direction: number}} rpm 0 when nothing drives it
     */
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

        // Every part found by the walk shares the result, so the rest of a long
        // line costs a map lookup instead of another walk.
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

    /** Drop this tick's results, e.g. after a machine part was placed or removed. */
    static invalidate(world) {
        if (world) {
            ShaftDrive.cache.delete(world);
        }
    }

    /**
     * A part was added or removed: forget the old topology and ask for the
     * cells around it to be re-meshed, because a part that was still (and so
     * baked into the section mesh) may now belong to a driven assembly and
     * needs a mesh of its own to turn.
     */
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

    /**
     * Walk the assembly containing (x, y, z).
     *
     * @returns {{drive: {rpm: number, direction: number}, members: {key: string, ratio: number}[]}}
     */
    static compute(world, x, y, z) {
        const block = ShaftDrive.blockAt(world, x, y, z);
        if (!ShaftDrive.isShaftPart(block)) {
            return {drive: ShaftDrive.IDLE, members: []};
        }

        const startKey = ShaftDrive.keyOf(x, y, z);

        // Signed speed factor from the start part to each member: +1 is the
        // same speed and way, -0.6 is slower and the other way round.
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

        // Every source found in this assembly, in the start part's frame.
        const drivers = [];

        for (let i = 0; i < queue.length; i++) {
            const member = queue[i];

            const driver = ShaftDrive.findDriver(world, member);
            if (driver !== null) {
                // Report every source in the start part's frame: undo the gear
                // ratios met along the walk, so two sources behind different
                // gearing are compared by what they turn the start at.
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

            // Add a part reached through `link` to the walk, unless it is
            // already in the assembly (a loop of gears comes back to itself).
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

            // A large cog's wheel fills its cell to the corners, so the only
            // cogs it is in mesh with sit diagonally from it: those are not
            // face neighbours, so they are collected here instead of through
            // the six steps above (where link() refuses the side contact).
            if (ShaftDrive.isCog(member.block)) {
                for (const delta of ShaftDrive.diagonalSteps(member.axis)) {
                    const nx = member.x + delta[0];
                    const ny = member.y + delta[1];
                    const nz = member.z + delta[2];

                    const neighbour = ShaftDrive.blockAt(world, nx, ny, nz);
                    if (!ShaftDrive.isCog(neighbour)) {
                        continue;
                    }

                    // Two small cogs only ever mesh side to side.
                    if (!ShaftDrive.isLargeCog(member.block) && !ShaftDrive.isLargeCog(neighbour)) {
                        continue;
                    }

                    const neighbourAxis = ShaftDrive.axisOf(world, nx, ny, nz, neighbour);
                    if (neighbourAxis !== member.axis) {
                        continue;
                    }

                    // Teeth in mesh turn the other way, at the speeds their
                    // radii give.
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

        // Two sources turning one assembly opposite ways fight and neither
        // wins: nothing turns until one of them is taken away.
        //
        // Different speeds in the same direction are not a fight. The faster
        // source powers the run and drags the slower one along with it, the way
        // a motor geared into a line that another already turns simply takes
        // over at its own speed. `source` already holds the fastest driver, so
        // the assembly turns at that one's RPM.
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

    /**
     * The connector a fighting assembly snaps, or null when this run is fine.
     *
     * Sources are never the ones that break: a driving motor or water wheel
     * survives and the shaft between the two of them shears. The lowest
     * coordinate key is chosen so the client and the server always snap the
     * same block instead of drifting apart.
     */
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

    /**
     * A motor bolted to this part and pointing into it, or null.
     * The motor's drive end must line up with the part's axle.
     */
    static findDriver(world, member) {
        // A water wheel makes its own power while water reaches it, so it
        // drives the assembly instead of waiting to be driven.
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

            // The motor only drives the cell its drive end points at.
            if (member.x - nx !== normal[0] ||
                member.y - ny !== normal[1] ||
                member.z - nz !== normal[2]) {
                continue;
            }

            // ... and only a part whose axle continues the motor shaft. A
            // gearbox also takes power on the axle crossed with its own, and
            // the bevel pair turns it the other way.
            let direction = block.getOutputDirection(data);
            if (block.getOutputAxis(data) !== member.axis) {
                // Only a flat gearbox takes power on a crossed axle; a vertical
                // one has no stub leaving that way.
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

    /**
     * How two touching parts pass rotation on, as a signed speed factor: 1 for
     * a straight link, the radius ratio (negated, because the teeth reverse the
     * direction) for meshing cogs, 0 for no connection.
     */
    static link(blockA, axisA, blockB, axisB, deltaAxis) {
        // A gearbox passes its own axle straight through and meets the crossed
        // axle at right angles, like bevel gears, so that way reverses.
        if (ShaftDrive.isGearbox(blockA) || ShaftDrive.isGearbox(blockB)) {
            const gear = ShaftDrive.isGearbox(blockA) ? blockA : blockB;
            const gearAxis = ShaftDrive.isGearbox(blockA) ? axisA : axisB;
            const otherAxis = ShaftDrive.isGearbox(blockA) ? axisB : axisA;

            // The other part's axle has to run straight at the shared face.
            if (deltaAxis !== otherAxis) {
                return 0;
            }

            // A flat gearbox runs two horizontal axles. The vertical one runs a
            // horizontal axle and a vertical shaft out of its top.
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

        // End to end on the same axle: a shaft run, or a cog on a shaft.
        if (deltaAxis === axisA) {
            return 1;
        }

        // Rim to rim in the same plane: cog teeth in mesh. The wheels turn at
        // speeds in inverse proportion to their radii, so a small cog driving a
        // large one turns it slower, and the teeth reverse the direction.
        if (ShaftDrive.isCog(blockA) && ShaftDrive.isCog(blockB)) {
            // A large cog is only in mesh with the cogs on its diagonals, so
            // it does not turn a cog that shares a side with it.
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

    /** Radius of a cog's wheel in block units, or 0 for parts that have none. */
    static cogRadius(block) {
        if (block === null || block === undefined || typeof block.getCogRadius !== "function") {
            return 0;
        }

        const radius = Number(block.getCogRadius());
        return Number.isFinite(radius) && radius > 0 ? radius : 0;
    }

    /**
     * Speed of cog B for one turn of cog A that meshes with it: radius A over
     * radius B. A small cog (9px) driving a large one (15px) turns it 0.6 times
     * as fast; the other way round the small one runs 5/3 as fast.
     */
    static ratioBetween(blockA, blockB) {
        const radiusA = ShaftDrive.cogRadius(blockA);
        const radiusB = ShaftDrive.cogRadius(blockB);

        if (radiusA <= 0 || radiusB <= 0) {
            return 1;
        }

        return radiusA / radiusB;
    }

    /**
     * The four steps that sit one cell along both axes of a cog's wheel - its
     * diagonals in the plane the wheel turns in.
     */
    static diagonalSteps(axis) {
        // Axis constants are not coordinate indices: Y is 0 there, but the
        // middle coordinate is the one that runs up.
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
