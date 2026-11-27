import * as THREE from "../../../../../../libraries/three.module.js";
import BoundingBox from "../../util/BoundingBox.js";

// The contraption is one rigid body made of unit cubes. Everything is measured
// in block units and ticks, so gravity matches the rest of the game.
const CELL_HALF = 0.5;

const CELL_MASS = 1.0;

// A cube is 0.5 * sqrt(3) away from its corners, so this sphere covers the cell
// for the broad phase test against a collision box.
const CELL_RADIUS = CELL_HALF * Math.sqrt(3.0);

const AXIS_EPSILON = 1e-6;

// Impulse based rigid body: it owns the mass properties, integrates the pose and
// pushes the body out of the blocks it runs into. The owner supplies collision
// boxes, so the same body works for the world, off grid fields and anything else
// that can answer with axis aligned boxes.
export default class ContraptionBody {

    // Per tick gravity, same as items and ragdolls.
    static GRAVITY = 0.04;

    static SUBSTEPS = 3;
    static CONTACT_ITERATIONS = 4;

    static POSITION_BETA = 0.8;
    static POSITION_SLOP = 0.001;
    static MAX_CORRECTION = 0.2;
    static FRICTION = 0.6;

    static LINEAR_DAMPING = 0.999;
    static ANGULAR_DAMPING = 0.995;

    static GROUND_LINEAR_DAMPING = 0.82;
    static GROUND_ANGULAR_DAMPING = 0.78;

    // Contacts this slow are resting contacts: they stop bouncing and start
    // bleeding off the leftover creep instead.
    static RESTING_SPEED = 0.12;
    static SLEEP_SPIN_SPEED = 0.1;

    static MAX_LINEAR_SPEED = 1.5;
    static MAX_ANGULAR_SPEED = 0.5;

    constructor(cells) {
        this.cells = cells;

        this.mass = cells.length * CELL_MASS;
        this.invMass = 1.0 / this.mass;

        this.pos = new THREE.Vector3();
        this.quat = new THREE.Quaternion();
        this.vel = new THREE.Vector3();
        this.angVel = new THREE.Vector3();

        this.prevPos = this.pos.clone();
        this.prevQuat = this.quat.clone();

        this.touching = false;

        const inertia = this.computeInertia();
        this.invInertiaLocal = inertia.invert();
        this.invInertiaWorld = new THREE.Matrix3();
        this.updateInertiaWorld();

        this.size = this.computeSize();
    }

    // Inertia tensor of the assembled cubes around the centre of mass. Each cell
    // contributes its own box inertia plus the parallel axis term for its offset.
    computeInertia() {
        let xx = 0.0;
        let yy = 0.0;
        let zz = 0.0;
        let xy = 0.0;
        let xz = 0.0;
        let yz = 0.0;

        for (const cell of this.cells) {
            const r = cell.offset;

            // (1/12) * m * (height^2 + depth^2) of a 1x1x1 cube.
            const own = CELL_MASS / 6.0;

            xx += own + CELL_MASS * (r.y * r.y + r.z * r.z);
            yy += own + CELL_MASS * (r.x * r.x + r.z * r.z);
            zz += own + CELL_MASS * (r.x * r.x + r.y * r.y);

            xy -= CELL_MASS * r.x * r.y;
            xz -= CELL_MASS * r.x * r.z;
            yz -= CELL_MASS * r.y * r.z;
        }

        return new THREE.Matrix3().set(
            xx, xy, xz,
            xy, yy, yz,
            xz, yz, zz
        );
    }

    computeSize() {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (const cell of this.cells) {
            minX = Math.min(minX, cell.offset.x - CELL_HALF);
            minY = Math.min(minY, cell.offset.y - CELL_HALF);
            minZ = Math.min(minZ, cell.offset.z - CELL_HALF);
            maxX = Math.max(maxX, cell.offset.x + CELL_HALF);
            maxY = Math.max(maxY, cell.offset.y + CELL_HALF);
            maxZ = Math.max(maxZ, cell.offset.z + CELL_HALF);
        }

        return new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
    }

    // World inverse inertia: R * I^-1 * R^T.
    updateInertiaWorld() {
        const rotation = new THREE.Matrix4().makeRotationFromQuaternion(this.quat).elements;
        const inertia = this.invInertiaLocal.elements;
        const out = this.invInertiaWorld.elements;

        for (let row = 0; row < 3; row++) {
            for (let column = 0; column < 3; column++) {
                let value = 0.0;

                for (let k = 0; k < 3; k++) {
                    for (let l = 0; l < 3; l++) {
                        value += rotation[k * 3 + row] * inertia[l * 3 + k] * rotation[l * 3 + column];
                    }
                }

                out[column * 3 + row] = value;
            }
        }
    }

    wake() {
        this.touching = false;
    }

    sleep() {
        this.vel.set(0.0, 0.0, 0.0);
        this.angVel.set(0.0, 0.0, 0.0);
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

    // Extra effective mass a force along direction sees when applied offset from
    // the centre of mass: direction . ((I^-1 (offset x direction)) x offset).
    angularDenominator(offset, direction) {
        const angular = new THREE.Vector3()
            .crossVectors(offset, direction)
            .applyMatrix3(this.invInertiaWorld);

        return new THREE.Vector3().crossVectors(angular, offset).dot(direction);
    }

    limitVelocity() {
        const speed = this.vel.length();
        if (speed > ContraptionBody.MAX_LINEAR_SPEED) {
            this.vel.multiplyScalar(ContraptionBody.MAX_LINEAR_SPEED / speed);
        }

        const spin = this.angVel.length();
        if (spin > ContraptionBody.MAX_ANGULAR_SPEED) {
            this.angVel.multiplyScalar(ContraptionBody.MAX_ANGULAR_SPEED / spin);
        }
    }

    // One tick of simulation. queryCollisionBoxes gets the region the body can
    // touch and answers with the axis aligned boxes inside it.
    step(queryCollisionBoxes) {
        const substeps = ContraptionBody.SUBSTEPS;
        const step = 1.0 / substeps;

        for (let substep = 0; substep < substeps; substep++) {
            this.integrateVelocities(step);
            this.integratePositions(step);

            const region = this.computeBounds().grow(CELL_HALF, CELL_HALF, CELL_HALF);
            const boxes = queryCollisionBoxes(region);
            this.solveContacts(boxes);
        }
    }

    integrateVelocities(step) {
        this.vel.y -= ContraptionBody.GRAVITY * step;
        this.vel.multiplyScalar(ContraptionBody.LINEAR_DAMPING);
        this.angVel.multiplyScalar(ContraptionBody.ANGULAR_DAMPING);
        this.limitVelocity();
    }

    integratePositions(step) {
        this.pos.addScaledVector(this.vel, step);

        if (this.angVel.lengthSq() > 1e-12) {
            const half = this.angVel.clone().multiplyScalar(0.5 * step);
            const spin = new THREE.Quaternion(half.x, half.y, half.z, 0.0).multiply(this.quat);

            this.quat.set(
                this.quat.x + spin.x,
                this.quat.y + spin.y,
                this.quat.z + spin.z,
                this.quat.w + spin.w
            ).normalize();
        }

        this.updateInertiaWorld();
    }

    // Rotated world axes of a cell, so the collision test can use them directly.
    getCellAxes() {
        const elements = new THREE.Matrix4().makeRotationFromQuaternion(this.quat).elements;

        return [
            new THREE.Vector3(elements[0], elements[1], elements[2]),
            new THREE.Vector3(elements[4], elements[5], elements[6]),
            new THREE.Vector3(elements[8], elements[9], elements[10])
        ];
    }

    // Every axis two boxes can separate along: the three cell axes, the three
    // world axes and the nine cross products. They only depend on the
    // orientation, so they are built once for all cells and boxes.
    getSeparatingAxes(axes) {
        const worldAxes = [
            new THREE.Vector3(1.0, 0.0, 0.0),
            new THREE.Vector3(0.0, 1.0, 0.0),
            new THREE.Vector3(0.0, 0.0, 1.0)
        ];

        const candidates = [...axes, ...worldAxes];

        for (const axisA of axes) {
            for (const axisB of worldAxes) {
                candidates.push(new THREE.Vector3().crossVectors(axisA, axisB));
            }
        }

        return candidates;
    }

    // Separating axis test between one cell of the body and one collision box.
    // Returns the penetration axis (pointing out of the block) and the deepest
    // point of the cell along it.
    getContact(center, axes, candidates, box) {
        const boxX = (box.minX + box.maxX) * 0.5;
        const boxY = (box.minY + box.maxY) * 0.5;
        const boxZ = (box.minZ + box.maxZ) * 0.5;

        const halfX = (box.maxX - box.minX) * 0.5;
        const halfY = (box.maxY - box.minY) * 0.5;
        const halfZ = (box.maxZ - box.minZ) * 0.5;

        // Broad phase: the closest point of the box to the cell centre.
        const closestX = Math.max(box.minX, Math.min(center.x, box.maxX));
        const closestY = Math.max(box.minY, Math.min(center.y, box.maxY));
        const closestZ = Math.max(box.minZ, Math.min(center.z, box.maxZ));

        const awayX = center.x - closestX;
        const awayY = center.y - closestY;
        const awayZ = center.z - closestZ;

        if (awayX * awayX + awayY * awayY + awayZ * awayZ > CELL_RADIUS * CELL_RADIUS) {
            return null;
        }

        const [ux, uy, uz] = axes;

        const deltaX = center.x - boxX;
        const deltaY = center.y - boxY;
        const deltaZ = center.z - boxZ;

        let bestOverlap = Infinity;
        let bestNormal = null;

        for (const axis of candidates) {
            const length = axis.length();
            if (length < AXIS_EPSILON) {
                continue;
            }

            const nx = axis.x / length;
            const ny = axis.y / length;
            const nz = axis.z / length;

            const cellRadius = CELL_HALF * (
                Math.abs(nx * ux.x + ny * ux.y + nz * ux.z) +
                Math.abs(nx * uy.x + ny * uy.y + nz * uy.z) +
                Math.abs(nx * uz.x + ny * uz.y + nz * uz.z)
            );

            const boxRadius = halfX * Math.abs(nx) + halfY * Math.abs(ny) + halfZ * Math.abs(nz);

            const distance = nx * deltaX + ny * deltaY + nz * deltaZ;
            const overlap = cellRadius + boxRadius - Math.abs(distance);

            if (overlap <= 0.0) {
                return null;
            }

            if (overlap < bestOverlap) {
                const sign = distance >= 0.0 ? 1.0 : -1.0;

                bestOverlap = overlap;
                bestNormal = new THREE.Vector3(nx * sign, ny * sign, nz * sign);
            }
        }

        if (bestNormal === null) {
            return null;
        }

        // Deepest point of the cell along the contact normal, i.e. the corner or
        // face centre that actually touches the block.
        const point = center.clone();
        for (const axis of [ux, uy, uz]) {
            const dot = axis.dot(bestNormal);
            if (Math.abs(dot) > AXIS_EPSILON) {
                point.addScaledVector(axis, dot > 0.0 ? -CELL_HALF : CELL_HALF);
            }
        }

        return { normal: bestNormal, point: point, depth: bestOverlap };
    }

    solveContacts(boxes) {
        if (boxes.length === 0) {
            this.touching = false;
            return;
        }

        const axes = this.getCellAxes();
        const candidates = this.getSeparatingAxes(axes);
        const contacts = [];

        for (const cell of this.cells) {
            const center = cell.offset.clone().applyQuaternion(this.quat).add(this.pos);

            for (const box of boxes) {
                const contact = this.getContact(center, axes, candidates, box);
                if (contact !== null) {
                    contacts.push(contact);
                }
            }
        }

        if (contacts.length === 0) {
            this.touching = false;
            return;
        }

        this.touching = true;

        // Deep penetration can put the cell centre past the middle of a thin
        // block, which makes the box pick the face on the far side. Point the
        // normal against the motion instead, so a fast landing is pushed back
        // out the way it came and not through the floor.
        for (const contact of contacts) {
            const offset = contact.point.clone().sub(this.pos);
            if (this.velocityAt(offset).dot(contact.normal) > ContraptionBody.RESTING_SPEED) {
                contact.normal.negate();
            }
        }

        const merged = this.groupContacts(contacts);

        for (let iteration = 0; iteration < ContraptionBody.CONTACT_ITERATIONS; iteration++) {
            for (const contact of merged) {
                this.resolveContact(contact);
            }
        }

        this.correctPositions(merged);

        // Only a body that is nearly resting gets the ground drag, otherwise a
        // contraption sliding and toppling over a floor would stop dead.
        if (this.vel.length() < ContraptionBody.RESTING_SPEED
            && this.angVel.length() < ContraptionBody.SLEEP_SPIN_SPEED) {
            this.vel.multiplyScalar(ContraptionBody.GROUND_LINEAR_DAMPING);
            this.angVel.multiplyScalar(ContraptionBody.GROUND_ANGULAR_DAMPING);
        }

        this.limitVelocity();
    }

    // A flat face resting on the ground touches with many cells at once. Solving
    // every one of those contacts on its own makes the contacts fight each other
    // and the body rocks or creeps, so contacts that share a normal are merged
    // into one contact at their average point.
    groupContacts(contacts) {
        const groups = new Map();

        for (const contact of contacts) {
            const normal = contact.normal;
            const key = `${normal.x.toFixed(2)},${normal.y.toFixed(2)},${normal.z.toFixed(2)}`;

            let group = groups.get(key);
            if (group === undefined) {
                group = {
                    normal: normal.clone(),
                    pointSum: new THREE.Vector3(),
                    count: 0,
                    depth: 0.0
                };
                groups.set(key, group);
            }

            group.pointSum.add(contact.point);
            group.count++;
            if (contact.depth > group.depth) {
                group.depth = contact.depth;
            }
        }

        const merged = [];
        for (const group of groups.values()) {
            merged.push({
                normal: group.normal,
                point: group.pointSum.multiplyScalar(1.0 / group.count),
                depth: group.depth
            });
        }

        return merged;
    }

    resolveContact(contact) {
        const normal = contact.normal;
        const offset = contact.point.clone().sub(this.pos);

        const velocity = this.velocityAt(offset);
        const normalSpeed = velocity.dot(normal);

        if (normalSpeed >= 0.0) {
            return;
        }

        const normalMass = this.invMass + this.angularDenominator(offset, normal);
        if (normalMass <= 1e-6) {
            return;
        }

        // Contraptions are made of blocks, not of rubber: any bounce here shows
        // up as jitter on a body that has just landed.
        const impulse = -normalSpeed / normalMass;
        this.applyImpulse(offset, normal.clone().multiplyScalar(impulse));

        // Friction: stop the cell sliding along the block it rests on.
        const sliding = this.velocityAt(offset).addScaledVector(normal, -this.velocityAt(offset).dot(normal));
        const speed = sliding.length();

        if (speed < 1e-6) {
            return;
        }

        const tangent = sliding.multiplyScalar(1.0 / speed);
        const tangentMass = this.invMass + this.angularDenominator(offset, tangent);
        const friction = Math.min(speed / tangentMass, ContraptionBody.FRICTION * impulse);

        this.applyImpulse(offset, tangent.multiplyScalar(-friction));
        this.limitVelocity();
    }

    // Push the body out of the blocks it is inside of. Tiny penetrations are
    // left alone and the correction is capped, so a deep corner does not shoot
    // the whole contraption back into the air.
    correctPositions(contacts) {
        for (const contact of contacts) {
            const depth = Math.min(
                contact.depth - ContraptionBody.POSITION_SLOP,
                ContraptionBody.MAX_CORRECTION
            );

            if (depth <= 0.0) {
                continue;
            }

            this.pos.addScaledVector(contact.normal, depth * ContraptionBody.POSITION_BETA);
        }
    }

    // Axis aligned bounds of the rotated cells, in world space.
    computeBounds() {
        const elements = new THREE.Matrix4().makeRotationFromQuaternion(this.quat).elements;

        const extentX = CELL_HALF * (Math.abs(elements[0]) + Math.abs(elements[4]) + Math.abs(elements[8]));
        const extentY = CELL_HALF * (Math.abs(elements[1]) + Math.abs(elements[5]) + Math.abs(elements[9]));
        const extentZ = CELL_HALF * (Math.abs(elements[2]) + Math.abs(elements[6]) + Math.abs(elements[10]));

        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (const cell of this.cells) {
            const center = cell.offset.clone().applyQuaternion(this.quat).add(this.pos);

            minX = Math.min(minX, center.x - extentX);
            minY = Math.min(minY, center.y - extentY);
            minZ = Math.min(minZ, center.z - extentZ);
            maxX = Math.max(maxX, center.x + extentX);
            maxY = Math.max(maxY, center.y + extentY);
            maxZ = Math.max(maxZ, center.z + extentZ);
        }

        return new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ);
    }
}
