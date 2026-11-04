import { isFluidType } from '../vanilla-worldgen/fluid-state.mjs';

const f = Math.fround;
const waterDrag = f(.8);

export function fluidSurfaceHeight(world, x, y, z, fluid) {
    if (!fluid || fluid.empty) return 0;
    if (isFluidType(world.getFluidState?.(x, y + 1, z), fluid.name)) return 1;
    const level = Number(fluid.level ?? 0);
    const amount = level >= 8 ? 8 : 8 - level;
    return Math.min(fluid.ceilingHeight ?? 1, Math.max(fluid.baseHeight ?? 0, f(amount / 9)));
}

export function pointInFluid(world, x, y, z, kind, fallbackId) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (!world?.getFluidState) return fallbackId !== undefined && world?.getBlockAt?.(bx, by, bz) === fallbackId;
    const fluid = world.getFluidState(bx, by, bz);
    return isFluidType(fluid, kind) && y >= by + (fluid.baseHeight ?? 0) && y < by + fluidSurfaceHeight(world, bx, by, bz, fluid);
}

// EntityFluidInteraction scans the deflated body box, not a block at its center.
// Share the result between water/lava tests until this body moves or ticks.
export function entityFluidDepth(entity, kind, fallbackId) {
    const box = entity.boundingBox;
    if (!box || !(box.maxX > box.minX && box.maxY > box.minY && box.maxZ > box.minZ)) {
        return pointInFluid(entity.world, entity.x, entity.y + .1, entity.z, kind, fallbackId) ? 1 : 0;
    }
    if (!entity.world?.getFluidState) {
        return pointInFluid(entity.world, entity.x, entity.y + .1, entity.z, kind, fallbackId) ? 1 : 0;
    }
    let sample = entity.fluidContact;
    if (!sample || sample.tick !== entity.ticksExisted || sample.world !== entity.world || sample.fluidAt !== entity.world.getFluidState ||
        sample.minX !== box.minX || sample.minY !== box.minY || sample.minZ !== box.minZ ||
        sample.maxX !== box.maxX || sample.maxY !== box.maxY || sample.maxZ !== box.maxZ) {
        sample = { tick: entity.ticksExisted, world: entity.world, fluidAt: entity.world.getFluidState, minX: box.minX, minY: box.minY, minZ: box.minZ,
            maxX: box.maxX, maxY: box.maxY, maxZ: box.maxZ, water: 0, lava: 0,
            currents: { water: { x: 0, y: 0, z: 0, count: 0 }, lava: { x: 0, y: 0, z: 0, count: 0 } } };
        const bottom = box.minY + .001;
        for (let x = Math.floor(box.minX + .001); x < Math.ceil(box.maxX - .001); x++) {
            for (let y = Math.floor(bottom); y < Math.ceil(box.maxY - .001); y++) {
                for (let z = Math.floor(box.minZ + .001); z < Math.ceil(box.maxZ - .001); z++) {
                    const fluid = entity.world.getFluidState(x, y, z);
                    const name = isFluidType(fluid, 'water') ? 'water' : isFluidType(fluid, 'lava') ? 'lava' : null;
                    if (!name) continue;
                    const surface = y + fluidSurfaceHeight(entity.world, x, y, z, fluid);
                    if (surface >= bottom && y + (fluid.baseHeight ?? 0) < box.maxY - .001) {
                        sample[name] = Math.max(sample[name], surface - bottom);
                        const flow = entity.world.getFluidFlowAt?.(x, y, z, fluid);
                        if (flow) {
                            const scale = sample[name] < .4 ? sample[name] : 1;
                            const current = sample.currents[name];
                            current.x += flow.x * scale; current.y += flow.y * scale; current.z += flow.z * scale;
                            current.count++;
                        }
                    }
                }
            }
        }
        entity.fluidContact = sample;
    }
    return sample[kind] ?? 0;
}

export function applyFluidCurrent(entity) {
    if (entity.flying || entity.spectator || !entity.world?.getFluidFlowAt) return;
    entityFluidDepth(entity, 'water');
    for (const kind of ['water', 'lava']) {
        const current = entity.fluidContact?.currents[kind];
        if (!current?.count || current.x ** 2 + current.y ** 2 + current.z ** 2 < Math.fround(.00001)) continue;
        const player = typeof entity.updatePlayerPose === 'function';
        const divisor = player ? current.count : Math.hypot(current.x, current.y, current.z);
        const strength = kind === 'water' ? .014 : entity.world.fastLava ? .007 : .0023333333333333335;
        let x = current.x / divisor * strength, y = current.y / divisor * strength, z = current.z / divisor * strength;
        const length = Math.hypot(x, y, z);
        if (Math.abs(entity.motionX) < .003 && Math.abs(entity.motionZ) < .003 && length > 0 && length < .0045) {
            x *= .0045 / length; y *= .0045 / length; z *= .0045 / length;
        }
        entity.motionX -= x;
        entity.motionY += y;
        entity.motionZ -= z;
    }
}

export function fluidFallingVelocity(y, gravity, sprinting, falling) {
    if (!gravity || sprinting) return y;
    if (falling && Math.abs(y - .005) >= .003 && Math.abs(y - gravity / 16) < .003) return -.003;
    return y - gravity / 16;
}

export function jumpOutOfFluid(entity, previousY) {
    if (!entity.collision || !entity.boundingBox || !entity.world?.getCollisionBoxes) return;
    const box = entity.boundingBox.offset(-entity.motionX, entity.motionY + f(.6) - entity.y + previousY, -entity.motionZ);
    if (entity.world.getCollisionBoxes(box).length) return;
    // Entity.isFree also rejects fluid in the destination volume.
    if (entity.world.containsAnyLiquid?.(box)) return;
    if (!entity.world.containsAnyLiquid && entity.world.getFluidState && Number.isFinite(box.minX)) {
        for (let x = Math.floor(box.minX); x < Math.ceil(box.maxX); x++)
            for (let y = Math.floor(box.minY); y < Math.ceil(box.maxY); y++)
                for (let z = Math.floor(box.minZ); z < Math.ceil(box.maxZ); z++) {
                    const fluid = entity.world.getFluidState(x, y, z);
                    if (fluid && !fluid.empty) return;
                }
    }
    entity.motionY = f(.3);
}

export function travelInWater(entity, forward, vertical, strafe) {
    const gravity = entity.gravity ?? .08;
    const falling = entity.motionY <= 0;
    const previousY = entity.y;
    let drag = f(entity.sprinting ? .9 : entity.waterSlowDown ?? .8);
    let acceleration = f(.02);
    let efficiency = Math.max(0, Math.min(1, entity.waterMovementEfficiency ?? 0));
    if (!entity.onGround) efficiency = f(efficiency * .5);
    if (efficiency > 0) {
        drag = f(drag + f(f(f(.54600006) - drag) * efficiency));
        acceleration = f(acceleration + f(f(f(entity.getAIMoveSpeed()) - acceleration) * efficiency));
    }
    if (entity.statusEffects?.has('dolphins_grace')) drag = f(.96);
    entity.moveRelative(forward, vertical, strafe, acceleration);
    entity.collision = entity.moveCollide(-entity.motionX, entity.motionY, -entity.motionZ);
    if (entity.collision && entity.onClimbable?.()) entity.motionY = .2;
    entity.motionX *= drag;
    entity.motionZ *= drag;
    entity.motionY = fluidFallingVelocity(entity.motionY * waterDrag, gravity, entity.sprinting, falling);
    jumpOutOfFluid(entity, previousY);
    entity.fallDistance = 0;
    entity.wasOnGround = false;
}

export function travelInLava(entity, forward, vertical, strafe) {
    const gravity = entity.gravity ?? .08;
    const falling = entity.motionY <= 0;
    const previousY = entity.y;
    entity.moveRelative(forward, vertical, strafe, f(.02));
    entity.collision = entity.moveCollide(-entity.motionX, entity.motionY, -entity.motionZ);
    const shallow = entityFluidDepth(entity, 'lava') <= (entity.getFluidJumpThreshold?.() ?? .4);
    entity.motionX *= .5;
    entity.motionZ *= .5;
    entity.motionY = shallow ? fluidFallingVelocity(entity.motionY * waterDrag, gravity, entity.sprinting, falling) : entity.motionY * .5;
    entity.motionY -= gravity / 4;
    jumpOutOfFluid(entity, previousY);
    entity.fallDistance = 0;
    entity.wasOnGround = false;
}

export function waterVision(ticks) {
    return Math.min(1, Math.max(0, ticks / 100)) * .6 + Math.min(1, Math.max(0, (ticks - 100) / 500)) * .4;
}
