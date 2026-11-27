import Entity from "./Entity.js";
import ContraptionBody from "../physics/ContraptionBody.js";
import OffGridBlockField from "../render/OffGridBlockField.js";
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

    constructor(minecraft, world, blocks, x, y, z, options = null) {
        super(minecraft, world, -2);

        // A body received from the server is a replay of another client's pose
        // and never runs physics of its own.
        this.remote = !!(options && options.remote);
        this.syncId = options && options.syncId
            ? String(options.syncId)
            : ContraptionEntity.makeSyncId();

        // Centre of mass in field local block coordinates.
        this.center = { x: x, y: y, z: z };
        this.cells = blocks.map((block) => ({
            x: block.x,
            y: block.y,
            z: block.z,
            id: block.id,
            data: block.data || 0
        }));

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

    createBodyCells(cells, center) {
        return cells.map((cell) => ({
            x: cell.x,
            y: cell.y,
            z: cell.z,
            id: cell.id,
            data: cell.data,
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

        // A replayed body only follows the pose the simulating client reported;
        // running physics here would make every client drift apart.
        if (this.remote) {
            this.syncFieldPose();
            this.updateBoundingBox();
            return;
        }

        this.body.prevPos.copy(this.body.pos);
        this.body.prevQuat.copy(this.body.quat);

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

        // Report the pose so a world saved now gives the contraption back where
        // it came to rest instead of dropping it.
        if (this.ticksExisted === 1 || this.ticksExisted % ContraptionEntity.SYNC_INTERVAL === 0) {
            this.sendNetworkState();
        }

        if (this.y < ContraptionEntity.VOID_Y) {
            this.isDead = true;
            this.sendNetworkState({type: "contraption:remove", id: this.syncId});
            this.world.removeEntityById(this.id);
        }
    }

    updateBoundingBox() {
        this.boundingBox = this.body.computeBounds();
        this.x = this.body.pos.x;
        this.y = this.body.pos.y;
        this.z = this.body.pos.z;
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

        let sumX = 0.0;
        let sumY = 0.0;
        let sumZ = 0.0;

        for (const cell of cells) {
            sumX += cell.x + 0.5;
            sumY += cell.y + 0.5;
            sumZ += cell.z + 0.5;
        }

        const center = {
            x: sumX / cells.length,
            y: sumY / cells.length,
            z: sumZ / cells.length
        };

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
        if (!this.asleep) {
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
        if (this.field !== null) {
            this.field.onCellEdit = null;
            this.field.dispose();
            this.field = null;
        }
    }
}
