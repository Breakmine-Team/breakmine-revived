import Entity from "./Entity.js";
import BoundingBox from "../../util/BoundingBox.js";
import * as THREE from "../../../../../../libraries/three.module.js";

// One model unit of the player skin is this many blocks, matching the scale
// entity renderers use for the player model.
const UNIT = 7.0 / 120.0;

// The player model is built with the Y axis pointing down and the X axis
// mirrored, so a model space offset becomes this world space vector.
function modelToWorld(x, y, z) {
    return new THREE.Vector3(-x * UNIT, -y * UNIT, z * UNIT);
}

// The ragdoll is made of one rigid body per player model part. Pivot is the
// model space offset of the part's rotation point from the neck, center is the
// offset of its box centre from that rotation point and half is its box size.
// Both offsets are in model units, just like ModelPlayer's boxes.
const BODY_DEFINITIONS = [
    {name: "head", mass: 6.0, pivot: [0, 0, 0], center: [0, -4, 0], half: [4, 4, 4]},
    {name: "body", mass: 22.0, pivot: [0, 0, 0], center: [0, 6, 0], half: [4, 6, 2]},
    {name: "rightArm", mass: 3.5, pivot: [-5, 2, 0], center: [-1, 4, 0], half: [2, 6, 2]},
    {name: "leftArm", mass: 3.5, pivot: [5, 2, 0], center: [1, 4, 0], half: [2, 6, 2]},
    {name: "rightLeg", mass: 8.0, pivot: [-2, 12, 0], center: [0, 6, 0], half: [2, 6, 2]},
    {name: "leftLeg", mass: 8.0, pivot: [2, 12, 0], center: [0, 6, 0], half: [2, 6, 2]}
];

// Ball socket joints: the two anchors below name the same point on both bodies.
// Model space coordinates are relative to each body's own rotation point. Limit
// is how far, in radians, the limb may twist away from its rest orientation.
const JOINT_DEFINITIONS = [
    {a: "body", anchorA: [0, 0, 0], b: "head", anchorB: [0, 0, 0], limit: 1.0},
    {a: "body", anchorA: [5, 2, 0], b: "leftArm", anchorB: [0, 0, 0], limit: 1.6},
    {a: "body", anchorA: [-5, 2, 0], b: "rightArm", anchorB: [0, 0, 0], limit: 1.6},
    {a: "body", anchorA: [2, 12, 0], b: "leftLeg", anchorB: [0, 0, 0], limit: 1.3},
    {a: "body", anchorA: [-2, 12, 0], b: "rightLeg", anchorB: [0, 0, 0], limit: 1.3}
];

// A single rigid body of the ragdoll: a box with a position, an orientation,
// a velocity and an angular velocity.
class RagdollBone {

    constructor(definition, origin, lean) {
        this.name = definition.name;
        this.mass = definition.mass;
        this.invMass = 1.0 / definition.mass;

        this.half = new THREE.Vector3(
            definition.half[0] * UNIT,
            definition.half[1] * UNIT,
            definition.half[2] * UNIT
        );

        // Centre of mass and rotation point, both relative to the neck.
        this.center = modelToWorld(definition.center[0], definition.center[1], definition.center[2]);
        this.pivot = modelToWorld(definition.pivot[0], definition.pivot[1], definition.pivot[2]);

        this.pos = origin.clone().add(this.pivot).add(this.center).applyQuaternion(lean);
        this.prevPos = this.pos.clone();

        this.restingContact = false;

        this.vel = new THREE.Vector3();
        this.angVel = new THREE.Vector3();

        this.quat = lean.clone();
        this.prevQuat = lean.clone();

        // Box inertia around the centre of mass, expressed in body axes.
        const width = this.half.x * 2.0;
        const height = this.half.y * 2.0;
        const depth = this.half.z * 2.0;

        this.invInertia = new THREE.Vector3(
            12.0 / (definition.mass * (height * height + depth * depth)),
            12.0 / (definition.mass * (width * width + depth * depth)),
            12.0 / (definition.mass * (width * width + height * height))
        );

        this.invInertiaWorld = new THREE.Matrix3();

        this.corners = [];
        for (const signX of [-1, 1]) {
            for (const signY of [-1, 1]) {
                for (const signZ of [-1, 1]) {
                    this.corners.push(new THREE.Vector3(
                        signX * this.half.x,
                        signY * this.half.y,
                        signZ * this.half.z
                    ));
                }
            }
        }

        this.updateInertiaWorld();
    }

    // World inverse inertia: R * diag(invInertia) * R^T.
    updateInertiaWorld() {
        const elements = new THREE.Matrix4().makeRotationFromQuaternion(this.quat).elements;
        const columns = [
            [elements[0], elements[1], elements[2]],
            [elements[4], elements[5], elements[6]],
            [elements[8], elements[9], elements[10]]
        ];
        const inertia = [this.invInertia.x, this.invInertia.y, this.invInertia.z];
        const rows = [];

        for (let row = 0; row < 3; row++) {
            rows.push([0, 0, 0]);
            for (let column = 0; column < 3; column++) {
                let value = 0.0;
                for (let axis = 0; axis < 3; axis++) {
                    value += columns[axis][row] * columns[axis][column] * inertia[axis];
                }
                rows[row][column] = value;
            }
        }

        this.invInertiaWorld.set(
            rows[0][0], rows[0][1], rows[0][2],
            rows[1][0], rows[1][1], rows[1][2],
            rows[2][0], rows[2][1], rows[2][2]
        );
    }

    velocityAt(offset) {
        return new THREE.Vector3().crossVectors(this.angVel, offset).add(this.vel);
    }

    applyImpulse(offset, impulse) {
        this.vel.addScaledVector(impulse, this.invMass);
        this.angVel.add(
            new THREE.Vector3().crossVectors(offset, impulse).applyMatrix3(this.invInertiaWorld)
        );
    }

    limitVelocity() {
        const speed = this.vel.length();
        if (speed > RagdollEntity.MAX_LINEAR_SPEED) {
            this.vel.multiplyScalar(RagdollEntity.MAX_LINEAR_SPEED / speed);
        }

        const spin = this.angVel.length();
        if (spin > RagdollEntity.MAX_ANGULAR_SPEED) {
            this.angVel.multiplyScalar(RagdollEntity.MAX_ANGULAR_SPEED / spin);
        }
    }
}

export default class RagdollEntity extends Entity {

    static WIDTH = 0.6;
    static HEIGHT = 1.8;

    static GRAVITY = 0.04;
    static SUBSTEPS = 3;
    static JOINT_ITERATIONS = 8;
    static CONTACT_ITERATIONS = 2;

    static LINEAR_DAMPING = 0.999;
    static ANGULAR_DAMPING = 0.96;

    static JOINT_POSITION_BETA = 0.8;
    static JOINT_POSITION_ITERATIONS = 4;
    static RESTITUTION = 0.05;
    static FRICTION = 0.6;

    // Contacts slow enough to be resting bleed off the left over rocking, so a
    // body lying on the ground comes to a stop instead of buzzing.
    static RESTING_SPEED = 0.15;
    static GROUND_LINEAR_DAMPING = 0.9;
    static GROUND_ANGULAR_DAMPING = 0.8;
    static SLEEP_LINEAR_SPEED = 0.015;
    static SLEEP_ANGULAR_SPEED = 0.04;
    static JOINT_SLEEP_TOLERANCE = 0.02;

    // A body that has not moved a noticeable amount for four seconds (80 ticks)
    // is put to sleep and its physics stops completely: the leftover creep of
    // corner contacts would otherwise buzz forever.
    static SLEEP_TICKS = 80;
    static SLEEP_MOVE_DISTANCE = 0.05;

    // The owner of a ragdoll broadcasts its pose every 200ms. Other clients
    // only replay that snapshot, easing toward it between packets.
    static SYNC_INTERVAL = 4;
    static REMOTE_BLEND = 0.45;
    static REMOTE_SNAP_DISTANCE = 0.01;
    static REMOTE_SNAP_ANGLE = 0.02;

    // Punching hurts the body instead of shoving it around; once it runs out of
    // health it breaks apart and drops its item.
    static MAX_HEALTH = 10;

    static MAX_LINEAR_SPEED = 2.0;
    static MAX_ANGULAR_SPEED = 0.6;

    static CONTACT_RADIUS = 0.01;
    static CONTACT_MARGIN = 0.1;

    static SPAWN_SPIN = 0.04;
    static VOID_Y = -16;

    // Walking into a body shoves it out of the way instead of passing through.
    static PUSH_SPEED = 0.14;
    static PUSH_BLEND = 0.4;
    static PUSH_FRICTION = 0.6;
    static PUSH_TWIST = 1.6;

    // A dead player's corpse carries their items; cap how many stacks it can
    // drop so a full inventory does not turn into hundreds of entities.
    static LOOT_LIMIT = 64;

    static KICK_SPEED = 0.35;
    static KICK_LIFT = 0.12;
    static KICK_SPIN = 0.2;
    static KICK_SPREAD = 0.9;

    // A body grabbed with the right mouse button hangs at arm's length and is
    // dragged after the crosshair instead of falling.
    static HOLD_DISTANCE = 2.0;
    static HOLD_SAG = 0.45;
    static HOLD_BLEND = 0.35;

    constructor(minecraft, world, x, y, z, options = null) {
        super(minecraft, world, -2);

        this.width = RagdollEntity.WIDTH;
        this.height = RagdollEntity.HEIGHT;

        this.setPositionAndRotation(x, y, z, 0.0, 0.0);

        this.bones = [];
        this.joints = [];

        this.asleep = false;
        this.quietTicks = 0;
        this.touching = false;
        this.settleAnchor = null;
        this.health = RagdollEntity.MAX_HEALTH;

        // The body a player drops when they turn themselves into a ragdoll. It
        // is not a corpse: it cannot be grabbed or damaged, and its player
        // follows it instead of it being simulated on its own.
        this.isPlayerRagdoll = false;

        // While a player carries the body it follows a moving anchor instead of
        // running physics, and keeps its pose until it is dropped.
        this.held = false;
        this.heldAnchor = null;
        this.heldOffsets = null;
        this.heldVelocity = new THREE.Vector3();

        // Who simulates this body right now (a server entity id, or null when
        // nobody does and the stored pose is just replayed).
        this.ownerEid = null;

        // Player corpses carry a nametag and the items the player had.
        this.displayName = options && typeof options.displayName === "string"
            ? options.displayName.slice(0, 32)
            : null;
        this.loot = RagdollEntity.sanitizeLoot(options && options.loot);

        // A body received from the network is a replay of somebody else's
        // simulation and never runs physics of its own.
        this.remote = !!(options && options.remote);
        this.remoteTargets = null;
        this.remoteSettled = false;
        this.syncId = options && options.syncId
            ? String(options.syncId)
            : RagdollEntity.makeSyncId();

        // The body drops where it was clicked instead of standing up and
        // sliding off, so it starts already lying on its back facing a random way.
        const yaw = Math.random() * Math.PI * 2.0;
        const facing = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0.0, 1.0, 0.0), yaw);

        let lean = facing;

        if (options && options.standing) {
            // A player turning themselves into a ragdoll keeps standing for the
            // first moment and then topples over. A small lean is enough: the
            // body is balanced, so any lean puts its weight past the feet.
            const tiltAxis = new THREE.Vector3(Math.random() - 0.5, 0.0, Math.random() - 0.5);
            if (tiltAxis.lengthSq() < 1e-6) {
                tiltAxis.set(1.0, 0.0, 0.0);
            }

            const tilt = 0.1 + Math.random() * 0.08;

            lean = facing.clone().multiply(
                new THREE.Quaternion().setFromAxisAngle(tiltAxis.normalize(), tilt)
            );
        } else {
            const fall = Math.random() < 0.5 ? Math.PI / 2.0 : -Math.PI / 2.0;
            lean = facing.clone().multiply(
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1.0, 0.0, 0.0), fall)
            );
        }

        this.createBones(x, y, z, lean);
        this.updateBoundingBox();

        if (this.remote) {
            this.applyRemoteState(options && options.state, true);
            this.asleep = !!(options && options.state && options.state.asleep);
        } else {
            for (const bone of this.bones) {
                bone.prevPos.copy(bone.pos);
                bone.prevQuat.copy(bone.quat);

                // A limp body never lies perfectly still, so let it twitch while
                // it settles instead of freezing in the spawn pose.
                bone.angVel.set(
                    (Math.random() - 0.5) * RagdollEntity.SPAWN_SPIN,
                    (Math.random() - 0.5) * RagdollEntity.SPAWN_SPIN,
                    (Math.random() - 0.5) * RagdollEntity.SPAWN_SPIN
                );
            }

            this.settleAnchor = this.captureAnchor();
        }

        this.initRenderer();
    }

    static sanitizeLoot(value) {
        if (!Array.isArray(value)) {
            return [];
        }

        const loot = [];
        for (const entry of value.slice(0, RagdollEntity.LOOT_LIMIT)) {
            if (!entry || typeof entry !== "object") {
                continue;
            }

            const id = Math.trunc(entry.id);
            const count = Math.trunc(entry.count);
            if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(count) || count <= 0) {
                continue;
            }

            loot.push({id: id, count: Math.min(count, 64)});
        }

        return loot;
    }

    static makeSyncId() {
        return "ragdoll-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }

    // Build a replay-only ragdoll from a network snapshot. Returns null when
    // the snapshot does not describe a body we can trust.
    static fromNetworkState(minecraft, world, state) {
        if (!state || !Array.isArray(state.bones) || state.bones.length === 0) {
            return null;
        }

        const first = state.bones[0];
        const x = Number(first && first.x);
        const y = Number(first && first.y);
        const z = Number(first && first.z);

        if (![x, y, z].every((value) => Number.isFinite(value))) {
            return null;
        }

        return new RagdollEntity(minecraft, world, x, y, z, {
            remote: true,
            syncId: state.id,
            state: state
        });
    }

    createBones(x, y, z, lean) {
        // The player model put its neck this far above the feet.
        const origin = new THREE.Vector3(x, y + 24.0 * UNIT, z);
        const bonesByName = {};

        for (const definition of BODY_DEFINITIONS) {
            const bone = new RagdollBone(definition, origin, lean);
            this.bones.push(bone);
            bonesByName[bone.name] = bone;
        }

        for (const definition of JOINT_DEFINITIONS) {
            const a = bonesByName[definition.a];
            const b = bonesByName[definition.b];

            this.joints.push({
                a: a,
                b: b,
                anchorA: modelToWorld(...definition.anchorA).sub(a.center),
                anchorB: modelToWorld(...definition.anchorB).sub(b.center),
                limit: definition.limit
            });
        }

        // Centre the body on the clicked spot and rest it on the surface there.
        const box = this.computeBoundingBox();
        const shiftX = x - (box.minX + box.maxX) / 2.0;
        const shiftY = y - box.minY;
        const shiftZ = z - (box.minZ + box.maxZ) / 2.0;

        for (const bone of this.bones) {
            bone.pos.x += shiftX;
            bone.pos.y += shiftY;
            bone.pos.z += shiftZ;
            bone.prevPos.copy(bone.pos);
        }
    }

    getEyeHeight() {
        return this.height * 0.8;
    }

    onEntityUpdate() {
        super.onEntityUpdate();

        if (this.isDead) {
            return;
        }

        for (const bone of this.bones) {
            bone.prevPos.copy(bone.pos);
            bone.prevQuat.copy(bone.quat);
        }

        // A carried body is not simulated: it hangs from the player's hand, so
        // keep reporting the pose but skip gravity, contacts and sleeping.
        if (this.held) {
            this.updateHeld();
            this.updateBoundingBox();

            if (!this.remote && (this.ticksExisted === 1
                || this.ticksExisted % RagdollEntity.SYNC_INTERVAL === 0)) {
                this.sendNetworkState();
            }

            if (this.y < RagdollEntity.VOID_Y) {
                this.isDead = true;
                this.sendNetworkState({type: "ragdoll:remove", id: this.syncId});
                this.world.removeEntityById(this.id);
            }

            return;
        }

        // Walking into a body shoves it along and wakes it up if it was frozen.
        // Touching somebody else's body claims its simulation first.
        this.pushFromPlayer();

        // The owner keeps reporting the settled pose too, so players joining
        // later see ragdolls that have been lying there for a while.
        if (!this.remote && (this.ticksExisted === 1
            || this.ticksExisted % RagdollEntity.SYNC_INTERVAL === 0)) {
            this.sendNetworkState();
        }

        // Replays must keep following their snapshot even while it is reported
        // as settled, so they come before the sleep check.
        if (this.remote) {
            this.interpolateRemote();
            return;
        }

        if (this.asleep) {
            return;
        }

        this.touching = false;
        this.simulate();
        this.updateBoundingBox();
        this.updateSleepState();

        if (this.y < RagdollEntity.VOID_Y) {
            this.isDead = true;
            this.sendNetworkState({type: "ragdoll:remove", id: this.syncId});
            this.world.removeEntityById(this.id);
        }
    }

    simulate() {
        const step = 1.0 / RagdollEntity.SUBSTEPS;

        for (let substep = 0; substep < RagdollEntity.SUBSTEPS; substep++) {
            this.integrateVelocities(step);

            for (let iteration = 0; iteration < RagdollEntity.JOINT_ITERATIONS; iteration++) {
                this.solveJoints();
            }

            this.integratePositions(step);

            const boxes = this.getNearbyCollisionBoxes();

            for (let iteration = 0; iteration < RagdollEntity.CONTACT_ITERATIONS; iteration++) {
                this.solveContacts(boxes);
            }

            // Position projection last. Joints get the final word: a bone left a
            // hair inside a block is invisible, a stretched joint is not.
            for (let iteration = 0; iteration < RagdollEntity.JOINT_POSITION_ITERATIONS; iteration++) {
                this.solveContacts(boxes, false);
                this.limitJointAngles();
                this.correctJointPositions();
            }

            this.dampRestingContacts();
        }
    }

    // Every kick lands a little differently: the shove is jittered around the
    // look direction and each limb takes its own share of it, so the body never
    // tumbles the same way twice.
    kick(dirX, dirZ, speed = RagdollEntity.KICK_SPEED) {
        const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (length < 1e-4) {
            dirX = 0.0;
            dirZ = -1.0;
        } else {
            dirX /= length;
            dirZ /= length;
        }

        const jitter = (Math.random() - 0.5) * RagdollEntity.KICK_SPREAD;
        const cos = Math.cos(jitter);
        const sin = Math.sin(jitter);

        const kickX = dirX * cos - dirZ * sin;
        const kickZ = dirX * sin + dirZ * cos;

        const power = speed * (0.7 + Math.random() * 0.6);
        const lift = RagdollEntity.KICK_LIFT * (0.6 + Math.random() * 0.8);

        this.wake();

        for (const bone of this.bones) {
            const share = 0.75 + Math.random() * 0.5;

            bone.vel.set(kickX * power * share, lift * share, kickZ * power * share);
            bone.angVel.set(
                (Math.random() - 0.5) * RagdollEntity.KICK_SPIN,
                (Math.random() - 0.5) * RagdollEntity.KICK_SPIN,
                (Math.random() - 0.5) * RagdollEntity.KICK_SPIN
            );
        }
    }

    wake() {
        this.asleep = false;
        this.quietTicks = 0;
        this.settleAnchor = this.captureAnchor();
    }

    // A player grabbed the body. Remember the pose it was in, so carrying it
    // keeps the limbs where they were instead of folding into the hand. The
    // anchor starts at the body itself: the player's hand then drags it along.
    grab() {
        if (this.isDead || this.isPlayerRagdoll) {
            return false;
        }

        // Only one client simulates a body, so carrying somebody else's copy
        // means taking its simulation over first.
        if (this.remote) {
            this.claim();
        }

        this.wake();

        const box = this.boundingBox || this.computeBoundingBox();
        const x = (box.minX + box.maxX) * 0.5;
        const y = (box.minY + box.maxY) * 0.5;
        const z = (box.minZ + box.maxZ) * 0.5;

        this.held = true;
        this.heldVelocity.set(0.0, 0.0, 0.0);
        this.heldAnchor = new THREE.Vector3(x, y, z);
        this.heldOffsets = new Float64Array(this.bones.length * 3);

        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];

            this.heldOffsets[i * 3] = bone.pos.x - x;
            this.heldOffsets[i * 3 + 1] = bone.pos.y - y;
            this.heldOffsets[i * 3 + 2] = bone.pos.z - z;

            bone.vel.set(0.0, 0.0, 0.0);
            bone.angVel.set(0.0, 0.0, 0.0);
        }

        return true;
    }

    // Ease the carried body toward a point, so picking it up drags it after the
    // crosshair instead of snapping it into the hand.
    holdAt(x, y, z) {
        if (!this.held || this.heldAnchor === null) {
            return;
        }

        const anchor = this.heldAnchor;
        const blend = RagdollEntity.HOLD_BLEND;

        const nextX = anchor.x + (x - anchor.x) * blend;
        const nextY = anchor.y + (y - anchor.y) * blend;
        const nextZ = anchor.z + (z - anchor.z) * blend;

        this.heldVelocity.set(nextX - anchor.x, nextY - anchor.y, nextZ - anchor.z);
        anchor.set(nextX, nextY, nextZ);
    }

    updateHeld() {
        const anchor = this.heldAnchor;
        const offsets = this.heldOffsets;

        if (anchor === null || offsets === null) {
            return;
        }

        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];

            bone.pos.set(
                anchor.x + offsets[i * 3],
                anchor.y + offsets[i * 3 + 1],
                anchor.z + offsets[i * 3 + 2]
            );
        }
    }

    // Let go: the body keeps the speed of the carry, so dropping it while
    // walking throws it ahead instead of leaving it hanging in mid air.
    release() {
        if (!this.held) {
            return;
        }

        this.held = false;
        this.heldAnchor = null;
        this.heldOffsets = null;

        const speed = this.heldVelocity.length();
        if (speed > RagdollEntity.MAX_LINEAR_SPEED) {
            this.heldVelocity.multiplyScalar(RagdollEntity.MAX_LINEAR_SPEED / speed);
        }

        for (const bone of this.bones) {
            bone.vel.copy(this.heldVelocity);
            bone.angVel.set(0.0, 0.0, 0.0);
        }

        this.heldVelocity.set(0.0, 0.0, 0.0);
        this.wake();
    }

    // The player does not collide with ragdolls (they are only a pile of bones),
    // so walking into one pushes it aside and curls it around the player.
    pushFromPlayer() {
        // The player carrying this body would otherwise shove their own limp
        // body around from the inside every tick.
        if (this.isPlayerRagdoll) {
            return;
        }

        const player = this.minecraft && this.minecraft.player;
        if (!player || !player.boundingBox || player.isDead || !this.boundingBox) {
            return;
        }

        const box = this.boundingBox;
        const playerBox = player.boundingBox;
        if (!box.intersects(playerBox)) {
            return;
        }

        // Pushing somebody else's body means taking the simulation over first.
        if (this.remote) {
            this.claim();
        }

        const playerX = (playerBox.minX + playerBox.maxX) * 0.5;
        const playerZ = (playerBox.minZ + playerBox.maxZ) * 0.5;

        let dirX = (box.minX + box.maxX) * 0.5 - playerX;
        let dirZ = (box.minZ + box.maxZ) * 0.5 - playerZ;
        const length = Math.sqrt(dirX * dirX + dirZ * dirZ);

        if (length < 1e-5) {
            // Standing exactly inside it: shove it the way the player faces.
            const yaw = (Number(player.rotationYaw) || 0) * Math.PI / 180;
            dirX = -Math.sin(yaw);
            dirZ = Math.cos(yaw);
        } else {
            dirX /= length;
            dirZ /= length;
        }

        const motionX = Number(player.motionX) || 0;
        const motionZ = Number(player.motionZ) || 0;
        const walking = Math.sqrt(motionX * motionX + motionZ * motionZ);
        const speed = RagdollEntity.PUSH_SPEED + Math.min(0.25, walking) * 0.9;

        // Where the player meets the pile. Bones at the contact barely move and
        // the far side swings around it, so the body rolls around the player
        // instead of sliding flat across the floor.
        const contactX = Math.max(box.minX, Math.min(playerX, box.maxX));
        const contactZ = Math.max(box.minZ, Math.min(playerZ, box.maxZ));

        this.wake();

        for (const bone of this.bones) {
            const relX = bone.pos.x - contactX;
            const relZ = bone.pos.z - contactZ;

            const forward = relX * dirX + relZ * dirZ;
            const lateral = relX * -dirZ + relZ * dirX;

            const lever = Math.max(0.0, Math.min(1.0, forward * 1.5 + 0.15));
            const targetX = dirX * speed * lever;
            const targetZ = dirZ * speed * lever;

            // Grip first: a limp body being shoved is not a puck on ice.
            bone.vel.x *= RagdollEntity.PUSH_FRICTION;
            bone.vel.z *= RagdollEntity.PUSH_FRICTION;

            bone.vel.x += (targetX - bone.vel.x) * RagdollEntity.PUSH_BLEND;
            bone.vel.z += (targetZ - bone.vel.z) * RagdollEntity.PUSH_BLEND;

            // Limbs on either side swing opposite ways, curling the body around
            // the player instead of sliding it away in a straight line.
            bone.angVel.y += lateral * RagdollEntity.PUSH_TWIST * speed;
        }
    }

    // Punching damages the body. The hit still wakes it so a broken block or a
    // settled body reacts, but it is not shoved along the ground any more.
    damage(amount) {
        if (this.isDead || this.isPlayerRagdoll) {
            return false;
        }

        const damage = Number(amount);
        if (!Number.isFinite(damage) || damage <= 0) {
            return false;
        }

        this.health = Math.max(0, this.health - damage);
        this.wake();

        if (this.renderer && typeof performance !== "undefined") {
            this.renderer.hurtTimestamp = performance.now();
        }

        if (this.health <= 0) {
            this.breakApart();
            return true;
        }

        return false;
    }

    breakApart() {
        if (this.isDead) {
            return;
        }

        this.isDead = true;
        this.sendNetworkState({type: "ragdoll:remove", id: this.syncId});

        if (typeof this.minecraft.onRagdollBroken === "function") {
            this.minecraft.onRagdollBroken(this);
        }

        this.world.removeEntityById(this.id);
    }

    // Physics only ever runs on a client. A client that wants to touch somebody
    // else's body takes the simulation over first, and the server tells the old
    // owner to go back to replaying.
    claim() {
        if (!this.remote) {
            return;
        }

        this.adoptLocalSimulation();
        this.sendNetworkState({type: "ragdoll:claim", id: this.syncId});
    }

    // Stop carrying without applying the carry velocity; used when the body is
    // handed back to another client's simulation.
    dropHeld() {
        this.held = false;
        this.heldAnchor = null;
        this.heldOffsets = null;
        this.heldVelocity.set(0.0, 0.0, 0.0);
    }

    adoptLocalSimulation() {
        if (!this.remote) {
            return;
        }

        this.remote = false;
        this.remoteTargets = null;
        this.remoteSettled = false;
        this.quietTicks = 0;
        this.settleAnchor = this.captureAnchor();

        for (const bone of this.bones) {
            bone.vel.set(0.0, 0.0, 0.0);
            bone.angVel.set(0.0, 0.0, 0.0);
            bone.prevPos.copy(bone.pos);
            bone.prevQuat.copy(bone.quat);
        }
    }

    releaseToReplay() {
        if (this.remote) {
            return;
        }

        // Another client owns the body now, so whoever was carrying it has to
        // let go before the snapshots take over.
        this.dropHeld();

        this.remote = true;
        this.remoteTargets = null;
        this.remoteSettled = false;

        for (const bone of this.bones) {
            bone.vel.set(0.0, 0.0, 0.0);
            bone.angVel.set(0.0, 0.0, 0.0);
        }
    }

    // Remember where every bone is right now. The body sleeps once nothing has
    // moved more than SLEEP_MOVE_DISTANCE away from this pose for four seconds.
    captureAnchor() {
        const anchor = new Float64Array(this.bones.length * 3);

        for (let i = 0; i < this.bones.length; i++) {
            anchor[i * 3] = this.bones[i].pos.x;
            anchor[i * 3 + 1] = this.bones[i].pos.y;
            anchor[i * 3 + 2] = this.bones[i].pos.z;
        }

        return anchor;
    }

    movedSinceAnchor() {
        if (this.settleAnchor === null || this.settleAnchor.length !== this.bones.length * 3) {
            return Infinity;
        }

        let moved = 0.0;
        for (let i = 0; i < this.bones.length; i++) {
            const pos = this.bones[i].pos;
            const dx = pos.x - this.settleAnchor[i * 3];
            const dy = pos.y - this.settleAnchor[i * 3 + 1];
            const dz = pos.z - this.settleAnchor[i * 3 + 2];
            moved = Math.max(moved, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }

        return moved;
    }

    // Wake up when the world changes around the body, so breaking the floor it
    // rests on or putting a block into it makes it react again.
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

        this.wake();
    }

    updateSleepState() {
        // A joint that is still being pulled together means the body is not at
        // rest yet, however little it has moved.
        if (this.maxJointGap() > RagdollEntity.JOINT_SLEEP_TOLERANCE
            || this.movedSinceAnchor() > RagdollEntity.SLEEP_MOVE_DISTANCE) {
            this.quietTicks = 0;
            this.settleAnchor = this.captureAnchor();
            return;
        }

        if (++this.quietTicks < RagdollEntity.SLEEP_TICKS) {
            return;
        }

        this.asleep = true;

        for (const bone of this.bones) {
            bone.vel.set(0.0, 0.0, 0.0);
            bone.angVel.set(0.0, 0.0, 0.0);
        }
    }

    // Remote bodies follow the snapshot the owner last broadcast. The renderer
    // already blends between ticks, so easing here is enough to look smooth at
    // one packet per second.
    interpolateRemote() {
        if (this.remoteTargets === null || this.remoteSettled) {
            return;
        }

        const blend = RagdollEntity.REMOTE_BLEND;
        const snapDistance = RagdollEntity.REMOTE_SNAP_DISTANCE;
        const snapAngle = Math.cos(RagdollEntity.REMOTE_SNAP_ANGLE * 0.5);
        let settled = true;

        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];
            const target = this.remoteTargets[i];
            if (!target) {
                continue;
            }

            bone.pos.lerp(target.pos, blend);
            bone.quat.slerp(target.quat, blend);

            if (bone.pos.distanceToSquared(target.pos) > snapDistance * snapDistance
                || Math.abs(bone.quat.dot(target.quat)) < snapAngle) {
                settled = false;
            }
        }

        if (settled) {
            this.snapToRemoteTarget();
            this.remoteSettled = true;
        }

        this.updateBoundingBox();

        if (this.y < RagdollEntity.VOID_Y) {
            this.isDead = true;
            this.world.removeEntityById(this.id);
        }
    }

    snapToRemoteTarget() {
        for (let i = 0; i < this.bones.length; i++) {
            const target = this.remoteTargets[i];
            if (!target) {
                continue;
            }

            const bone = this.bones[i];
            bone.pos.copy(target.pos);
            bone.quat.copy(target.quat);
            bone.updateInertiaWorld();
        }
    }

    // Take a snapshot of another client's ragdoll. Every bone must be present
    // and finite, otherwise the body would jump to a nonsense pose.
    applyRemoteState(state, snap = false) {
        const bones = state && Array.isArray(state.bones) ? state.bones : null;
        if (bones === null) {
            return;
        }

        const targets = [];
        for (let i = 0; i < this.bones.length; i++) {
            const data = bones[i];
            const values = data
                ? [data.x, data.y, data.z, data.qx, data.qy, data.qz, data.qw]
                : null;

            if (values === null || !values.every((value) => Number.isFinite(value))) {
                return;
            }

            const quat = new THREE.Quaternion(values[3], values[4], values[5], values[6]);
            if (quat.lengthSq() < 1e-8) {
                return;
            }

            targets.push({
                pos: new THREE.Vector3(values[0], values[1], values[2]),
                quat: quat.normalize()
            });
        }

        this.remoteTargets = targets;
        this.asleep = !!(state && state.asleep);
        this.remoteSettled = false;

        if (Number.isFinite(state && state.health)) {
            const health = Math.max(0, Math.min(RagdollEntity.MAX_HEALTH, state.health));

            // Another client's hit shows up as a drop in health, so flash the
            // body here too instead of waiting for a separate hurt message.
            if (health < this.health && this.renderer && typeof performance !== "undefined") {
                this.renderer.hurtTimestamp = performance.now();
            }

            this.health = health;
        }

        if (typeof state.name === "string" && state.name.length > 0) {
            this.displayName = state.name.slice(0, 32);
        }
        if (Array.isArray(state.loot)) {
            this.loot = RagdollEntity.sanitizeLoot(state.loot);
        }

        if (!snap) {
            return;
        }

        this.snapToRemoteTarget();
        this.remoteSettled = true;
        this.updateBoundingBox();

        for (const bone of this.bones) {
            bone.prevPos.copy(bone.pos);
            bone.prevQuat.copy(bone.quat);
        }
    }

    serializeState() {
        const round = (value) => Math.round(value * 10000) / 10000;

        const state = {
            id: this.syncId,
            asleep: this.asleep,
            health: this.health,
            bones: this.bones.map((bone) => ({
                x: round(bone.pos.x),
                y: round(bone.pos.y),
                z: round(bone.pos.z),
                qx: round(bone.quat.x),
                qy: round(bone.quat.y),
                qz: round(bone.quat.z),
                qw: round(bone.quat.w)
            }))
        };

        if (this.displayName) {
            state.name = this.displayName;
        }
        if (this.loot.length > 0) {
            state.loot = this.loot;
        }

        return state;
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

            const state = this.serializeState();
            manager.sendJson({type: "ragdoll:state", ...state});
        } catch (error) {
            // A network hiccup must never stop the physics loop.
        }
    }

    dampRestingContacts() {
        // Never sleep a body that still has a stretched joint to close.
        if (this.maxJointGap() > RagdollEntity.JOINT_SLEEP_TOLERANCE) {
            for (const bone of this.bones) {
                bone.restingContact = false;
            }
            return;
        }

        for (const bone of this.bones) {
            if (!bone.restingContact) {
                continue;
            }

            bone.vel.multiplyScalar(RagdollEntity.GROUND_LINEAR_DAMPING);
            bone.angVel.multiplyScalar(RagdollEntity.GROUND_ANGULAR_DAMPING);

            // Once a limb is only being pulled down by gravity it is asleep, so
            // drop the leftover creep and stop it vibrating on its corners.
            if (bone.vel.length() < RagdollEntity.SLEEP_LINEAR_SPEED) {
                bone.vel.set(0.0, 0.0, 0.0);
            }
            if (bone.angVel.length() < RagdollEntity.SLEEP_ANGULAR_SPEED) {
                bone.angVel.set(0.0, 0.0, 0.0);
            }

            bone.restingContact = false;
        }
    }

    correctJointPositions(beta = RagdollEntity.JOINT_POSITION_BETA) {
        for (let iteration = 0; iteration < RagdollEntity.JOINT_POSITION_ITERATIONS; iteration++) {
            for (const joint of this.joints) {
                const a = joint.a;
                const b = joint.b;

                const anchorA = joint.anchorA.clone().applyQuaternion(a.quat).add(a.pos);
                const anchorB = joint.anchorB.clone().applyQuaternion(b.quat).add(b.pos);

                const total = a.invMass + b.invMass;
                const correction = anchorA.sub(anchorB).multiplyScalar(beta / total);

                a.pos.addScaledVector(correction, -a.invMass);
                b.pos.addScaledVector(correction, b.invMass);
            }
        }
    }

    // Ball sockets are not hinges, but a limp body still cannot fold a limb
    // through itself: cap how far each joint may twist from its rest pose.
    limitJointAngles() {
        for (const joint of this.joints) {
            const a = joint.a;
            const b = joint.b;

            const relative = a.quat.clone().invert().multiply(b.quat);
            const angle = 2.0 * Math.acos(Math.min(1.0, Math.abs(relative.w)));

            if (angle <= joint.limit) {
                continue;
            }

            // Quaternions are double covered, so flip the axis when w is negative.
            const sign = relative.w < 0.0 ? -1.0 : 1.0;
            const axis = new THREE.Vector3(relative.x, relative.y, relative.z).multiplyScalar(sign);

            if (axis.lengthSq() < 1e-10) {
                continue;
            }

            axis.normalize().applyQuaternion(a.quat);

            const excess = angle - joint.limit;
            const total = a.invMass + b.invMass;
            const shareA = excess * (a.invMass / total);
            const shareB = excess * (b.invMass / total);

            a.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, shareA)).normalize();
            b.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -shareB)).normalize();
        }
    }

    maxJointGap() {
        let gap = 0.0;

        for (const joint of this.joints) {
            const anchorA = joint.anchorA.clone().applyQuaternion(joint.a.quat).add(joint.a.pos);
            const anchorB = joint.anchorB.clone().applyQuaternion(joint.b.quat).add(joint.b.pos);
            gap = Math.max(gap, anchorA.distanceTo(anchorB));
        }

        return gap;
    }

    integrateVelocities(step) {
        for (const bone of this.bones) {
            bone.vel.y -= RagdollEntity.GRAVITY * step;
            bone.vel.multiplyScalar(RagdollEntity.LINEAR_DAMPING);
            bone.angVel.multiplyScalar(RagdollEntity.ANGULAR_DAMPING);
            bone.limitVelocity();
        }
    }

    integratePositions(step) {
        for (const bone of this.bones) {
            bone.pos.addScaledVector(bone.vel, step);

            if (bone.angVel.lengthSq() > 1e-12) {
                const half = bone.angVel.clone().multiplyScalar(0.5 * step);
                const spin = new THREE.Quaternion(half.x, half.y, half.z, 0.0).multiply(bone.quat);

                bone.quat.set(
                    bone.quat.x + spin.x,
                    bone.quat.y + spin.y,
                    bone.quat.z + spin.z,
                    bone.quat.w + spin.w
                ).normalize();
            }

            bone.updateInertiaWorld();
        }
    }

    solveJoints() {
        for (const joint of this.joints) {
            const a = joint.a;
            const b = joint.b;

            const offsetA = joint.anchorA.clone().applyQuaternion(a.quat);
            const offsetB = joint.anchorB.clone().applyQuaternion(b.quat);

            const anchorA = a.pos.clone().add(offsetA);
            const anchorB = b.pos.clone().add(offsetB);

            // Stop the two anchors drifting apart. Any gap the last step left is
            // closed by the position projection once positions are integrated.
            const relativeVelocity = a.velocityAt(offsetA).sub(b.velocityAt(offsetB));

            const mass = this.computeJointMass(a, b, offsetA, offsetB).invert();
            const impulse = relativeVelocity.applyMatrix3(mass).negate();

            a.applyImpulse(offsetA, impulse);
            b.applyImpulse(offsetB, impulse.negate());

            a.limitVelocity();
            b.limitVelocity();
        }
    }

    // Effective mass matrix of a point to point joint, built column by column:
    // how the relative anchor velocity responds to a unit impulse.
    computeJointMass(a, b, offsetA, offsetB) {
        const columns = [
            new THREE.Vector3(1.0, 0.0, 0.0),
            new THREE.Vector3(0.0, 1.0, 0.0),
            new THREE.Vector3(0.0, 0.0, 1.0)
        ];

        for (let axis = 0; axis < 3; axis++) {
            columns[axis] = this.deltaVelocityAtPoint(a, offsetA, columns[axis])
                .sub(this.deltaVelocityAtPoint(b, offsetB, columns[axis].clone().negate()));
        }

        return new THREE.Matrix3().set(
            columns[0].x, columns[1].x, columns[2].x,
            columns[0].y, columns[1].y, columns[2].y,
            columns[0].z, columns[1].z, columns[2].z
        );
    }

    deltaVelocityAtPoint(bone, offset, impulse) {
        const angular = new THREE.Vector3()
            .crossVectors(offset, impulse)
            .applyMatrix3(bone.invInertiaWorld);

        return impulse.clone().multiplyScalar(bone.invMass)
            .add(new THREE.Vector3().crossVectors(angular, offset));
    }

    getNearbyCollisionBoxes() {
        if (typeof this.world.getCollisionBoxes !== "function") {
            return [];
        }

        const margin = RagdollEntity.CONTACT_MARGIN;

        // A limp body is always resting on or falling onto what is below it, so
        // ask for the downward shape. Blocks whose collision only exists from
        // above (scaffolding answers the downward query and nothing else) fell
        // through the body otherwise, because the ground query has no context.
        return this.world.getCollisionBoxes(
            this.computeBoundingBox().grow(margin, margin, margin),
            this.collidesWithOffGridField,
            { downward: true, sneaking: false }
        );
    }

    solveContacts(boxes, applyVelocities = true) {
        if (boxes.length === 0) {
            return;
        }

        const radius = RagdollEntity.CONTACT_RADIUS;

        for (const bone of this.bones) {
            for (const corner of bone.corners) {
                const point = corner.clone().applyQuaternion(bone.quat).add(bone.pos);
                const offset = point.clone().sub(bone.pos);

                for (const box of boxes) {
                    const closest = new THREE.Vector3(
                        Math.max(box.minX, Math.min(point.x, box.maxX)),
                        Math.max(box.minY, Math.min(point.y, box.maxY)),
                        Math.max(box.minZ, Math.min(point.z, box.maxZ))
                    );

                    let normal = point.clone().sub(closest);
                    let distance = normal.length();

                    if (distance > radius) {
                        continue;
                    }

                    if (distance > 1e-6) {
                        normal.multiplyScalar(1.0 / distance);
                    } else {
                        // Inside the block: leave through the nearest face and
                        // count the depth as negative, so the corner ends up a
                        // full radius outside the face instead of still inside.
                        normal = this.nearestFaceNormal(box, point);
                        distance = -this.distanceToFace(box, point, normal);
                    }

                    const penetration = radius - distance;
                    if (penetration <= 0.0) {
                        continue;
                    }

                    // Move the contact out of the block, then stop it moving in.
                    bone.pos.addScaledVector(normal, penetration);
                    point.addScaledVector(normal, penetration);

                    this.touching = true;

                    if (applyVelocities) {
                        this.resolveContact(bone, offset, normal);
                    }
                }
            }
        }
    }

    distanceToFace(box, point, normal) {
        if (normal.x < 0.0) return point.x - box.minX;
        if (normal.x > 0.0) return box.maxX - point.x;
        if (normal.y < 0.0) return point.y - box.minY;
        if (normal.y > 0.0) return box.maxY - point.y;
        if (normal.z < 0.0) return point.z - box.minZ;
        return box.maxZ - point.z;
    }

    nearestFaceNormal(box, point) {
        const distances = [
            point.x - box.minX,
            box.maxX - point.x,
            point.y - box.minY,
            box.maxY - point.y,
            point.z - box.minZ,
            box.maxZ - point.z
        ];

        let nearest = 0;
        for (let index = 1; index < distances.length; index++) {
            if (distances[index] < distances[nearest]) {
                nearest = index;
            }
        }

        switch (nearest) {
            case 0: return new THREE.Vector3(-1.0, 0.0, 0.0);
            case 1: return new THREE.Vector3(1.0, 0.0, 0.0);
            case 2: return new THREE.Vector3(0.0, -1.0, 0.0);
            case 3: return new THREE.Vector3(0.0, 1.0, 0.0);
            case 4: return new THREE.Vector3(0.0, 0.0, -1.0);
            default: return new THREE.Vector3(0.0, 0.0, 1.0);
        }
    }

    resolveContact(bone, offset, normal) {
        const velocity = bone.velocityAt(offset);
        const normalSpeed = velocity.dot(normal);

        if (normalSpeed >= 0.0) {
            return;
        }

        if (normalSpeed > -RagdollEntity.RESTING_SPEED) {
            bone.restingContact = true;
        }

        const normalMass = bone.invMass + this.angularDenominator(bone, offset, normal);
        if (normalMass <= 1e-6) {
            return;
        }

        const bounce = -(1.0 + RagdollEntity.RESTITUTION) * normalSpeed / normalMass;
        bone.applyImpulse(offset, normal.clone().multiplyScalar(bounce));

        // Friction: stop the contact sliding along the surface it rests on.
        const sliding = velocity.clone().addScaledVector(normal, -normalSpeed);
        const speed = sliding.length();

        if (speed < 1e-6) {
            return;
        }

        const direction = sliding.multiplyScalar(1.0 / speed);
        const tangentMass = bone.invMass + this.angularDenominator(bone, offset, direction);
        const friction = Math.min(speed / tangentMass, RagdollEntity.FRICTION * bounce);

        bone.applyImpulse(offset, direction.multiplyScalar(-friction));
        bone.limitVelocity();
    }

    // Extra effective mass a force along direction sees when applied offset
    // from the centre of mass: direction . ((I^-1 (offset x direction)) x offset).
    angularDenominator(bone, offset, direction) {
        const angular = new THREE.Vector3()
            .crossVectors(offset, direction)
            .applyMatrix3(bone.invInertiaWorld);

        return new THREE.Vector3().crossVectors(angular, offset).dot(direction);
    }

    computeBoundingBox() {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (const bone of this.bones) {
            for (const corner of bone.corners) {
                const point = corner.clone().applyQuaternion(bone.quat).add(bone.pos);

                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                minZ = Math.min(minZ, point.z);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
                maxZ = Math.max(maxZ, point.z);
            }
        }

        return new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ);
    }

    updateBoundingBox() {
        const box = this.computeBoundingBox();

        this.boundingBox = box;
        this.width = box.width();
        this.height = box.height();

        this.x = (box.minX + box.maxX) / 2.0;
        this.y = box.minY;
        this.z = (box.minZ + box.maxZ) / 2.0;
    }
}
