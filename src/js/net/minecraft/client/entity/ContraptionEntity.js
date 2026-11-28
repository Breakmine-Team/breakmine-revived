import Entity from "./Entity.js";
import ContraptionBody from "../physics/ContraptionBody.js";
import OffGridBlockField from "../render/OffGridBlockField.js";
import Block from "../world/block/Block.js";
import BlockBoatCore from "../world/block/type/BlockBoatCore.js";
import * as THREE from "../../../../../../libraries/three.module.js";

// A pile of blocks that an Assembler glued together. The whole thing is one
// rigid body, so it falls, tumbles and comes to rest as a single object.
//
// The cells live in an OffGridBlockField, the same container bearings use, so
// picking, placing, breaking and collision all go through the existing off grid
// logic. The field is only a carrier for the blocks; the body below owns the
// motion and pushes its pose into the field every tick.
export default class ContraptionEntity extends Entity {

    // A body that has not moved noticeably for a second is put to sleep, so
    // resting contacts stop buzzing.
    static SLEEP_TICKS = 20;
    static SLEEP_LINEAR_SPEED = 0.02;
    static SLEEP_ANGULAR_SPEED = 0.03;

    static VOID_Y = -32;

    static RAD_TO_DEG = 180.0 / Math.PI;

    // How often a simulated body reports its pose to the server, so a world that
    // is saved and loaded again gets the contraption back where it was instead
    // of losing it.
    static SYNC_INTERVAL = 20;

    // A moving body also reports just its pose this often. The full state (all
    // cells) only goes out every SYNC_INTERVAL ticks, but a pose report is what
    // lets another client carry a player standing on the contraption smoothly.
    static POSE_SYNC_INTERVAL = 2;

    // How far in front of the eyes a contraption carried by the physics wand
    // floats.
    static HOLD_DISTANCE = 3.0;

    // Water is twice as heavy as a default block, so a contraption made of
    // ordinary blocks floats back up to the surface instead of sinking.
    static WATER_DENSITY = 2.0;

    // Water is thick. Every wet tick it keeps this much of the vertical velocity,
    // this much of the horizontal velocity (scaled by how wet the body is) and
    // this much of the spin. Without strong vertical damping a body that has
    // buoyancy stronger than its weight keeps hopping out of the surface and
    // dropping back in forever; that was the bouncing.
    static WATER_VERTICAL_DRAG = 0.55;
    static WATER_HORIZONTAL_DRAG = 0.9;
    static WATER_ANGULAR_DRAG = 0.7;

    // A light cell carries so little inertia that buoyancy acting off centre
    // would spin the body several turns a second. Wet bodies only turn this fast.
    static MAX_WET_SPIN = 0.05;

    // Speeds a wet body may move at vertically: it floats up slowly and does not
    // plunge, so it never has to rocket back to the surface.
    static MAX_FLOAT_SPEED = 0.06;
    static MAX_SINK_SPEED = 0.35;

    constructor(minecraft, world, blocks, x, y, z, options = null) {
        super(minecraft, world, -2);

        // A body received from the server is a replay of another client's pose
        // and never runs physics of its own.
        this.remote = !!(options && options.remote);
        this.syncId = options && options.syncId
            ? String(options.syncId)
            : ContraptionEntity.makeSyncId();

        this.cells = blocks.map((block) => ({
            x: block.x,
            y: block.y,
            z: block.z,
            id: block.id,
            data: block.data || 0
        }));
        this.boatCores = this.findBoatCores(this.cells);

        // Centre of gravity in field local block coordinates. Heavy blocks pull
        // it towards themselves, which is what makes a lopsided contraption tip
        // and float leaning instead of balancing like a plain box.
        this.center = ContraptionEntity.centerOfMass(this.cells);

        // A contraption carried by the physics wand stops simulating physics
        // and follows the player instead.
        this.heldByPlayer = false;

        // The player steering this boat, or null. Their walking keys drive the
        // contraption and carry them along instead of moving them.
        this.pilot = null;

        // Cell the local player is standing on, remembered between ticks so a
        // rocking hull keeps them on the same deck instead of on whatever cell
        // happens to be nearest that tick.
        this.riderSupport = null;

        // Keys relayed from a player steering this body from another client, or
        // null. That client only has a replay, so the keys have to come here.
        this.remotePilot = null;

        // Whether any cell was in water on the last tick.
        this.inWater = false;

        // A replayed body does not know where it belongs until the first pose
        // arrives. That first pose is a spawn, not movement, so it carries
        // nobody standing where the body appears.
        this.hasRemotePose = false;

        this.body = new ContraptionBody(this.createBodyCells(this.cells, this.center));
        this.body.pos.set(x, y, z);
        this.body.prevPos.copy(this.body.pos);
        this.body.prevQuat.copy(this.body.quat);

        this.width = Math.max(0.5, this.body.size.x);
        this.height = Math.max(0.5, this.body.size.y);

        this.asleep = false;
        this.quietTicks = 0;

        this.brightness = world && typeof world.getLightBrightness === "function"
            ? world.getLightBrightness(Math.floor(x), Math.floor(y), Math.floor(z))
            : 1.0;

        // Light the blocks were baked with, so a body that drifts into shade or
        // out into the sun knows its meshes are stale.
        this.lightingBrightness = this.brightness;

        this.field = this.createField(minecraft, world);
        this.syncFieldPose();

        this.setPositionAndRotation(x, y, z, 0.0, 0.0);
        this.updateBoundingBox();

        this.initRenderer();
    }

    static makeSyncId() {
        return "contraption-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }

    static isFiniteVector(vector) {
        return !!vector && [vector.x, vector.y, vector.z].every((value) =>
            typeof value === "number" && Number.isFinite(value));
    }

    // One cell weighs as much as its block. Every block defaults to 1 kg, and
    // the body adds the cells up, so heavy blocks make a heavy contraption.
    static getBlockMass(id) {
        const block = Block.getById(id);
        const mass = block === null ? 1.0 : block.mass;
        return Number.isFinite(mass) && mass > 0.0 ? mass : 1.0;
    }

    // Mass weighted centre of the cells, in field block coordinates. A stack of
    // iron on the mast pulls it up there, so the body pivots and floats around
    // that point instead of around the middle of its bounding box.
    static centerOfMass(cells) {
        let mass = 0.0;
        let x = 0.0;
        let y = 0.0;
        let z = 0.0;

        for (const cell of cells) {
            const cellMass = ContraptionEntity.getBlockMass(cell.id);

            mass += cellMass;
            x += (cell.x + 0.5) * cellMass;
            y += (cell.y + 0.5) * cellMass;
            z += (cell.z + 0.5) * cellMass;
        }

        if (!(mass > 0.0)) {
            return { x: 0.0, y: 0.0, z: 0.0 };
        }

        return { x: x / mass, y: y / mass, z: z / mass };
    }

    // Build a contraption from a reported state. A body restored from a save is
    // simulated on this client, a live one from another client is only replayed.
    static fromNetworkState(minecraft, world, state, remote = true) {
        if (!state || !Array.isArray(state.cells) || state.cells.length === 0) {
            return null;
        }

        const cells = [];
        for (const cell of state.cells) {
            if (!cell || typeof cell !== "object") {
                return null;
            }

            const x = Math.trunc(Number(cell.x));
            const y = Math.trunc(Number(cell.y));
            const z = Math.trunc(Number(cell.z));
            const id = Math.trunc(Number(cell.id));
            const data = Math.trunc(Number(cell.data) || 0);

            if (![x, y, z, id].every((value) => Number.isInteger(value)) || id <= 0) {
                return null;
            }

            cells.push({x: x, y: y, z: z, id: id, data: Math.max(0, Math.min(15, data))});
        }

        if (!ContraptionEntity.isFiniteVector(state.center) || !ContraptionEntity.isFiniteVector(state.pos)) {
            return null;
        }

        const contraption = new ContraptionEntity(
            minecraft, world, cells,
            state.center.x, state.center.y, state.center.z,
            {remote: remote, syncId: state.id}
        );

        contraption.applyRemoteState(state);

        return contraption;
    }

    // Cells that make this contraption a boat. A core is only useful while it
    // is part of the body, so the list is rebuilt with the cells.
    findBoatCores(cells) {
        return cells.filter((cell) => {
            const block = Block.getById(cell.id);
            return block !== null && block.isBoatCore === true;
        });
    }

    createBodyCells(cells, center) {
        return cells.map((cell) => ({
            x: cell.x,
            y: cell.y,
            z: cell.z,
            id: cell.id,
            data: cell.data,
            mass: ContraptionEntity.getBlockMass(cell.id),
            offset: new THREE.Vector3(
                cell.x + 0.5 - center.x,
                cell.y + 0.5 - center.y,
                cell.z + 0.5 - center.z
            )
        }));
    }

    createField(minecraft, world) {
        const field = new OffGridBlockField(minecraft);

        // The contraption is client side only, so cell edits never go to the
        // network and neighbours are read from the contraption itself.
        field._suppressCellSync = true;
        field.isolateNeighbors = true;

        // A hull the player stands on collides as its real tilted cells, not as
        // boxes squared off around them.
        field.exactCollision = true;

        // The body owns its cells. The server still remembers the blocks the
        // assembler took and reports them as air; letting those writes through
        // would empty the field and delete the contraption right after it spawns.
        field.acceptsRemoteWrites = false;
        field.bind(world, true);

        field.applyNetworkSnapshot(
            this.cells.map((cell) => ({
                x: cell.x,
                y: cell.y,
                z: cell.z,
                typeId: cell.id,
                data: cell.data
            })),
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 },
            { x: this.center.x, y: this.center.y, z: this.center.z }
        );

        // Between ticks draw the exact halfway quaternion and centre of mass
        // instead of the Euler angles, so a tumbling contraption stays smooth.
        field.interpolateRotation = (partialTicks) => {
            const pose = this.getInterpolatedPose(partialTicks);
            field.group.quaternion.copy(pose.quaternion);
            field.group.position.copy(pose.position);
            field.group.updateMatrix();
            field.group.updateMatrixWorld(true);
        };

        field.getInterpolatedPoseTransform = (partialTicks) => {
            const pose = this.getInterpolatedPose(partialTicks);
            const euler = new THREE.Euler().setFromQuaternion(pose.quaternion, "XYZ");

            return {
                position: {
                    x: pose.position.x,
                    y: pose.position.y,
                    z: pose.position.z
                },
                rotation: {
                    x: euler.x,
                    y: euler.y,
                    z: euler.z
                }
            };
        };

        // Placing or breaking a cell changes what the body is made of.
        field.onCellEdit = () => this.rebuildFromField();

        return field;
    }

    // World pose of the field: rotate around the centre of mass, then move that
    // point to the body position.
    syncFieldPose() {
        if (this.field === null) {
            return;
        }

        const euler = new THREE.Euler().setFromQuaternion(this.body.quat, "XYZ");

        this.field.rotation = {
            x: euler.x * ContraptionEntity.RAD_TO_DEG,
            y: euler.y * ContraptionEntity.RAD_TO_DEG,
            z: euler.z * ContraptionEntity.RAD_TO_DEG
        };
        this.field.offset = {
            x: this.body.pos.x - this.center.x,
            y: this.body.pos.y - this.center.y,
            z: this.body.pos.z - this.center.z
        };
        this.field.pivot = { x: this.center.x, y: this.center.y, z: this.center.z };

        this.field.applyTransform();
    }

    getInterpolatedPose(partialTicks) {
        const blend = Number.isFinite(partialTicks)
            ? Math.max(0.0, Math.min(1.0, partialTicks))
            : 1.0;

        const quaternion = this.body.prevQuat.clone().slerp(this.body.quat, blend);
        const position = this.body.prevPos.clone().lerp(this.body.pos, blend);

        const pivot = new THREE.Vector3(this.center.x, this.center.y, this.center.z)
            .applyQuaternion(quaternion);

        position.sub(pivot);

        return { quaternion: quaternion, position: position };
    }

    onEntityUpdate() {
        super.onEntityUpdate();

        if (this.isDead) {
            return;
        }

        // Relayed keys only last a moment; they keep arriving while the pilot
        // holds a movement key down.
        if (this.remotePilot !== null && --this.remotePilot.ticksLeft <= 0) {
            this.remotePilot = null;
        }

        this.updateLighting();

        // A contraption in the physics wand's hands is moved by the player, not
        // by gravity and contacts, until it is let go.
        if (this.heldByPlayer) {
            this.syncFieldPose();
            this.updateBoundingBox();
            return;
        }

        // A replayed body only follows the pose the simulating client reported;
        // running physics here would make every client drift apart.
        if (this.remote) {
            this.syncFieldPose();
            this.updateBoundingBox();
            return;
        }

        this.body.prevPos.copy(this.body.pos);
        this.body.prevQuat.copy(this.body.quat);

        this.updatePilot();

        // Water keeps the body awake so it can float and drive.
        if (this.applyWaterPhysics()) {
            this.asleep = false;
            this.quietTicks = 0;
        }

        if (!this.asleep) {
            // The field itself is solid, so it has to be left out of the query
            // or the body would collide with its own blocks.
            this.body.step((region) => this.world.getCollisionBoxes(
                region,
                this.collidesWithOffGridField,
                { downward: true, sneaking: false, ignoreOffGridField: this.field }
            ));

            this.updateSleepState();
        }

        this.syncFieldPose();
        this.updateBoundingBox();
        this.carryRiders();

        // Report the pose so a world saved now gives the contraption back where
        // it came to rest instead of dropping it.
        if (this.ticksExisted === 1 || this.ticksExisted % ContraptionEntity.SYNC_INTERVAL === 0) {
            this.sendNetworkState();
        } else if (!this.asleep && this.ticksExisted % ContraptionEntity.POSE_SYNC_INTERVAL === 0) {
            this.sendNetworkState(this.serializePoseState());
        }

        if (this.y < ContraptionEntity.VOID_Y) {
            this.isDead = true;
            this.sendNetworkState({type: "contraption:remove", id: this.syncId});
            this.world.removeEntityById(this.id);
        }
    }

    // Block light is baked into the field's meshes, so a body whose surroundings
    // change brightness has to be rebuilt. The world already rebuilds its own
    // chunks when the time of day changes; this picks up the same change for a
    // contraption, plus the case of a boat sailing into shade or out of a cave.
    // Once a second is enough, and only a change actually costs a rebuild.
    updateLighting() {
        if (this.field === null || this.world === null || this.field.regions.size === 0) {
            return;
        }

        if (this.ticksExisted % 20 !== 0) {
            return;
        }

        const brightness = typeof this.world.getLightBrightness === "function"
            ? this.world.getLightBrightness(
                Math.floor(this.body.pos.x),
                Math.floor(this.body.pos.y),
                Math.floor(this.body.pos.z)
            )
            : 1.0;

        if (Math.abs(brightness - this.lightingBrightness) < 0.02) {
            return;
        }

        this.brightness = brightness;
        this.lightingBrightness = brightness;
        this.field.rebuildAll();
    }

    updateBoundingBox() {
        this.boundingBox = this.body.computeBounds();
        this.x = this.body.pos.x;
        this.y = this.body.pos.y;
        this.z = this.body.pos.z;
    }

    // World position of a cell's centre on the current pose.
    cellWorldPoint(cell) {
        return new THREE.Vector3(
            cell.x + 0.5 - this.center.x,
            cell.y + 0.5 - this.center.y,
            cell.z + 0.5 - this.center.z
        ).applyQuaternion(this.body.quat).add(this.body.pos);
    }

    // Water lifts and slows the body. The lift of every submerged part of every
    // cell adds up to one push through the centre of buoyancy, so a canopy
    // loaded on one side floats leaning, and a hull settles where lift and
    // weight balance instead of popping out of the water one block at a time. A
    // Boat Core anywhere on the hull turns the contraption into a boat that a
    // pilot can drive. Returns true while the body is wet so the caller keeps it
    // awake.
    applyWaterPhysics() {
        if (this.world === null || this.world === undefined
            || typeof this.world.getBlockAt !== "function") {
            this.inWater = false;
            return false;
        }

        let submerged = 0.0;

        // Where the displaced water pushes back, weighted by how much of each
        // cell is under: the centre of buoyancy.
        const liftOffset = new THREE.Vector3();

        for (const cell of this.cells) {
            const depth = this.cellSubmersion(cell);

            if (depth <= 0.0) {
                continue;
            }

            submerged += depth;

            liftOffset.addScaledVector(this.cellWorldPoint(cell).sub(this.body.pos), depth);
        }

        if (submerged <= 0.0) {
            this.inWater = false;
            return false;
        }

        this.inWater = true;

        liftOffset.multiplyScalar(1.0 / submerged);

        const wetness = Math.min(1.0, submerged / this.cells.length);

        // Water is thick: it bleeds off sinking, drifting and spinning alike.
        // Vertical motion is damped even when only a sliver is wet, which is what
        // keeps the body from oscillating through the surface. Damping comes
        // before the lift, so drag never eats into the buoyancy itself and a
        // floating body settles where lift matches its weight instead of riding
        // lower because part of every lift was damped away.
        this.body.vel.y *= ContraptionEntity.WATER_VERTICAL_DRAG;

        const horizontal = 1.0 - (1.0 - ContraptionEntity.WATER_HORIZONTAL_DRAG) * wetness;
        this.body.vel.x *= horizontal;
        this.body.vel.z *= horizontal;

        this.body.angVel.multiplyScalar(
            1.0 - (1.0 - ContraptionEntity.WATER_ANGULAR_DRAG) * wetness
        );

        // Archimedes: one upward push through the centre of buoyancy. Pushing
        // every wet corner separately is the same torque, but the per-cell
        // version stacked up into a spin on light blocks.
        const lift = ContraptionEntity.WATER_DENSITY
            * ContraptionBody.GRAVITY * submerged;

        this.body.applyImpulse(liftOffset, new THREE.Vector3(0.0, lift, 0.0));

        const spin = this.body.angVel.length();
        if (spin > ContraptionEntity.MAX_WET_SPIN) {
            this.body.angVel.multiplyScalar(ContraptionEntity.MAX_WET_SPIN / spin);
        }

        // Floating up slowly reads as buoyancy instead of as a launch, and a wet
        // body does not build up a plunge it would have to bounce back from.
        if (this.body.vel.y > ContraptionEntity.MAX_FLOAT_SPEED) {
            this.body.vel.y = ContraptionEntity.MAX_FLOAT_SPEED;
        } else if (this.body.vel.y < -ContraptionEntity.MAX_SINK_SPEED) {
            this.body.vel.y = -ContraptionEntity.MAX_SINK_SPEED;
        }

        // A core anywhere on the hull makes the contraption a boat. The core
        // does not have to touch the water itself, so it can be built into the
        // deck, the cabin or the stern like any other part.
        if (this.boatCores.length > 0) {
            this.driveBoat();
        }

        return true;
    }

    // How much of one cell is under water, from 0 (dry) to 1 (fully under).
    // Water blocks fill their cube, so the samples only have to find the block
    // the surface is in: that block's top face is the surface, and the depth the
    // cell has sunk below it is the submersion. Reading the height like that
    // makes the lift change smoothly as the cell rises. Counting wet samples
    // instead made it jump in thirds, so a floating body had no depth it could
    // rest at and rocked between those steps forever.
    cellSubmersion(cell) {
        const centre = this.cellWorldPoint(cell);

        let highestWet = -Infinity;

        for (const offsetY of [-0.49, -0.17, 0.17, 0.49]) {
            const y = centre.y + offsetY;

            if (this.isWaterAt(centre.x, y, centre.z)) {
                highestWet = y;
            }
        }

        if (highestWet === -Infinity) {
            return 0.0;
        }

        const surface = Math.floor(highestWet) + 1.0;
        const bottom = centre.y - 0.5;

        return Math.min(1.0, Math.max(0.0, surface - bottom));
    }

    // The helm slowly pushes the body the way the pilot is walking. A body with
    // nobody aboard does not drive itself, so an empty boat stays put. The keys
    // are either pressed on this client or relayed from the client that owns the
    // seat when this client is the one simulating the hull.
    driveBoat() {
        let forward = 0.0;
        let strafe = 0.0;
        let yaw = null;

        if (this.pilot !== null) {
            forward = this.pilot.steerForward;
            strafe = this.pilot.steerStrafe;
            yaw = this.pilot.rotationYaw;
        } else if (this.remotePilot !== null) {
            forward = this.remotePilot.forward;
            strafe = this.remotePilot.strafe;
            yaw = this.remotePilot.yaw;
        } else {
            return;
        }

        const input = Math.hypot(forward, strafe);

        if (input < 1e-4 || !Number.isFinite(yaw)) {
            return;
        }

        // Same axes the player's own walking builds, but pointing the other way:
        // the player's motion is a vector that travel feeds to the world
        // negated (it moves by -motionX and -motionZ), while the hull integrates
        // its velocity as it stands. Thrusting with the walking formula itself
        // sent the boat backwards, against the way the pilot was looking, so the
        // axes are mirrored here. At yaw 0 the eyes look down +Z and forward
        // thrust is +Z too.
        const radians = (yaw + 180.0) * Math.PI / 180.0;
        const sin = Math.sin(radians);
        const cos = Math.cos(radians);
        const scale = 1.0 / Math.max(1.0, input);

        const thrustX = (forward * sin - strafe * cos) * scale;
        const thrustZ = (-forward * cos - strafe * sin) * scale;

        this.body.vel.x += thrustX * BlockBoatCore.STEER_THRUST;
        this.body.vel.z += thrustZ * BlockBoatCore.STEER_THRUST;

        const speed = Math.hypot(this.body.vel.x, this.body.vel.z);
        if (speed > BlockBoatCore.MAX_STEER_SPEED) {
            const limit = BlockBoatCore.MAX_STEER_SPEED / speed;
            this.body.vel.x *= limit;
            this.body.vel.z *= limit;
        }
    }

    // Keys relayed from the client of a player steering this body. The body is
    // simulated here, so its owner applies them and reports the new pose; the
    // relaying client sees the boat move like everybody else.
    applyRemoteControl(payload) {
        if (this.remote || !payload) {
            return;
        }

        const forward = Number(payload.forward);
        const strafe = Number(payload.strafe);
        const yaw = Number(payload.yaw);

        if (!Number.isFinite(forward) || !Number.isFinite(strafe)) {
            return;
        }

        this.remotePilot = {
            forward: Math.max(-1.0, Math.min(1.0, forward)),
            strafe: Math.max(-1.0, Math.min(1.0, strafe)),
            yaw: Number.isFinite(yaw) ? yaw : 0.0,
            ticksLeft: 20
        };

        this.wake();
    }

    // A pilot is only the pilot while they are alive and still at this helm.
    updatePilot() {
        if (this.pilot !== null
            && (this.pilot.isDead || this.pilot.boatContraption !== this)) {
            this.pilot = null;
        }
    }

    // True while a player holds the helm of a contraption with a Boat Core,
    // i.e. while their keys should steer it instead of moving them. Right
    // clicking the core is what actually takes the helm and the player does not
    // have to stand on the hull to use it: the core is a helm, not a seat. The
    // boat does not have to be wet yet, so a hull can be boarded on the beach
    // and driven once it floats. A replay is steerable too: the keys are
    // relayed to the client that simulates the body.
    isSteerableAt(player) {
        if (this.isDead || this.heldByPlayer || this.boatCores.length === 0) {
            return false;
        }

        // Sneaking is how the pilot lets go.
        return player.isSneaking() !== true;
    }

    // The cell the local player is standing on, or null when they are not on
    // this body. The cell is remembered between ticks: a rocking hull swings its
    // rider around in body space, so picking the nearest top afresh every tick
    // made them hop onto whatever cell was closest, including a deck or cabin
    // roof above their head. While the remembered cell stays under their feet it
    // is the one they are on, however far the hull has swung them.
    supportCellFor(local) {
        const support = this.riderSupport;

        if (support !== null) {
            const cell = this.cells.find((candidate) =>
                candidate.x === support.x && candidate.y === support.y && candidate.z === support.z);

            if (cell !== undefined) {
                const top = cell.y + 0.5 - this.center.y;

                // Kept while the feet are still on that cell's top. The sideways
                // reach is a little wider than the cell so the collision engine
                // shoving a rider along the deck does not drop them.
                if (Math.abs(local.x - (cell.x + 0.5 - this.center.x)) <= 0.9
                    && Math.abs(local.z - (cell.z + 0.5 - this.center.z)) <= 0.9
                    && local.y >= top - 1.5
                    && local.y <= top + 0.9) {
                    return cell;
                }
            }

            this.riderSupport = null;
        }

        // A first look only takes a top the soles are actually on, so nothing
        // can lift a player onto a block above their head or drag them up from
        // under the hull.
        let best = null;
        let bestDistance = Infinity;

        for (const cell of this.cells) {
            if (Math.abs(local.x - (cell.x + 0.5 - this.center.x)) > 0.55) {
                continue;
            }
            if (Math.abs(local.z - (cell.z + 0.5 - this.center.z)) > 0.55) {
                continue;
            }

            const top = cell.y + 0.5 - this.center.y;
            const distance = Math.abs(local.y - top);

            if (local.y < top - 0.6 || local.y > top + 0.25 || distance >= bestDistance) {
                continue;
            }

            best = cell;
            bestDistance = distance;
        }

        this.riderSupport = best === null
            ? null
            : { x: best.x, y: best.y, z: best.z };

        return best;
    }

    // Anyone standing on the body rides it: their spot on the deck is followed
    // through the pose, so a moving or turning contraption carries them along
    // instead of sliding out from under their feet. Feet that ended up under the
    // surface are put back on top of it, which is what keeps a rider on a
    // bobbing or rocking hull from sinking into it a little more every tick.
    carryRiders(fromPos = this.body.prevPos, fromQuat = this.body.prevQuat) {
        const player = this.minecraft ? this.minecraft.player : null;

        if (!player || player.isDead || this.heldByPlayer) {
            this.riderSupport = null;
            return;
        }

        // Where the soles sat on the body at the start of this tick.
        const local = new THREE.Vector3(
            player.x - fromPos.x,
            player.y - fromPos.y,
            player.z - fromPos.z
        ).applyQuaternion(fromQuat.clone().invert());

        const support = this.supportCellFor(local);

        if (support === null) {
            return;
        }

        const deckTop = support.y + 0.5 - this.center.y;

        // Stand on the deck instead of on the sinking offset. The lift is what
        // puts a rider back on the surface after the hull has swung out from
        // under them.
        const lift = local.y < deckTop;
        if (lift) {
            local.y = deckTop;
        }

        const target = local.applyQuaternion(this.body.quat).add(this.body.pos);

        // Through the world's collision instead of straight to the spot: a hull
        // that lifts a rider under a ceiling leaves them under it, not inside
        // it, and one that drops them onto a floor does not bury them in that
        // either. The hull's own cells are left out, since the deck the rider is
        // being put on must not block the lift onto it.
        const move = this.clampRiderMove(player, target);

        if (Math.abs(move.x) + Math.abs(move.y) + Math.abs(move.z) < 1e-6) {
            return;
        }

        player.setPosition(
            player.x + move.x,
            player.y + move.y,
            player.z + move.z
        );

        // Do not carry the fall that pushed the feet inside the hull into the
        // next tick, or the rider would sink a little deeper on every swing.
        if (lift && move.y > 0.0 && player.motionY < 0.0) {
            player.motionY = 0.0;
        }
    }

    // Where the player can actually be moved to, with floors, ceilings and walls
    // in the way. Only the world is consulted: off grid fields are left out so
    // the hull the rider stands on does not block their own carry.
    clampRiderMove(player, target) {
        const move = {
            x: target.x - player.x,
            y: target.y - player.y,
            z: target.z - player.z
        };

        if (this.world === null || this.world === undefined
            || typeof this.world.getCollisionBoxes !== "function") {
            return move;
        }

        const box = player.boundingBox;

        if (!box) {
            return move;
        }

        const overlapsX = (other) => other.minX < box.maxX && other.maxX > box.minX;
        const overlapsZ = (other) => other.minZ < box.maxZ && other.maxZ > box.minZ;

        // A ceiling above the head.
        if (move.y > 0.0) {
            for (const other of this.world.getCollisionBoxes(box.expand(0.0, move.y, 0.0), false)) {
                if (!overlapsX(other) || !overlapsZ(other) || other.minY < box.maxY) {
                    continue;
                }

                move.y = Math.min(move.y, other.minY - box.maxY);
            }
        } else if (move.y < 0.0) {
            // A floor under the feet.
            for (const other of this.world.getCollisionBoxes(box.expand(0.0, move.y, 0.0), false)) {
                if (!overlapsX(other) || !overlapsZ(other) || other.maxY > box.minY) {
                    continue;
                }

                move.y = Math.max(move.y, other.maxY - box.minY);
            }
        }

        if (move.x !== 0.0) {
            for (const other of this.world.getCollisionBoxes(box.expand(move.x, move.y, 0.0), false)) {
                move.x = other.clipXCollide(box, move.x);
            }
        }

        if (move.z !== 0.0) {
            const moved = box.offset(move.x, move.y, 0.0);

            for (const other of this.world.getCollisionBoxes(moved.expand(0.0, 0.0, move.z), false)) {
                move.z = other.clipZCollide(moved, move.z);
            }
        }

        return move;
    }

    isWaterAt(x, y, z) {
        const block = Block.getById(this.world.getBlockAt(
            Math.floor(x), Math.floor(y), Math.floor(z)
        ));

        return block !== null && block.isLiquid() && !block.isLava();
    }

    // ---- Physics wand ----

    beginHold() {
        this.heldByPlayer = true;
        this.asleep = true;
        this.quietTicks = 0;
        this.body.sleep();
    }

    holdAt(x, y, z) {
        // Keep the previous tick's point so the renderer can blend between
        // frames instead of snapping the contraption to each tick.
        this.body.prevPos.copy(this.body.pos);
        this.body.pos.set(x, y, z);
        this.body.vel.set(0.0, 0.0, 0.0);
        this.body.angVel.set(0.0, 0.0, 0.0);

        this.syncFieldPose();
        this.updateBoundingBox();
    }

    release() {
        if (!this.heldByPlayer) {
            return;
        }

        this.heldByPlayer = false;
        this.wake();

        // The server has to learn where the contraption was dropped.
        this.sendNetworkState();
    }

    updateSleepState() {
        const resting = this.body.touching
            && this.body.vel.length() < ContraptionEntity.SLEEP_LINEAR_SPEED
            && this.body.angVel.length() < ContraptionEntity.SLEEP_ANGULAR_SPEED;

        if (!resting) {
            this.quietTicks = 0;
            return;
        }

        if (++this.quietTicks < ContraptionEntity.SLEEP_TICKS) {
            return;
        }

        this.asleep = true;
        this.body.sleep();
    }

    wake() {
        this.asleep = false;
        this.quietTicks = 0;
        this.body.wake();
    }

    // A placed or broken cell changes the mass, the inertia and where the centre
    // of mass sits, so the body is rebuilt around the new cells. The pose is
    // kept, including the world position of the old centre of mass.
    rebuildFromField() {
        if (this.field === null) {
            return;
        }

        // Editing the cells of a body this client was only replaying makes it
        // this client's body to simulate.
        this.adoptLocalSimulation();

        const cells = [...this.field.cells.values()].map((cell) => ({
            x: cell.x,
            y: cell.y,
            z: cell.z,
            id: cell.typeId,
            data: cell.data || 0
        }));

        if (cells.length === 0) {
            this.isDead = true;
            this.sendNetworkState({type: "contraption:remove", id: this.syncId});
            this.world.removeEntityById(this.id);
            return;
        }

        // Placing or breaking a cell moves the centre of gravity, so the body is
        // rebuilt around the new one instead of keeping its old balance point.
        const center = ContraptionEntity.centerOfMass(cells);

        const shift = new THREE.Vector3(
            center.x - this.center.x,
            center.y - this.center.y,
            center.z - this.center.z
        ).applyQuaternion(this.body.quat);

        const worldCenter = this.body.pos.clone().add(shift);

        const body = new ContraptionBody(this.createBodyCells(cells, center));
        body.pos.copy(worldCenter);
        body.quat.copy(this.body.quat);
        body.vel.copy(this.body.vel);
        body.angVel.copy(this.body.angVel);
        body.prevPos.copy(worldCenter);
        body.prevQuat.copy(this.body.quat);

        this.center = center;
        this.cells = cells;
        this.boatCores = this.findBoatCores(cells);
        this.body = body;
        this.width = Math.max(0.5, body.size.x);
        this.height = Math.max(0.5, body.size.y);

        this.syncFieldPose();
        this.updateBoundingBox();
        this.wake();

        // The body is made of different blocks now, so the server has to hear
        // about the new shape or a reload would bring the old one back.
        this.sendNetworkState();
    }

    // Removing the floor under a sleeping contraption has to make it fall again.
    onBlockChanged(x, y, z) {
        if (!this.asleep || this.heldByPlayer) {
            return;
        }

        const box = this.boundingBox;
        if (x < box.minX - 1.0 || x > box.maxX + 1.0
            || y < box.minY - 1.0 || y > box.maxY + 1.0
            || z < box.minZ - 1.0 || z > box.maxZ + 1.0) {
            return;
        }

        // Losing the floor under a body this client was only replaying wakes it
        // here too, so it falls instead of hanging in the air.
        this.adoptLocalSimulation();
        this.wake();
    }

    // Pose only: enough for another client to move the body and carry whoever
    // stands on it, without resending every cell every other tick.
    serializePoseState() {
        const round = (value) => Math.round(value * 10000) / 10000;
        const vector = (v) => ({ x: round(v.x), y: round(v.y), z: round(v.z) });

        return {
            type: "contraption:pose",
            id: this.syncId,
            asleep: false,
            pos: vector(this.body.pos),
            quat: {
                x: round(this.body.quat.x),
                y: round(this.body.quat.y),
                z: round(this.body.quat.z),
                w: round(this.body.quat.w)
            },
            vel: vector(this.body.vel),
            angVel: vector(this.body.angVel)
        };
    }

    serializeState() {
        const round = (value) => Math.round(value * 10000) / 10000;

        const state = {
            id: this.syncId,
            asleep: this.asleep,
            cells: this.cells.map((cell) => ({
                x: cell.x,
                y: cell.y,
                z: cell.z,
                id: cell.id,
                data: cell.data || 0
            })),
            center: {
                x: round(this.center.x),
                y: round(this.center.y),
                z: round(this.center.z)
            },
            pos: {
                x: round(this.body.pos.x),
                y: round(this.body.pos.y),
                z: round(this.body.pos.z)
            },
            quat: {
                x: round(this.body.quat.x),
                y: round(this.body.quat.y),
                z: round(this.body.quat.z),
                w: round(this.body.quat.w)
            }
        };

        // A body that is still moving has to keep moving after a reload.
        if (!this.asleep) {
            state.vel = {
                x: round(this.body.vel.x),
                y: round(this.body.vel.y),
                z: round(this.body.vel.z)
            };
            state.angVel = {
                x: round(this.body.angVel.x),
                y: round(this.body.angVel.y),
                z: round(this.body.angVel.z)
            };
        }

        return state;
    }

    hasSameCells(cells) {
        if (!Array.isArray(cells) || cells.length !== this.cells.length) {
            return false;
        }

        for (let i = 0; i < cells.length; i++) {
            const mine = this.cells[i];
            const other = cells[i];

            if (!other
                || mine.x !== other.x || mine.y !== other.y || mine.z !== other.z
                || mine.id !== other.id || (mine.data || 0) !== (other.data || 0)) {
                return false;
            }
        }

        return true;
    }

    applyRemoteState(state) {
        if (!state) {
            return;
        }

        // Where the body was before this report. Whoever stands on it is carried
        // through the same pose change, exactly like a locally simulated body.
        const previousPos = this.body.pos.clone();
        const previousQuat = this.body.quat.clone();

        if (ContraptionEntity.isFiniteVector(state.pos)) {
            this.body.pos.set(state.pos.x, state.pos.y, state.pos.z);
            this.body.prevPos.copy(this.body.pos);
        }

        const quat = state.quat;
        if (quat) {
            const length = Math.hypot(quat.x, quat.y, quat.z, quat.w);
            if (Number.isFinite(length) && length > 1e-8) {
                this.body.quat.set(quat.x / length, quat.y / length, quat.z / length, quat.w / length);
                this.body.prevQuat.copy(this.body.quat);
            }
        }

        this.body.vel.set(0.0, 0.0, 0.0);
        this.body.angVel.set(0.0, 0.0, 0.0);

        if (ContraptionEntity.isFiniteVector(state.vel)) {
            this.body.vel.set(state.vel.x, state.vel.y, state.vel.z);
        }
        if (ContraptionEntity.isFiniteVector(state.angVel)) {
            this.body.angVel.set(state.angVel.x, state.angVel.y, state.angVel.z);
        }

        this.asleep = state.asleep !== false;
        this.quietTicks = this.asleep ? ContraptionEntity.SLEEP_TICKS : 0;

        if (this.asleep) {
            this.body.sleep();
        }

        this.syncFieldPose();
        this.updateBoundingBox();

        // Another player's contraption moves the local player standing on it,
        // so riding works in multiplayer too. The first pose is a spawn.
        if (this.remote) {
            if (this.hasRemotePose) {
                this.carryRiders(previousPos, previousQuat);
            }
            this.hasRemotePose = true;
        }
    }

    adoptLocalSimulation() {
        if (!this.remote) {
            return;
        }

        this.remote = false;
        this.quietTicks = 0;
        this.body.wake();
    }

    getNetworkManager() {
        const controller = this.minecraft && this.minecraft.playerController;
        const handler = controller && typeof controller.getNetworkHandler === "function"
            ? controller.getNetworkHandler()
            : null;
        const manager = handler && typeof handler.getNetworkManager === "function"
            ? handler.getNetworkManager()
            : null;

        return manager && typeof manager.sendJson === "function" ? manager : null;
    }

    sendNetworkState(payload = null) {
        if (this.remote) {
            return;
        }

        const manager = this.getNetworkManager();
        if (manager === null) {
            return;
        }
        if (typeof manager.isConnected === "function" && !manager.isConnected()) {
            return;
        }

        try {
            if (payload !== null) {
                manager.sendJson(payload);
                return;
            }

            manager.sendJson({type: "contraption:state", ...this.serializeState()});
        } catch (error) {
            // A network hiccup must never stop the physics loop.
        }
    }

    onEntityRemoved() {
        if (this.pilot !== null) {
            // Letting go through the player clears the helm message with it.
            const pilot = this.pilot;
            this.pilot = null;
            pilot.leaveBoat();
        }

        if (this.field !== null) {
            this.field.onCellEdit = null;
            this.field.dispose();
            this.field = null;
        }
    }
}
