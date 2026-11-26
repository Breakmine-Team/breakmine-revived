import Entity from "./Entity.js";

export default class BallEntity extends Entity {

    static RADIUS = 0.3;
    static GRAVITY = 0.04;
    static AIR_DRAG = 0.995;
    static BOUNCE = 0.62;
    static GROUND_FRICTION = 0.9;
    static MIN_BOUNCE = 0.035;
    static MIN_ROLL = 0.002;
    static MAX_FALL_SPEED = 0.9;
    static SPAWN_POP = 0.12;
    static VOID_Y = -16;
    static KICK_SPEED = 0.55;
    static KICK_LIFT = 0.2;

    // Painted like a concrete block, so every ball comes out a different colour.
    static CONCRETE_COLORS = [
        0xcfd5d6, 0xe06101, 0xa9309f, 0x2489c7,
        0xf1af15, 0x5ea918, 0xee5d8d, 0x36393d,
        0x7d7d73, 0x157788, 0x64209c, 0x2c2e8f,
        0x603b1f, 0x495b24, 0x8e2121, 0x080a0f
    ];

    static randomConcreteColor() {
        return BallEntity.CONCRETE_COLORS[
            Math.floor(Math.random() * BallEntity.CONCRETE_COLORS.length)
        ];
    }

    constructor(minecraft, world, x, y, z, color = BallEntity.randomConcreteColor()) {
        super(minecraft, world, -2);

        this.width = BallEntity.RADIUS * 2;
        this.height = BallEntity.RADIUS * 2;

        this.color = color;

        this.setPositionAndRotation(x, y, z, 0, 0);

        this.initRenderer();
    }

    getRadius() {
        return BallEntity.RADIUS;
    }

    onEntityUpdate() {
        super.onEntityUpdate();

        if (this.isDead) {
            return;
        }

        if (this.y < BallEntity.VOID_Y) {
            this.isDead = true;
            this.world.removeEntityById(this.id);
            return;
        }

        // Gravity and air drag. The terminal speed stays below one block per
        // tick so the ball cannot tunnel through a floor.
        this.motionY = Math.max(
            -BallEntity.MAX_FALL_SPEED,
            this.motionY - BallEntity.GRAVITY
        );
        this.motionX *= BallEntity.AIR_DRAG;
        this.motionZ *= BallEntity.AIR_DRAG;

        const stepX = this.motionX;
        const stepY = this.motionY;
        const stepZ = this.motionZ;

        // moveCollide clips the bounding box against the world and zeroes the
        // velocity of every axis it had to stop, so a zeroed axis is a hit.
        this.moveCollide(stepX, stepY, stepZ);

        this.bounceAxis("motionY", stepY);
        this.bounceAxis("motionX", stepX);
        this.bounceAxis("motionZ", stepZ);

        if (this.onGround) {
            this.motionX *= BallEntity.GROUND_FRICTION;
            this.motionZ *= BallEntity.GROUND_FRICTION;

            if (Math.abs(this.motionX) < BallEntity.MIN_ROLL) this.motionX = 0.0;
            if (Math.abs(this.motionZ) < BallEntity.MIN_ROLL) this.motionZ = 0.0;
        }
    }

    // Ping the ball along a horizontal direction with a small lift, which is
    // what the player's kick uses when they aim at it.
    kick(dirX, dirZ, speed = BallEntity.KICK_SPEED) {
        const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (length < 1e-4) {
            dirX = 0.0;
            dirZ = -1.0;
        } else {
            dirX /= length;
            dirZ /= length;
        }

        this.motionX = dirX * speed;
        this.motionZ = dirZ * speed;
        this.motionY = Math.max(this.motionY, 0.0) + BallEntity.KICK_LIFT;
        this.onGround = false;
    }

    // Reflect the velocity of an axis that moveCollide stopped. Hits that are
    // too weak to bounce are dropped so the ball can come to rest instead of
    // jittering on the floor.
    bounceAxis(axis, step) {
        if (step === 0.0 || this[axis] !== 0.0) {
            return;
        }

        const bounced = -step * BallEntity.BOUNCE;
        this[axis] = Math.abs(bounced) < BallEntity.MIN_BOUNCE ? 0.0 : bounced;
    }
}
