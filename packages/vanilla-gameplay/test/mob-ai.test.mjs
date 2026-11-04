import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMobEntity } from '../../../src/js/net/minecraft/client/entity/MobEntity.js';
import PlayerEntity from '../../../src/js/net/minecraft/client/entity/PlayerEntity.js';
import MobArrowEntity from '../../../src/js/net/minecraft/client/entity/MobArrowEntity.js';
import BoundingBox from '../../../src/js/net/minecraft/util/BoundingBox.js';
import VanillaPreviewWorld from '../../../src/js/net/minecraft/client/world/VanillaPreviewWorld.js';
import World from '../../../src/js/net/minecraft/client/world/World.js';
import { BlockRegistry } from '../../../src/js/net/minecraft/client/world/block/BlockRegistry.js';
import { atlasItemTextures, uiTextures } from '../../../src/js/assetManifest.js';
import ItemStack from '../../../src/js/net/minecraft/client/item/ItemStack.js';
import { applyKnockback } from '../combat.mjs';
import InventoryPlayer from '../../../src/js/net/minecraft/client/inventory/inventory/InventoryPlayer.js';
import blockStates from '../../vanilla-worldgen/generated/block-states.json' with { type: 'json' };

if (!BlockRegistry.init) BlockRegistry.create();

function makePlayer(overrides = {}) {
    return {
        x: 4, y: 64, z: 0, width: 0.6, height: 1.8, health: 20,
        creative: false, spectator: false, isDead: false, onGround: true,
        damageCalls: [],
        damageEntity(amount, attacker) {
            this.damageCalls.push({ amount, attacker });
            this.health -= amount;
            return amount;
        },
        addStatusEffect(effect, duration, amplifier) {
            this.statusEffects ??= new Map();
            this.statusEffects.set(effect, { duration, amplifier });
        },
        ...overrides
    };
}

function makeMob(type = 'zombie', player = makePlayer(), preview = true) {
    const world = {
        entities: [],
        vanillaPreview: preview,
        getBlockAt: () => 0,
        getFluidState: () => ({ empty: true, name: 'minecraft:empty' }),
        getCollisionBoxes: () => [],
        addEntity(entity) {
            if (entity.id === -2 || entity.id === undefined) entity.id = this.entities.length + 10;
            if (this.entities.some(existing => existing.id === entity.id)) this.removeEntityById(entity.id);
            this.entities.push(entity);
        },
        removeEntityById(id) { this.entities = this.entities.filter(entity => entity.id !== id); }
    };
    world.entities.push(player);
    const minecraft = {
        player,
        worldRenderer: {
            entityRenderManager: { createEntityRendererByEntity: () => ({}) }
        }
    };
    const mob = createMobEntity(minecraft, world, type, { x: 0, y: 64, z: 0 });
    const nextInt = mob.random.nextInt.bind(mob.random);
    mob.random.nextInt = bound => bound === 10 ? 0 : nextInt(bound);
    world.addEntity(mob);
    return { mob, player };
}

test('zombie acquires a valid nearby player, faces it and advances through collision physics', () => {
    const { mob, player } = makeMob();
    mob.onGround = true;
    mob.onLivingUpdate();
    assert.equal(mob.attackTarget, player);
    assert.equal(mob.moveForward, 0.23 * 0.98); // Mob.setSpeed supplies forward input, then LivingEntity damps it.
    assert.ok(Math.abs(mob.rotationYaw + 90) < 1e-9);
    assert.ok(Math.abs(mob.motionX) > 0);
    assert.equal(mob.flying, false);
});

test('undead use vanilla-style horizontal entity pushing without vertical impulses', () => {
    const { mob, player } = makeMob('zombie', makePlayer({ x: 4, y: 64, z: 0 }));
    const other = createMobEntity(mob.minecraft, mob.world, 'skeleton', { x: 0.2, y: 64, z: 0 });
    mob.world.addEntity(other);
    mob.pushOverlappingEntities();
    assert.ok(mob.motionX > 0, 'internal velocity moves first mob left');
    assert.ok(other.motionX < 0, 'internal velocity moves second mob right');
    assert.equal(mob.motionY, 0);
    assert.equal(other.motionY, 0);

    mob.motionX = other.motionX = 0;
    other.setPosition(8, 64, 0);
    mob.pushOverlappingEntities();
    assert.equal(mob.motionX, 0, 'non-overlapping entities receive no artificial push');
    assert.equal(other.motionX, 0);
});

test('hurt knockback moves real living entities away from the attacker, not toward it', () => {
    for (const [x, z] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2]]) {
        const { mob } = makeMob();
        mob.setPosition(x, 64, z);
        mob.onGround = true;
        applyKnockback(mob, { x: 0, z: 0 });
        const before = Math.hypot(mob.x, mob.z);
        mob.travel(0, 0, 0);
        assert.ok(Math.hypot(mob.x, mob.z) > before, 'actual movement increases distance');
        assert.equal(mob.y, 64.4, 'JAR grounded hurt lift is retained');
    }
});

test('overlapping mobs separate after actual movement without bouncing vertically or attracting', () => {
    const { mob } = makeMob();
    const other = createMobEntity(mob.minecraft, mob.world, 'skeleton', { x: .2, y: 64, z: .1 });
    mob.world.addEntity(other);
    const before = Math.hypot(other.x - mob.x, other.z - mob.z);
    mob.pushOverlappingEntities();
    const amount = Math.sqrt(.2);
    const expectedX = .2 / amount * .05000000074505806;
    assert.ok(Math.abs(mob.motionX - expectedX) < 1e-12, 'matches Entity.push absMax normalization');
    assert.equal(mob.motionY, 0); assert.equal(other.motionY, 0);
    mob.travel(0, 0, 0); other.travel(0, 0, 0);
    assert.ok(Math.hypot(other.x - mob.x, other.z - mob.z) > before);
    mob.motionX = other.motionX = mob.motionZ = other.motionZ = 0;
    other.setPosition(mob.x, mob.y, mob.z);
    mob.pushOverlappingEntities();
    assert.equal(mob.motionX, 0, 'coincident centers do not acquire an arbitrary impulse');
    assert.equal(other.motionZ, 0);
});

test('zombie attacks at melee range on a one-second cooldown and knocks the player back', () => {
    const { mob, player } = makeMob('zombie', makePlayer({ x: 1, y: 64, z: 0 }));
    mob.updateZombieAI();
    assert.equal(player.health, 17);
    assert.deepEqual(player.damageCalls, [{ amount: 3, attacker: 'zombie' }]);
    assert.equal(mob.attackCooldown, 20);
    assert.ok(player.motionX > 0);
    mob.updateZombieAI();
    assert.equal(player.health, 17);
    assert.equal(player.damageCalls.length, 1);
});

test('26.3 zombie reinforcements are hard-only, require accepted damage, and inherit the attacker target', () => {
    const { mob, player } = makeMob('zombie', makePlayer({ x: 1, y: 64, z: 0 }));
    mob.world.difficulty = 'normal';
    mob.reinforcementChance = 1;
    let chanceRolls = 0;
    mob.random.nextFloat = () => { chanceRolls++; return 0; };
    mob.damageEntity(1, 'player', 'mob attack', player);
    assert.equal(chanceRolls, 0, 'non-Hard damage must not roll the reinforcement chance');
    assert.equal(mob.world.entities.length, 2);

    mob.world.difficulty = 'hard';
    mob.invulnerableTime = 0;
    mob.reinforcementChance = 0;
    mob.damageEntity(1, 'player', 'mob attack', player);
    assert.equal(chanceRolls, 1, 'accepted Hard damage rolls once');
    assert.equal(mob.world.entities.length, 2, 'failed chance roll creates no mob');

    mob.invulnerableTime = 0;
    mob.reinforcementChance = 1;
    mob.world.mobCombatEnabled = true;
    const nativeAddEntity = mob.world.addEntity;
    const placements = [];
    mob.world.blockExists = () => true;
    mob.world.getBlockCollisionBoxesAt = (x, y, z) => {
        placements.push([x, y, z]);
        return x === 20 && y === 63 && z === 0
            ? [new BoundingBox(20, 63, 0, 21, 64, 1)] : [];
    };
    mob.world.getFluidState = () => ({ empty: true, name: 'minecraft:empty' });
    mob.world.getTotalLightAt = () => 0;
    mob.world.addEntity = entity => { nativeAddEntity.call(mob.world, entity); };
    const draws = [13, 2, 0, 1, 0, 1];
    mob.random.nextInt = () => draws.shift() ?? 0;
    mob.random.nextFloat = () => 0;
    mob.damageEntity(1, 'player', 'mob attack', player);

    const reinforcement = mob.world.entities.find(entity => entity !== player && entity !== mob);
    assert.ok(reinforcement);
    assert.equal(reinforcement.entityType, 'minecraft:zombie');
    assert.equal(reinforcement.attackTarget, player);
    assert.equal(reinforcement.reinforcementCalleeCharge, -0.05);
    assert.equal(mob.reinforcementCallerCharge, -0.05);
    assert.ok(placements.some(([x, y, z]) => x === 20 && y === 63 && z === 0));
});

test('zombie reinforcement placement never reads or spawns into an unloaded chunk', () => {
    const { mob, player } = makeMob('husk', makePlayer({ x: 1, y: 64, z: 0 }));
    mob.world.difficulty = 'hard';
    mob.world.mobCombatEnabled = true;
    mob.reinforcementChance = 1;
    mob.random.nextFloat = () => 0;
    mob.random.nextInt = bound => bound === 34 ? 13 : bound === 3 ? 2 : 0;
    let blockReads = 0;
    mob.world.blockExists = () => false;
    mob.world.getBlockCollisionBoxesAt = () => { blockReads++; return []; };
    mob.world.getFluidState = () => ({ empty: true });
    mob.invulnerableTime = 0;
    mob.damageEntity(1, 'player', 'mob attack', player);
    assert.equal(mob.world.entities.length, 2);
    assert.equal(blockReads, 0, 'unloaded candidate must be rejected before block-state lookups');
});

test('undead remain in their dying pose for the JAR 20 ticks, then are removed', () => {
    const { mob, player } = makeMob('skeleton');
    mob.health = 1;
    mob.invulnerableTime = 0;
    mob.damageEntity(40, player.username, 'arrow', player);
    assert.equal(mob.health, 0);
    assert.equal(mob.isDead, false, 'death starts before entity removal');
    assert.equal(mob.deathTime, 0);
    assert.equal(mob.damageEntity(20, player.username, 'arrow', player), 0, 'dying mobs cannot be damaged again');
    for (let i = 0; i < 19; i++) {
        mob.onLivingUpdate();
        assert.equal(mob.isDead, false);
    }
    mob.onLivingUpdate();
    assert.equal(mob.deathTime, 20);
    assert.equal(mob.isDead, true);
});

test('Drowned reinforcement uses the 26.3 water-at-feet-and-below placement rule', () => {
    const { mob, player } = makeMob('drowned', makePlayer({ x: 1, y: 64, z: 0 }));
    mob.world.difficulty = 'hard';
    mob.world.mobCombatEnabled = true;
    mob.reinforcementChance = 1;
    mob.world.blockExists = () => true;
    mob.world.getBlockCollisionBoxesAt = () => [];
    mob.world.getFluidState = (_x, y) => y === 63 || y === 64
        ? { empty: false, name: 'minecraft:water' }
        : { empty: true, name: 'minecraft:empty' };
    mob.world.getTotalLightAt = () => 0;
    mob.random.nextFloat = () => 0;
    const draws = [13, 2, 0, 1, 0, 1];
    mob.random.nextInt = () => draws.shift() ?? 0;
    mob.invulnerableTime = 0;
    mob.damageEntity(1, 'player', 'mob attack', player);
    const reinforcement = mob.world.entities.find(entity => entity !== player && entity !== mob);
    assert.ok(reinforcement);
    assert.equal(reinforcement.entityType, 'minecraft:drowned');
    assert.equal(reinforcement.reinforcementCalleeCharge, -0.05);
});

test('reinforcement spawn-light checks use separate sky/block light and the world RNG sequence', () => {
    const { mob, player } = makeMob('zombie', makePlayer({ x: 1, y: 64, z: 0 }));
    mob.world.difficulty = 'hard';
    mob.world.mobCombatEnabled = true;
    mob.reinforcementChance = 1;
    mob.world.blockExists = () => true;
    mob.world.getBlockCollisionBoxesAt = (x, y, z) =>
        x === 20 && y === 63 && z === 0 ? [new BoundingBox(20, 63, 0, 21, 64, 1)] : [];
    mob.world.getFluidState = () => ({ empty: true, name: 'minecraft:empty' });
    mob.world.getSavedLightValue = () => 0;
    mob.world.calculateSkylightSubtracted = () => 0;
    mob.world.getRawBrightness = () => 6;
    const lightDraws = [];
    mob.world.getGameplayRandom = () => ({
        nextInt(bound) { lightDraws.push(bound); return bound === 32 ? 31 : 7; }
    });
    const draws = [13, 2, 0, 1, 0, 1];
    mob.random.nextInt = () => draws.shift() ?? 0;
    mob.random.nextFloat = () => 0;
    mob.invulnerableTime = 0;
    mob.damageEntity(1, 'player', 'mob attack', player);
    assert.ok(mob.world.entities.some(entity => entity.entityType === 'minecraft:zombie'));
    assert.deepEqual(lightDraws, [32, 8], 'sky roll precedes the dimension light-test roll');

    const second = makeMob('zombie', makePlayer({ x: 1, y: 64, z: 0 }));
    second.mob.world.difficulty = 'hard';
    second.mob.world.mobCombatEnabled = true;
    second.mob.reinforcementChance = 1;
    second.mob.world.blockExists = () => true;
    second.mob.world.getBlockCollisionBoxesAt = (x, y, z) =>
        x === 20 && y === 63 && z === 0 ? [new BoundingBox(20, 63, 0, 21, 64, 1)] : [];
    second.mob.world.getFluidState = () => ({ empty: true, name: 'minecraft:empty' });
    second.mob.world.getSavedLightValue = (_layer) => _layer === 1 ? 1 : 0;
    const rejectedDraws = [];
    second.mob.world.getGameplayRandom = () => ({ nextInt(bound) { rejectedDraws.push(bound); return 31; } });
    const repeatedDraws = [13, 2, 0, 1, 0, 1];
    let repeatedIndex = 0;
    second.mob.random.nextInt = () => repeatedDraws[repeatedIndex++ % repeatedDraws.length];
    second.mob.random.nextFloat = () => 0;
    second.mob.invulnerableTime = 0;
    second.mob.damageEntity(1, 'player', 'mob attack', second.player);
    assert.equal(second.mob.world.entities.length, 2, 'positive block light above the Overworld limit rejects all candidates');
    assert.equal(rejectedDraws.length, 50, 'each structurally valid candidate consumes only the sky-light roll before block-light rejection');
    assert.ok(rejectedDraws.every(bound => bound === 32));
});

test('zombie door breaking follows the hard-only, mobGriefing, 240-tick JAR rules', () => {
    const { mob } = makeMob('zombie', makePlayer({ x: 12, y: 64, z: 0 }));
    assert.equal(mob.canBreakDoors, true);
    const restoredZombie = createMobEntity(mob.minecraft, mob.world, 'zombie', {
        x: 0, y: 64, z: 0, canBreakDoors: false
    });
    assert.equal(restoredZombie.canBreakDoors, false, 'serialized navigation state overrides the fresh-spawn default');
    mob.x = 0.5;
    mob.z = 0.5;
    const blocks = new Map([['1,64,0', 160], ['1,65,0', 161]]);
    mob.world.getBlockAt = (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 0;
    mob.world.getBlockDataAt = () => 0;
    mob.world.setBlockAt = (x, y, z, id) => {
        if (id) blocks.set(`${x},${y},${z}`, id);
        else blocks.delete(`${x},${y},${z}`);
    };
    mob.world.difficulty = 'normal';
    mob.collision = true;
    mob.navigationPath = [{ x: 0.5, y: 64, z: 0.5 }, { x: 1.5, y: 64, z: 0.5 }];
    mob.navigationIndex = 1;
    for (let i = 0; i < 250; i++) mob.updateDoorBreakingAI();
    assert.equal(mob.world.getBlockAt(1, 64, 0), 160, 'normal difficulty must not break doors');

    mob.world.difficulty = 'hard';
    mob.world.mobGriefing = false;
    for (let i = 0; i < 250; i++) mob.updateDoorBreakingAI();
    assert.equal(mob.world.getBlockAt(1, 64, 0), 160, 'mobGriefing=false must prevent breaking');

    mob.world.mobGriefing = true;
    mob.navigationPath = [{ x: 0.5, y: 64, z: 0.5 }, { x: 1.5, y: 64, z: 0.5 }];
    mob.navigationIndex = 1;
    for (let i = 0; i < 239; i++) assert.equal(mob.updateDoorBreakingAI(), true);
    assert.equal(mob.world.getBlockAt(1, 64, 0), 160);
    assert.equal(mob.updateDoorBreakingAI(), true);
    assert.equal(mob.world.getBlockAt(1, 64, 0), 0);
    assert.equal(mob.world.getBlockAt(1, 65, 0), 0);
});

test('26.3 zombie-family armor reduces ordinary hits but not magic damage', () => {
    const { mob } = makeMob('zombie', makePlayer({ creative: true }), false);
    assert.equal(mob.armor, 2);
    assert.equal(mob.damageEntity(10, 'tester'), 9.84);
    assert.ok(Math.abs(mob.health - 10.16) < 1e-9);
    mob.invulnerableTime = 0;
    assert.equal(mob.damageEntity(4, null, 'magic'), 4);
    assert.ok(Math.abs(mob.health - 6.16) < 1e-9);
    assert.equal(makeMob('skeleton').mob.armor, 0);

    const namedPlayer = makeMob('zombie', makePlayer({ username: 'wither' }), false).mob;
    assert.equal(namedPlayer.damageEntity(10, 'wither'), 9.84,
        'an attacker name that resembles a bypass damage type does not bypass armor');
});

test('undead melee range intersects JAR-expanded hitboxes instead of using a fixed radial cutoff', () => {
    const justInside = makeMob('zombie', makePlayer({ x: 1.4, y: 64, z: 0 }));
    justInside.mob.updateMobAI();
    assert.equal(justInside.player.health, 17, '26.3 expanded AABBs overlap at 1.4 blocks');

    const justOutside = makeMob('zombie', makePlayer({ x: 1.45, y: 64, z: 0 }));
    justOutside.mob.updateMobAI();
    assert.equal(justOutside.player.health, 20, 'the JAR default attack box ends before 1.45 blocks');

    const verticalOverlap = makeMob('zombie', makePlayer({ x: 1, y: 65.8, z: 0 }));
    verticalOverlap.mob.updateMobAI();
    assert.equal(verticalOverlap.player.health, 17, 'vertical overlap, not center-height delta, decides hit eligibility');
});

test('normal survival AI ignores creative/spectator players, while preview can demonstrate chasing', () => {
    const creative = makeMob('zombie', makePlayer({ creative: true }), false).mob;
    creative.updateZombieAI();
    assert.equal(creative.attackTarget, null);
    assert.equal(creative.moveForward, 0);

    const spectator = makeMob('zombie', makePlayer({ spectator: true }), false).mob;
    spectator.updateZombieAI();
    assert.equal(spectator.attackTarget, null);

    const previewSpectator = makeMob('zombie', makePlayer({ spectator: true }), true).mob;
    previewSpectator.updateZombieAI();
    assert.equal(previewSpectator.attackTarget, previewSpectator.minecraft.player);
    assert.equal(previewSpectator.moveForward, 0.23);
});

test('playable Vanillith obeys survival targeting rules and peaceful monster removal, not preview overrides', () => {
    for (const flag of ['creative', 'spectator']) {
        const { mob, player } = makeMob('zombie', makePlayer({ [flag]: true }), true);
        mob.world.vanillithPlayable = true;
        mob.updateMobAI();
        assert.equal(mob.attackTarget, null);
        mob.damageEntity(1, 'player', 'player attack', player);
        assert.equal(mob.attackTarget, null, 'HurtByTargetGoal cannot target invulnerable/spectating players');
    }
    const { mob } = makeMob();
    mob.world.vanillithPlayable = true;
    mob.world.difficulty = 'peaceful';
    mob.updateMobAI();
    assert.equal(mob.isDead, true);
});

test('undead immediately discard targets that die or switch to creative/spectator', () => {
    for (const invalidate of [player => { player.health = 0; }, player => { player.creative = true; }]) {
        const { mob, player } = makeMob('zombie', makePlayer({ x: 8, y: 64, z: 0 }), false);
        mob.updateMobAI();
        assert.equal(mob.attackTarget, player);
        assert.ok(mob.targetScanTicks > 0, 'the periodic acquisition scan is not yet due');
        invalidate(player);
        mob.updateMobAI();
        assert.equal(mob.attackTarget, null);
        assert.equal(mob.navigationPath, null);
    }
});

test('accepted player damage activates the JAR HurtByTarget goal even outside acquisition range', () => {
    const { mob, player } = makeMob('zombie', makePlayer({ username: 'tester', x: 40, y: 64, z: 0 }), false);
    mob.damageEntity(1, 'tester');
    assert.equal(mob.attackTarget, player);
    assert.equal(mob.lastHurtByPlayerName, 'tester');
    assert.equal(mob.lastHurtByPlayerTicks, 100);
    mob.updateMobAI();
    assert.equal(mob.attackTarget, null, 'the 35-block follow range still bounds pursuit');
});

test('HurtByTarget keeps the actual mob attacker as revenge target without granting player loot credit', () => {
    const { mob, player } = makeMob('zombie', makePlayer({ creative: true }), false);
    const attacker = createMobEntity(mob.minecraft, mob.world, 'skeleton', { x: 5, y: 64, z: 0 });
    mob.world.addEntity(attacker);
    assert.equal(mob.damageEntity(3, 'skeleton', 'mob_attack', attacker), 2.94);
    assert.equal(mob.attackTarget, attacker);
    assert.equal(mob.lastHurtByPlayerName, null);
    assert.equal(mob.lastHurtByPlayerTicks, 0);
    mob.updateMobAI();
    assert.equal(mob.attackTarget, attacker, 'the revenge target survives ordinary player-acquisition scans');
    assert.equal(player.health, 20);
});

test('zombie family variants use the same target/attack controller', () => {
    for (const type of ['husk', 'drowned']) {
        const { mob, player } = makeMob(type, makePlayer({ x: 1, y: 64, z: 0 }));
        if (type === 'drowned') {
            mob.hasTrident = false;
            mob.world.time = 13000;
        }
        mob.updateZombieAI();
        assert.equal(player.health, 17, type);
        assert.equal(mob.attackCooldown, 20, type);
        assert.equal(mob.stepHeight, type === 'drowned' ? 1 : 0.6, `${type} uses its JAR step height`);
    }
});

test('undead target acquisition uses the JAR mob follow range (35 zombie, 16 skeleton)', () => {
    const zombie = makeMob('zombie', makePlayer({ x: 20, y: 64, z: 0 }), false);
    zombie.mob.updateMobAI();
    assert.equal(zombie.mob.attackTarget, zombie.player);

    for (const type of ['skeleton', 'stray', 'wither_skeleton']) {
        const { mob, player } = makeMob(type, makePlayer({ x: 20, y: 64, z: 0 }), false);
        mob.updateMobAI();
        assert.equal(mob.attackTarget, null, `${type} inherits the 16-block Mob follow range`);
    }

    const drowned = makeMob('drowned', makePlayer({ x: 20, y: 64, z: 0 }), false);
    drowned.mob.world.time = 13000;
    drowned.mob.updateMobAI();
    assert.equal(drowned.mob.attackTarget, drowned.player, 'Drowned inherits Zombie follow range');
});

test('nearest-player acquisition rolls the JAR one-in-ten random interval each eligible tick', () => {
    const { mob, player } = makeMob('zombie', makePlayer(), false);
    let roll = 1;
    mob.random.nextInt = bound => bound === 10 ? roll : 0;
    mob.updateMobAI();
    assert.equal(mob.attackTarget, null, 'a failed JAR interval roll does not scan yet');
    roll = 0;
    mob.updateMobAI();
    assert.equal(mob.attackTarget, player, 'the next successful interval roll acquires the visible player');
});

test('skeleton and stray charge and fire damaging arrows; stray arrows carry JAR-duration slowness', () => {
    for (const type of ['skeleton', 'stray']) {
        const { mob, player } = makeMob(type, makePlayer({ x: 8, y: 64, z: 0 }));
        mob.world.difficulty = 'hard'; // keep the JAR spread narrow for a repeatable hit assertion
        for (let i = 0; i < 20; i++) mob.updateMobAI();
        const arrow = mob.world.entities.find(entity => entity.constructor.name === 'MobArrowEntity');
        assert.ok(arrow, `${type} creates an arrow`);
        assert.equal(arrow.owner, mob);
        assert.equal(arrow.damage, 2, 'JAR AbstractArrow base damage is two before impact-speed scaling');
        assert.equal(arrow.effect, type === 'stray' ? 'slowness' : null);
        assert.equal(mob.rangedSeeTime, 20, `${type} waits for stable line of sight before strafing`);
        assert.ok(Math.abs(mob.moveStrafing) > 0, `${type} strafes after settling inside bow range`);
        // Keep this damage/knockback assertion independent of the small random
        // inaccuracy roll; spread itself is exercised by projectile tests.
        arrow.motionX = 1.6;
        arrow.motionY = 0;
        arrow.motionZ = 0;
        const expectedDamage = Math.ceil(Math.hypot(arrow.motionX, arrow.motionY, arrow.motionZ) * arrow.damage);
        for (let i = 0; i < 10 && !arrow.isDead; i++) arrow.onEntityUpdate();
        assert.equal(player.damageCalls[0]?.amount, expectedDamage);
        assert.ok(player.motionX > 0, 'the JAR applies default projectile knockback along the arrow travel vector');
        assert.equal(player.health, 20 - player.damageCalls[0].amount);
        assert.equal(arrow.isDead, true, '26.3 discards an arrow after its accepted entity hit');
        if (type === 'stray') assert.equal(player.statusEffects.get('slowness')?.duration, 600);
    }
});

test('mob arrows remain embedded for the JAR 1200-tick despawn lifetime and release if their block changes', () => {
    const { mob } = makeMob('skeleton', makePlayer({ creative: true }), false);
    let blockId = 1;
    mob.world.getBlockAt = () => blockId;
    mob.world.getBlockDataAt = () => 0;
    const arrow = new MobArrowEntity(mob.minecraft, mob.world, mob,
        0, 64, 0, { x: 1, y: 0, z: 0 });
    arrow.embedInBlock(0, 64, 0);
    for (let i = 0; i < 1199; i++) arrow.onEntityUpdate();
    assert.equal(arrow.isDead, false);
    assert.equal(arrow.life, 1199);
    arrow.onEntityUpdate();
    assert.equal(arrow.isDead, true, 'AbstractArrow.tickDespawn removes at life >= 1200');

    const released = new MobArrowEntity(mob.minecraft, mob.world, mob,
        0, 64, 0, { x: 1, y: 0, z: 0 });
    released.embedInBlock(0, 64, 0);
    released.random.nextFloat = () => 0.5;
    blockId = 2;
    released.onEntityUpdate();
    assert.equal(released.inGround, false, 'changing the embedded block state releases the projectile');
    assert.ok(released.x > 0);
});

test('mob projectile sweeps choose the nearest hit and solid blocks occlude targets behind them', () => {
    const { mob, player } = makeMob('skeleton', makePlayer({ x: 3, y: 64, z: 0 }), false);
    const wall = new BoundingBox(2, 60, -1, 3, 70, 1);
    mob.world.getCollisionBoxes = () => [wall];
    mob.world.getBlockAt = () => 1;
    const blocked = new MobArrowEntity(mob.minecraft, mob.world, mob,
        0, 64.8, 0, { x: 3, y: 0, z: 0 });
    blocked.onEntityUpdate();
    assert.equal(player.health, 20, 'the ray stops at the solid block before reaching the target hitbox');
    assert.equal(blocked.inGround, true);
    assert.deepEqual(blocked.inGroundBlock, { x: 2, y: 64, z: 0, id: 1, data: 0 });

    const { mob: openMob, player: openPlayer } = makeMob('skeleton', makePlayer({ x: 3, y: 64, z: 0 }), false);
    const fastArrow = new MobArrowEntity(openMob.minecraft, openMob.world, openMob,
        0, 64.8, 0, { x: 6, y: 0, z: 0 });
    fastArrow.onEntityUpdate();
    assert.equal(openPlayer.health, 8, 'a fast projectile still hits a narrow target between its endpoints');
    assert.equal(fastArrow.isDead, true);
});

test('26.3 arrow water drag is 0.6 while thrown tridents retain their 0.99 water inertia', () => {
    for (const [kind, expectedX] of [['arrow', 0.6], ['trident', 0.99]]) {
        const { mob } = makeMob(kind === 'arrow' ? 'skeleton' : 'drowned', makePlayer({ creative: true }), false);
        mob.world.getFluidState = () => ({ empty: false, name: 'minecraft:water' });
        const projectile = new MobArrowEntity(mob.minecraft, mob.world, mob,
            0, 64, 0, { x: 1, y: 0, z: 0 }, null, { kind });
        projectile.onEntityUpdate();
        assert.ok(Math.abs(projectile.x - expectedX) < 1e-12, `${kind} water-step distance`);
        assert.ok(Math.abs(projectile.motionX - expectedX) < 1e-12, `${kind} JAR water inertia`);
    }
});

test('bow skeleton approaches first, then strafes backward at close range instead of using melee', () => {
    const { mob, player } = makeMob('skeleton', makePlayer({ x: 2, y: 64, z: 0 }));
    mob.updateMobAI();
    assert.equal(player.health, 20);
    assert.equal(mob.moveControlSpeedModifier, 1, 'approach uses the JAR goal speed modifier');
    assert.ok(mob.moveForward > 0, 'it closes until the target has been visible for 20 ticks');
    for (let tick = 1; tick < 20; tick++) mob.updateMobAI();
    assert.ok(mob.moveForward < 0, 'close-range strafing moves backward after the sighting threshold');
    assert.ok(Math.abs(mob.moveStrafing) > 0);
    assert.equal(mob.moveControlSpeedModifier, 0.25, 'MoveControl.strafe() uses its JAR quarter-speed modifier');
    assert.equal(mob.getAIMoveSpeed(), 0.25 * 0.25, 'skeleton movement attribute is scaled once by the strafe controller');
    assert.equal(player.health, 20, 'bow users do not swap to melee at point blank');
    assert.equal(mob.world.entities.some(entity => entity.constructor.name === 'MobArrowEntity'), true,
        'the bow goal still releases its charged shot');
});

test('26.3 bow-goal stop clears a partial draw when its target becomes invalid', () => {
    const { mob, player } = makeMob('skeleton', makePlayer({ x: 8, y: 64, z: 0 }));
    mob.updateMobAI();
    mob.rangedChargeTicks = 12;
    mob.rangedAttackCooldown = 7;
    mob.rangedSeeTime = 12;
    player.isDead = true;
    mob.updateMobAI();
    assert.equal(mob.attackTarget, null);
    assert.equal(mob.rangedChargeTicks, 0, 'stopUsingItem discards the in-progress draw');
    assert.equal(mob.rangedAttackCooldown, 0, 'RangedBowAttackGoal.stop resets attackTime to -1');
    assert.equal(mob.rangedSeeTime, 0);

    player.isDead = false;
    mob.updateMobAI();
    assert.equal(mob.rangedChargeTicks, 1, 'a newly acquired target starts a fresh bow draw');
    assert.equal(mob.world.entities.some(entity => entity.constructor.name === 'MobArrowEntity'), false,
        'a later target cannot inherit the previous target\'s partial charge');
});

test('melee and ranged undead do not attack through an obstructing block', () => {
    const { mob: melee, player } = makeMob('zombie', makePlayer({ x: 1, y: 64, z: 0 }));
    melee.world.rayTraceBlocks = () => ({ hit: true });
    melee.updateMobAI();
    assert.equal(player.health, 20);
    assert.equal(melee.attackTarget, null, 'line of sight is required at acquisition');

    const archer = makeMob('skeleton', makePlayer({ x: 8, y: 64, z: 0 })).mob;
    archer.world.rayTraceBlocks = () => ({ hit: true });
    for (let i = 0; i < 40; i++) archer.updateMobAI();
    assert.equal(archer.world.entities.some(entity => entity.constructor.name === 'MobArrowEntity'), false);
});

test('undead acquire only visible players and forget occluded targets after vanilla unseen memory', () => {
    const blocked = makeMob('zombie', makePlayer(), false).mob;
    blocked.world.rayTraceBlocks = () => ({ hit: true });
    blocked.updateMobAI();
    assert.equal(blocked.attackTarget, null, 'a target hidden at acquisition is not acquired');

    const { mob } = makeMob('zombie', makePlayer(), false);
    mob.updateMobAI();
    const target = mob.attackTarget;
    assert.ok(target);
    mob.world.rayTraceBlocks = () => ({ hit: true });
    for (let tick = 0; tick < 60; tick++) mob.updateMobAI();
    assert.equal(mob.attackTarget, target, 'pathfinding may route around cover during the 60-tick memory window');
    mob.updateMobAI();
    assert.equal(mob.attackTarget, null, 'the target is forgotten on the next unseen tick');
});

test('trident-equipped drowned attack dry players at range at night', () => {
    const { mob, player } = makeMob('drowned', makePlayer({ x: 4, y: 64, z: 0 }));
    mob.world.time = 13000;
    mob.world.difficulty = 'hard'; // vanilla uncertainty is difficulty-scaled
    mob.hasTrident = true;
    mob.isInWater = () => true;
    mob.updateMobAI();
    assert.equal(mob.world.entities.filter(entity => entity.projectileKind === 'trident').length, 0,
        'JAR RangedAttackGoal does not throw immediately at close range');
    for (let i = 0; i < 16; i++) mob.updateMobAI();
    const trident = mob.world.entities.find(entity => entity.projectileKind === 'trident');
    assert.ok(trident, 'first trident is thrown after range-scaled warmup');
    assert.equal(trident.damage, 8);
    for (let i = 0; i < 15; i++) mob.updateMobAI();
    assert.equal(mob.world.entities.filter(entity => entity.projectileKind === 'trident').length, 1);
    mob.updateMobAI();
    assert.equal(mob.world.entities.filter(entity => entity.projectileKind === 'trident').length, 2,
        'JAR RangedAttackGoal scales its 40-tick maximum interval by distance / 10');
    for (let i = 0; i < 10 && !trident.isDead; i++) trident.onEntityUpdate();
    assert.equal(player.health, 12);
    assert.ok(player.motionX > 0, 'trident damage also triggers LivingEntity default knockback');
    assert.equal(trident.isDead, false, 'ThrownTrident sets dealtDamage and continues instead of using AbstractArrow discard');
    assert.equal(player.damageCalls.length, 1, 'the dealtDamage flag prevents repeat hits while it continues');
});

test('26.3 trident-goal stop resets its distance-scaled attack timer before reacquiring', () => {
    const { mob, player } = makeMob('drowned', makePlayer({ x: 4, y: 64, z: 0 }), false);
    mob.hasTrident = true;
    mob.world.time = 13000;
    mob.attackTarget = player;
    mob.tridentAttackTime = 23;
    mob.tridentSeeTime = 4;
    player.isDead = true;
    mob.updateMobAI();
    assert.equal(mob.tridentAttackTime, -1, 'RangedAttackGoal.stop sets attackTime to -1');
    assert.equal(mob.tridentSeeTime, 0);

    player.isDead = false;
    mob.world.time = 20000;
    mob.updateMobAI();
    assert.equal(mob.tridentAttackTime, 16, 'the new target restarts at floor(distance / 10 * 40)');
    assert.equal(mob.world.entities.some(entity => entity.kind === 'trident'), false,
        'a new target cannot inherit the previous target\'s near-ready trident timer');
});

test('Drowned target filter follows the JAR: dry players are ignored in daylight, aquatic players are not', () => {
    const dry = makeMob('drowned', makePlayer({ x: 8, y: 64, z: 0 }), false);
    dry.mob.world.time = 6000;
    dry.mob.world.getLightBrightness = () => 1;
    dry.mob.updateMobAI();
    assert.equal(dry.mob.attackTarget, null);

    const aquatic = makeMob('drowned', makePlayer({ x: 8, y: 64, z: 0, isInWater: () => true }), false);
    aquatic.mob.world.time = 6000;
    aquatic.mob.world.getLightBrightness = () => 1;
    aquatic.mob.updateMobAI();
    assert.equal(aquatic.mob.attackTarget, aquatic.player);

    const night = makeMob('drowned', makePlayer({ x: 8, y: 64, z: 0 }), false);
    night.mob.world.time = 13000;
    night.mob.updateMobAI();
    assert.equal(night.mob.attackTarget, night.player);
});

test('Drowned day targeting uses the JAR world skyDarken threshold, including twilight', () => {
    const { mob, player } = makeMob('drowned', makePlayer({ x: 4, y: 64, z: 0 }), false);
    mob.world.time = 13000;
    mob.world.calculateSkylightSubtracted = () => 3;
    mob.updateMobAI();
    assert.equal(mob.attackTarget, null, 'a dry target is rejected while Level.isBrightOutside is true');

    mob.world.calculateSkylightSubtracted = () => 4;
    mob.updateMobAI();
    assert.equal(mob.attackTarget, player, 'at the skyDarken >= 4 twilight threshold, the dry target is allowed');
});

test('Drowned daytime water-seeking is persistent instead of rerolling the destination every tick', () => {
    const { mob } = makeMob('drowned', makePlayer({ creative: true }), false);
    let waterReads = 0;
    mob.world.getFluidState = (x, y, z) => {
        waterReads++;
        return x >= -1 && x <= 0 && z >= -1 && z <= 0 && y >= 64 && y <= 66
            ? { empty: true, name: 'minecraft:empty' }
            : { empty: false, name: 'minecraft:water' };
    };
    mob.world.time = 6000;
    mob.updateMobAI();
    const destination = mob.waterNavigationTarget;
    assert.ok(destination);
    assert.ok(waterReads >= 2);
    const readsAfterInitialSearch = waterReads;
    mob.updateMobAI();
    assert.equal(mob.waterNavigationTarget, destination);
    assert.equal(waterReads, readsAfterInitialSearch, 'the unchanged body shares its fluid contact within this tick');
});

test('Drowned retries the JAR water-position probe every tick when no water candidate exists', () => {
    const { mob } = makeMob('drowned', makePlayer({ creative: true }), false);
    mob.isInWater = () => false;
    mob.world.time = 6000;
    let waterProbeReads = 0;
    mob.world.getFluidState = () => {
        waterProbeReads++;
        return { empty: true, name: 'minecraft:empty' };
    };

    mob.updateMobAI();
    assert.equal(waterProbeReads, 10, 'DrownedGoToWaterGoal checks ten random candidate blocks');
    mob.updateMobAI();
    assert.equal(waterProbeReads, 20, 'failed goal eligibility is retried on the next selector tick');
});

test('Drowned below sea level swim upward at night while submerged', () => {
    const { mob } = makeMob('drowned', makePlayer({ creative: true }), false);
    mob.world.time = 13000;
    mob.world.getSeaLevel = () => 64;
    mob.isInWater = () => true;
    mob.setPosition(0, 50, 0);
    mob.onGround = false;
    mob.world.getFluidState = (_x, y) => y >= 40 && y <= 62
        ? { empty: false, name: 'minecraft:water' }
        : { empty: true, name: 'minecraft:empty' };
    mob.random.nextFloat = () => 0.5;
    mob.random.nextDouble = () => 0.25;
    const nextInt = mob.random.nextInt.bind(mob.random);
    mob.random.nextInt = bound => bound === 10 ? 0 : bound === 17 ? 8 : nextInt(bound);
    mob.updateMobAI();
    assert.deepEqual(mob.drownedSwimUpTarget, { x: 2.5, y: 50, z: 0.5 });
    assert.ok(mob.navigationPath?.length > 1, 'swim-up follows a stable amphibious path toward the sea surface');
    assert.equal(mob.moveForward, 0.23);
});

test('Drowned use the JAR night-time beach goal near the surface unless a combat target has priority', () => {
    const { mob, player } = makeMob('drowned', makePlayer({ creative: true }), false);
    mob.world.time = 13000;
    mob.world.getSeaLevel = () => 64;
    mob.isInWater = () => true;
    mob.world.getHeightAt = x => x === 2 ? 65 : 64;
    mob.world.getCollisionBoxes = region => region.minX >= 2 && region.maxX <= 3 && region.minY >= 64.7 && region.minY < 65
        ? [{ minX: 2, maxX: 3, minY: 64, maxY: 65, minZ: 0, maxZ: 1 }]
        : [];
    mob.navigateTo = target => { mob.lastNavigationTarget = target; };
    mob.updateMobAI();
    assert.deepEqual(mob.beachNavigationTarget, { x: 2.5, y: 65, z: 0.5 });
    assert.equal(mob.lastNavigationTarget, mob.beachNavigationTarget);

    mob.beachNavigationTarget = null;
    mob.attackTarget = player;
    assert.equal(mob.updateDrownedEnvironmentAI(), false);
    assert.equal(mob.beachNavigationTarget, null, 'the lower-priority beach goal yields to combat');
});

test('Drowned beach goal priority wins over swim-up at the sea-level-minus-three boundary', () => {
    const { mob } = makeMob('drowned', makePlayer({ creative: true }), false);
    mob.world.time = 13000;
    mob.world.getSeaLevel = () => 64;
    mob.isInWater = () => true;
    mob.setPosition(0, 61, 0);
    mob.world.getHeightAt = x => x === 2 ? 63 : 64;
    mob.world.getCollisionBoxes = region => region.minX >= 2 && region.maxX <= 3 &&
        region.minY >= 62.75 && region.minY < 63
        ? [{ minX: 2, maxX: 3, minY: 62, maxY: 63, minZ: 0, maxZ: 1 }]
        : [];
    mob.navigateTo = target => { mob.lastNavigationTarget = target; };

    assert.equal(mob.updateDrownedEnvironmentAI(), true);
    assert.deepEqual(mob.beachNavigationTarget, { x: 2.5, y: 63, z: 0.5 });
    assert.equal(mob.lastNavigationTarget, mob.beachNavigationTarget);
    assert.equal(mob.drownedSearchingForLand, false);
});

test('Drowned refresh amphibious routes while swimming even without ground contact', () => {
    const { mob } = makeMob('drowned', makePlayer({ x: 6, y: 64, z: 0 }), false);
    mob.isInWater = () => true;
    mob.onGround = false;
    mob.world.getFluidState = (x, y, z) => x >= -1 && x <= 7 && z >= -2 && z <= 2 && y >= 64 && y <= 66
        ? { empty: false, name: 'minecraft:water' }
        : { empty: true, name: 'minecraft:empty' };
    mob.navigateTo(mob.attackTarget ?? mob.minecraft.player);
    assert.ok(mob.navigationPath?.length > 1);
    assert.equal(mob.navigationTargetCell, '6,64,0');
});

test('Drowned swim upward to elevated route waypoints instead of requiring ground contact', () => {
    const { mob } = makeMob('drowned', makePlayer({ x: 0, y: 68, z: 0 }), false);
    mob.isInWater = () => true;
    mob.onGround = false;
    mob.world.getFluidState = (_x, y) => y >= 64 && y <= 72
        ? { empty: false, name: 'minecraft:water' }
        : { empty: true, name: 'minecraft:empty' };
    mob.navigateTo(mob.minecraft.player);
    assert.ok(mob.navigationPath?.some(point => point.y > mob.y));
    assert.equal(mob.jumping, true, 'upward swim input does not depend on the grounded jump flag');
});

test('Drowned submerged swim control steers toward its waypoint with vanilla buoyancy and drag', () => {
    const { mob, player } = makeMob('drowned', makePlayer({
        x: 6, y: 68, z: 0,
        isInWater: () => true
    }), false);
    mob.isEyeInWater = () => true;
    mob.attackTarget = player;
    mob.navigationPath = [{ x: 0, y: 64, z: 0 }, { x: 4, y: 68, z: 0 }];
    mob.navigationIndex = 1;
    mob.motionX = mob.motionY = mob.motionZ = 0;

    mob.travelInWater(0, 0, 0);

    assert.ok(mob.motionX > 0, 'move control adds horizontal acceleration toward the path point');
    assert.ok(mob.motionY > 0, 'vertical path steering and target-level buoyancy move upward');
    assert.ok(mob.motionX < 0.01, 'horizontal acceleration is damped by the JAR 0.9 water drag');
    const steeringSpeed = 0.125 * 0.23;
    const expectedVertical = (0.002 + steeringSpeed * (4 / Math.hypot(4, 4)) * 0.1) * 0.9;
    assert.ok(Math.abs(mob.motionY - expectedVertical) < 1e-12,
        'submerged movement has no generic water gravity and preserves the JAR vertical steering constant');
});

test('Drowned use ordinary water drag when they do not want to swim', () => {
    const { mob } = makeMob('drowned', makePlayer({ creative: true }), false);
    mob.isEyeInWater = () => true;
    mob.motionX = 0.1;
    mob.motionY = 0.1;
    mob.motionZ = 0;
    mob.drownedControlSpeed = 0.2;
    mob.travelInWater(0, 0, 0);
    assert.ok(Math.abs(mob.motionX - .1 * Math.fround(.8)) < 1e-12);
    assert.ok(Math.abs(mob.motionY - (.1 * Math.fround(.8) - .08 / 16)) < 1e-12);
    assert.equal(mob.drownedControlSpeed, 0, 'non-swimming MoveControl resets its previous speed');
});

test('native resolver short-name water fluid activates undead water movement instead of land physics', () => {
    const { mob } = makeMob('zombie');
    mob.world.getBlockAt = () => 0; // Native preview state IDs do not equal legacy BlockRegistry IDs.
    mob.world.getFluidState = () => ({ name: 'water', empty: false, level: 0 });
    mob.onGround = false;
    mob.motionX = mob.motionY = mob.motionZ = 0;

    assert.equal(mob.isInWater(), true);
    mob.moveEntityWithHeading(0, 0, 0);
    assert.ok(Math.abs(mob.motionY + .08 / 16) < 1e-12,
        '26.3 water branch applies gravity/16, not the legacy -0.02 term');
});

test('native lava state routes mobs through 26.3 lava drag instead of land or water movement', () => {
    const { mob } = makeMob('zombie');
    mob.world.getBlockAt = () => 0;
    mob.world.getFluidState = () => ({ name: 'lava', empty: false, level: 0 });
    mob.onGround = false;
    mob.motionX = 0.2;
    mob.motionY = 0.1;
    mob.motionZ = 0;

    assert.equal(mob.isInLava(), true);
    mob.moveEntityWithHeading(0, 0, 0);
    assert.ok(Math.abs(mob.motionX - 0.1) < 1e-12, 'deep-lava horizontal velocity is halved');
    assert.ok(Math.abs(mob.motionY - 0.03) < 1e-12, 'deep-lava velocity is halved before quarter-gravity');
});

test('player water detection reads native fluid state IDs for travel and eye-submersion checks', () => {
    const minecraft = { worldRenderer: { camera: { position: { x: 0.5, y: 65.62, z: 0.5 } } } };
    const world = {
        minecraft,
        getFluidState: () => ({ name: 'water', empty: false, level: 0 }),
        getBlockAt: () => 0, // Deliberately not the legacy Water block ID.
        getCollisionBoxes: () => []
    };
    minecraft.world = world;
    const player = new PlayerEntity(minecraft, world, 1);
    player.setPositionAndRotation(0.5, 64, 0.5, 0, 0);
    player.onGround = false;

    assert.equal(player.isInWater(), true);
    assert.equal(player.isHeadInWater(), true);
    player.moveEntityWithHeading(0, 0, 0);
    assert.ok(Math.abs(player.motionY + .08 / 16) < 1e-12, 'player takes the 26.3 native water-travel branch');
});

test('player native lava detection dispatches to distinct 26.3 lava travel physics', () => {
    const minecraft = { worldRenderer: { camera: { position: { x: 0.5, y: 65.62, z: 0.5 } } } };
    const world = {
        minecraft,
        getFluidState: () => ({ name: 'minecraft:lava', empty: false, level: 0 }),
        getBlockAt: () => 0,
        getCollisionBoxes: () => []
    };
    minecraft.world = world;
    const player = new PlayerEntity(minecraft, world, 1);
    player.setPositionAndRotation(0.5, 64, 0.5, 0, 0);
    player.onGround = false;
    player.creative = true;
    player.motionX = 0.2;
    player.motionY = 0.1;
    player.motionZ = 0;

    assert.equal(player.isInLava(), true);
    player.moveEntityWithHeading(0, 0, 0);
    assert.ok(Math.abs(player.motionX - 0.1) < 1e-12, 'lava has its own stronger horizontal drag');
    assert.ok(Math.abs(player.motionY - 0.03) < 1e-12, 'lava uses deep-fluid buoyancy/gravity');
});

test('zombies and husks convert after the JAR water-affliction and conversion timers; Drowned do not reconvert', () => {
    for (const [sourceType, convertedType] of [['zombie', 'minecraft:drowned'], ['husk', 'minecraft:zombie']]) {
        const { mob } = makeMob(sourceType, makePlayer({ creative: true }), false);
        mob.world.getFluidState = () => ({ empty: false, name: 'minecraft:water' });
        for (let tick = 0; tick < 600; tick++) mob.tickWaterConversion();
        assert.equal(mob.world.entities[1], mob, `${sourceType} remains during the 600-tick affliction phase`);
        assert.equal(mob.waterConversionTicks, 300);
        for (let tick = 0; tick < 300; tick++) mob.tickWaterConversion();
        assert.equal(mob.world.entities[1], mob, `${sourceType} remains through the final conversion tick`);
        mob.tickWaterConversion();
        const converted = mob.world.entities.find(entity => entity.entityType);
        assert.equal(converted.entityType, convertedType);
        assert.equal(converted.id, mob.id, 'replacement preserves the entity id');
        assert.equal(mob.isDead, true);
    }

    const { mob } = makeMob('drowned', makePlayer({ creative: true }), false);
    mob.world.getFluidState = () => ({ empty: false, name: 'minecraft:water' });
    for (let tick = 0; tick < 1000; tick++) mob.tickWaterConversion();
    assert.equal(mob.world.entities.includes(mob), true);
});

test('skeleton conversion tracks 140 powder-snow ticks, then the JAR 300-tick Stray countdown', () => {
    const { mob } = makeMob('skeleton', makePlayer({ creative: true }), false);
    assert.equal(mob.damageEntity(1, null, 'freeze'), 0, 'Skeleton.canFreeze() rejects powder-snow freeze damage in the JAR');
    assert.equal(mob.health, 20);
    let powderSnow = true;
    mob.world.isInPowderSnow = () => powderSnow;
    for (let tick = 0; tick < 139; tick++) mob.tickFreezeConversion();
    assert.equal(mob.freezeConversionTicks, -1, 'affliction must persist for 140 ticks before conversion begins');
    mob.tickFreezeConversion();
    assert.equal(mob.freezeConversionTicks, 300);
    for (let tick = 0; tick < 300; tick++) mob.tickFreezeConversion();
    assert.equal(mob.isDead, false, 'the conversion countdown completes after it reaches below zero');
    mob.tickFreezeConversion();
    const stray = mob.world.entities.find(entity => entity.entityType === 'minecraft:stray');
    assert.ok(stray, 'a powder-snow Skeleton converts to Stray');
    assert.equal(stray.id, mob.id, 'conversion preserves the entity identity');
    assert.equal(stray.health, mob.health, 'conversion carries current health');
    assert.equal(mob.isDead, true);

    const { mob: interrupted } = makeMob('skeleton', makePlayer({ creative: true }), false);
    let inSnow = true;
    interrupted.world.isInPowderSnow = () => inSnow;
    for (let tick = 0; tick < 80; tick++) interrupted.tickFreezeConversion();
    inSnow = false;
    interrupted.tickFreezeConversion();
    assert.equal(interrupted.freezeAfflictionTicks, -1, 'leaving powder snow resets accumulated affliction');
    inSnow = true;
    interrupted.tickFreezeConversion();
    assert.equal(interrupted.freezeAfflictionTicks, 0);
});

test('Vanillith native chunk lookup recognizes powder snow anywhere in a mob hitbox', () => {
    const world = Object.create(VanillaPreviewWorld.prototype);
    world.nativeChunks = { getBlockState: (x, y, z) => x === 0 && y === 65 && z === 0 ? 30519 : 0 };
    const { mob } = makeMob('skeleton', makePlayer({ creative: true }), false);
    assert.equal(world.isInPowderSnow(mob), true);
    world.nativeChunks.getBlockState = () => 0;
    assert.equal(world.isInPowderSnow(mob), false);
});

test('leaving eye-level water resets the zombie conversion timer', () => {
    const { mob } = makeMob('zombie', makePlayer({ creative: true }), false);
    let submerged = true;
    mob.world.getFluidState = () => submerged
        ? { empty: false, name: 'minecraft:water' }
        : { empty: true, name: 'minecraft:empty' };
    for (let tick = 0; tick < 599; tick++) mob.tickWaterConversion();
    submerged = false;
    mob.tickWaterConversion();
    assert.equal(mob.waterAfflictionTicks, 0);
    assert.equal(mob.waterConversionTicks, -1);
    submerged = true;
    for (let tick = 0; tick < 600; tick++) mob.tickWaterConversion();
    assert.equal(mob.world.entities.includes(mob), true);
});

test('zombie-to-Drowned conversion carries health and recent player kill credit', () => {
    const { mob } = makeMob('zombie', makePlayer({ username: 'tester', creative: true }), false);
    mob.damageEntity(3, 'tester');
    mob.world.getFluidState = () => ({ empty: false, name: 'minecraft:water' });
    for (let tick = 0; tick < 901; tick++) mob.tickWaterConversion();
    const drowned = mob.world.entities.find(entity => entity.entityType === 'minecraft:drowned');
    assert.ok(drowned);
    assert.ok(Math.abs(drowned.health - 17.06) < 1e-9);
    assert.equal(drowned.lastHurtByPlayerName, 'tester');
    assert.equal(drowned.lastHurtByPlayerTicks, 100);
});

test('husk applies hunger and wither skeleton applies wither only after accepted melee damage', () => {
    const husk = makeMob('husk', makePlayer({ x: 1, y: 64, z: 0 })).mob;
    husk.updateMobAI();
    assert.equal(husk.attackTarget.statusEffects.get('hunger')?.duration, 140,
        'normal day-zero effective difficulty 1.5 is truncated to 1 by the JAR');

    const witherSkeleton = makeMob('wither_skeleton', makePlayer({ x: 1, y: 64, z: 0 })).mob;
    witherSkeleton.updateMobAI();
    assert.equal(witherSkeleton.attackTarget.health, 12, 'base 4 plus the stone sword modifier deals 8 damage');
    assert.equal(witherSkeleton.attackTarget.damageCalls[0].amount, 8);
    assert.equal(witherSkeleton.attackTarget.statusEffects.get('wither')?.duration, 200);
    assert.equal(witherSkeleton.world.entities.some(entity => entity.constructor.name === 'MobArrowEntity'), false);
    assert.equal(witherSkeleton.addStatusEffect('wither', 200), false, 'Wither Skeleton is immune to Wither');

    const hardHusk = makeMob('husk', makePlayer({ x: 1, y: 64, z: 0 })).mob;
    hardHusk.world.difficulty = 'hard';
    hardHusk.updateMobAI();
    assert.equal(hardHusk.attackTarget.statusEffects.get('hunger')?.duration, 280,
        'the JAR converts effective difficulty to int before multiplying by 140');
    const easyHusk = makeMob('husk', makePlayer({ x: 1, y: 64, z: 0 })).mob;
    easyHusk.world.difficulty = 'easy';
    easyHusk.updateMobAI();
    assert.equal(easyHusk.attackTarget.statusEffects?.get('hunger'), undefined,
        'an initial easy effective difficulty below 1 truncates to a zero-tick effect');

    const progressedHusk = makeMob('husk', makePlayer({ x: 1, y: 64, z: 0 })).mob;
    progressedHusk.world.worldAgeTicks = 1512000;
    progressedHusk.world.inhabitedTimeTicks = 3600000;
    progressedHusk.world.moonBrightness = 1;
    progressedHusk.updateMobAI();
    assert.equal(progressedHusk.attackTarget.statusEffects.get('hunger')?.duration, 560,
        'normal difficulty reaches effective difficulty 4 at maximum world/local progress');
});

test('burning empty-handed Zombie melee ignites its target with JAR chance and duration', () => {
    const { mob: zombie } = makeMob('zombie', makePlayer({ x: 20 }), false);
    const target = createMobEntity(zombie.minecraft, zombie.world, 'skeleton', { x: 1, y: 64, z: 0 });
    zombie.world.addEntity(target);
    zombie.attackTarget = target;
    zombie.world.effectiveDifficulty = 3.7;
    zombie.fireTicks = 100;
    zombie.random.nextFloat = () => 0.899;
    zombie.updateMobAI();
    assert.equal(target.fireTicks, 120, '2 * floor(3.7) seconds becomes 120 fire ticks');
    const afterMeleeHealth = target.health;

    for (let tick = 0; tick < 21; tick++) target.onUpdate();
    assert.equal(target.health, afterMeleeHealth - 1,
        'the first burn tick is suppressed by the melee damage immunity window; the next 20-tick boundary applies damage');
    assert.equal(target.fireTicks, 99);

    const { mob: drowned } = makeMob('drowned', makePlayer({ x: 20 }), false);
    const armedTarget = createMobEntity(drowned.minecraft, drowned.world, 'skeleton', { x: 1, y: 64, z: 0 });
    drowned.world.addEntity(armedTarget);
    drowned.attackTarget = armedTarget;
    drowned.drownedWeapon = 'trident';
    drowned.fireTicks = 100;
    drowned.random.nextFloat = () => 0;
    drowned.updateMobAI();
    assert.equal(armedTarget.fireTicks, 0, 'the Zombie fire-hit bonus requires an empty main hand');
});

test('undead reject poison/regeneration and invert instant healing and damage', () => {
    const { mob: zombie } = makeMob('zombie', makePlayer({ creative: true }), false);
    zombie.health = 10;
    assert.equal(zombie.addStatusEffect('poison', 200), false);
    assert.equal(zombie.addStatusEffect('regeneration', 200), false);
    assert.equal(zombie.addStatusEffect('instant_health', 1), true);
    assert.equal(zombie.health, 6, 'instant health deals four magic damage to undead');
    assert.equal(zombie.statusEffects.has('instant_health'), false, 'instant effects are applied immediately');
    assert.equal(zombie.addStatusEffect('instant_damage', 1, 1), true);
    assert.equal(zombie.health, 18, 'amplifier I instant damage heals twelve health');
    zombie.health = 19;
    zombie.addStatusEffect('instant_damage', 1);
    assert.equal(zombie.health, 20, 'instant healing clamps to max health');

    const witherSkeleton = makeMob('wither_skeleton', makePlayer({ creative: true }), false).mob;
    witherSkeleton.health = 10;
    assert.equal(witherSkeleton.addStatusEffect('instant_health', 1), true);
    assert.equal(witherSkeleton.health, 6);
    assert.equal(witherSkeleton.addStatusEffect('wither', 200), false);
});

test('Wither Skeleton rejects fire-tagged damage while ordinary Zombie still burns', () => {
    const witherSkeleton = makeMob('wither_skeleton', makePlayer({ creative: true }), false).mob;
    assert.equal(witherSkeleton.damageEntity(8, null, 'lava'), 0);
    assert.equal(witherSkeleton.damageEntity(8, null, 'on fire'), 0);
    assert.equal(witherSkeleton.damageEntity(8, null, 'minecraft:sulfur_cube_hot'), 0);
    assert.equal(witherSkeleton.health, 20);

    const zombie = makeMob('zombie', makePlayer({ creative: true }), false).mob;
    assert.equal(zombie.damageEntity(8, null, 'lava'), 7.872, 'lava is fire but does not bypass the JAR armor tag');
    assert.equal(zombie.health, 12.128);
});

test('sun-sensitive zombie/skeleton variants ignite in bright daytime; husk/drowned/wither skeleton do not', () => {
    for (const type of ['zombie', 'skeleton', 'stray', 'husk', 'drowned', 'wither_skeleton']) {
        const { mob } = makeMob(type, makePlayer({ creative: true }), false);
        mob.world.time = 6000;
        mob.world.getLightBrightness = () => 1;
        mob.random.nextFloat = () => 0;
        mob.ticksExisted = 1;
        mob.updateMobAI();
        assert.equal(mob.fireTicks > 0, ['zombie', 'skeleton', 'stray'].includes(type), type);
    }
    const { mob: previewZombie } = makeMob('zombie', makePlayer({ creative: true }), true);
    previewZombie.world.time = 6000;
    previewZombie.world.getLightBrightness = () => 1;
    previewZombie.random.nextFloat = () => 0;
    previewZombie.updateMobAI();
    assert.ok(previewZombie.fireTicks > 0, 'preview combat entities retain vanilla sunlight behavior');
    const witherSkeleton = makeMob('wither_skeleton', makePlayer({ creative: true }), false).mob;
    witherSkeleton.fireTicks = 100;
    witherSkeleton.ticksExisted = 20;
    witherSkeleton.updateDaylightBurning();
    assert.equal(witherSkeleton.fireTicks, 0);
    assert.equal(witherSkeleton.health, 20, 'Wither Skeleton fire immunity prevents burn damage');
});

test('26.3 sun burning uses the light-scaled random roll and is suppressed by water, rain or blocked sky', () => {
    const makeExposed = () => {
        const { mob } = makeMob('zombie', makePlayer({ creative: true }), false);
        mob.world.time = 6000;
        mob.world.getLightBrightness = () => 0.6;
        mob.world.getHeightAt = () => 0;
        mob.random.nextFloat = () => 0.02; // 0.6*30 > (0.6-0.4)*2; no burn.
        return mob;
    };
    const dim = makeExposed();
    dim.updateDaylightBurning();
    assert.equal(dim.fireTicks, 0);

    const lit = makeExposed();
    lit.random.nextFloat = () => 0.01;
    lit.updateDaylightBurning();
    assert.equal(lit.fireTicks, 160);

    for (const suppress of [
        mob => { mob.world.raining = true; },
        mob => { mob.world.getFluidState = () => ({ empty: false, name: 'minecraft:water' }); },
        mob => { mob.world.getHeightAt = () => 100; }
    ]) {
        const mob = makeExposed();
        suppress(mob);
        mob.random.nextFloat = () => { throw new Error('sunburn roll must be skipped when exposure is blocked'); };
        mob.updateDaylightBurning();
        assert.equal(mob.fireTicks, 0);
    }
});

test('zombies, skeletons and strays flee into shade while burning, but combat and non-sun-sensitive variants do not', () => {
    for (const type of ['zombie', 'skeleton', 'stray']) {
        const { mob } = makeMob(type, makePlayer({ creative: true }), false);
        mob.world.time = 6000;
        mob.world.getLightBrightness = () => 1;
        mob.world.getHeightAt = (x, _z) => x === 0 ? 64 : 80;
        mob.world.getCollisionBoxes = () => [new BoundingBox(-100, 63, -100, 100, 64, 100)];
        mob.onGround = true;
        mob.collision = true;
        mob.random.nextInt = bound => bound === 6 ? 3 : bound === 10 ? 0 : 14; // first FleeSunGoal offset is (4, 0, 4)
        mob.random.nextFloat = () => 0; // ensure the stochastic JAR sunburn tick ignites.
        mob.updateMobAI();
        assert.deepEqual(mob.sunHideTarget, { x: 4.5, y: 64, z: 4.5 }, type);
        assert.equal(mob.navigationTargetCell, '4,64,4', `${type} routes to the selected shaded block`);
    }

    const combat = makeMob('zombie', makePlayer(), false).mob;
    combat.world.time = 6000;
    combat.world.getLightBrightness = () => 1;
    combat.world.getHeightAt = () => 64;
    combat.updateMobAI();
    assert.ok(combat.attackTarget, 'a live combat target suppresses FleeSunGoal');
    assert.equal(combat.sunHideTarget, null);

    for (const type of ['husk', 'drowned', 'wither_skeleton']) {
        const mob = makeMob(type, makePlayer({ creative: true }), false).mob;
        mob.world.time = 6000;
        mob.world.getLightBrightness = () => 1;
        mob.world.getHeightAt = () => 64;
        mob.updateMobAI();
        assert.equal(mob.sunHideTarget, null, type);
    }
});

test('untargeted mobs wander on a stable per-spawn random sequence', () => {
    const first = makeMob('zombie', makePlayer({ creative: true }), false).mob;
    const second = makeMob('zombie', makePlayer({ creative: true }), false).mob;
    const floor = [];
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
        floor.push(new BoundingBox(x, 63, z, x + 1, 64, z + 1));
    }
    for (const mob of [first, second]) {
        mob.world.getCollisionBoxes = region => floor.filter(box =>
            box.maxX > region.minX && box.minX < region.maxX && box.maxY > region.minY && box.minY < region.maxY &&
            box.maxZ > region.minZ && box.minZ < region.maxZ);
        mob.onGround = true;
        mob.collision = true;
        const nextInt = mob.random.nextInt.bind(mob.random);
        mob.random.nextInt = bound => bound === 10 || bound === 120 ? 0
            : bound === 21 ? 12 : bound === 15 ? 7 : nextInt(bound);
    }
    const a = [], b = [];
    for (let i = 0; i < 140; i++) {
        first.updateMobAI(); second.updateMobAI();
        a.push([first.moveForward, first.rotationYaw]);
        b.push([second.moveForward, second.rotationYaw]);
    }
    assert.deepEqual(a, b);
    assert.ok(a.some(([forward]) => forward > 0));
});

test('Vanillith playable mode keeps the selected survival controls active while streaming chunks', () => {
    const player = { spectator: false, creative: false, flying: true, x: 0, z: 0, isDead: false, onUpdate() {} };
    const world = Object.assign(Object.create(VanillaPreviewWorld.prototype), {
        minecraft: { player, loadingScreen: null, settings: {} },
        entities: [player], mobCombatEnabled: true, vanillithPlayable: true, gameMode: 'survival', cloudOffset: 0, animationTick: 0,
        clouds: { position: {}, material: { color: { setRGB() {} } } }, cloudTexture: { offset: {} },
        time: 6000, worldAgeTicks: 0, inhabitedTimeByChunk: new Map(), moonBrightness: 1,
        scheduledBlockTicks: new Map(), minecraftSingleplayer: true,
        chunkProvider: { requestStreamingDemand() {} }
    });
    world.minecraft.isSingleplayer = () => true;
    world.onTick();
    assert.equal(player.spectator, false);
    assert.equal(player.flying, false);
    assert.equal(world.time, 6001);
    assert.equal(world.worldAgeTicks, 1);
    assert.equal(world.getInhabitedTimeAt(0, 0), 1);
    assert.equal(world.getMoonBrightness(), 1);
    player.x = 16;
    world.onTick();
    assert.equal(player.spectator, false);
    assert.equal(player.flying, false);
    assert.equal(world.getInhabitedTimeAt(0, 0), 1);
    assert.equal(world.getInhabitedTimeAt(16, 0), 1);
});

test('Vanillith stroll malus mirrors native fire-neighbour and walkable-floor path types', () => {
    const ids = new Map(blockStates.states.map(state => [state.name, state.id]));
    const world = Object.assign(Object.create(VanillaPreviewWorld.prototype), {
        nativeChunks: { getBlockState(x, y, z) {
            if (y === 63) return ids.get('minecraft:stone');
            if (y !== 64) return ids.get('minecraft:air');
            if (x === 0 && z === 0) return ids.get('minecraft:air');
            if (x === 1 && z === 0) return ids.get('minecraft:fire');
            return ids.get('minecraft:air');
        } },
        nativeFluidStateCache: new Map()
    });
    assert.equal(world.getPathfindingMalusAt(0, 64, 0), 8,
        'WalkNodeEvaluator assigns FIRE_IN_NEIGHBOR a non-zero malus');
    world.nativeChunks.getBlockState = (x, y) => y === 63 ? ids.get('minecraft:stone') : ids.get('minecraft:air');
    assert.equal(world.getPathfindingMalusAt(0, 64, 0), 0,
        'an open node over ordinary ground remains a zero-malus WALKABLE node');
});

test('world entity ticks use a stable snapshot and remove dead mobs without skipping survivors', () => {
    const first = { id: 1, isDead: false, onUpdate() { this.isDead = true; } };
    const second = { id: 2, isDead: false, ticks: 0, onUpdate() { this.ticks++; } };
    const world = Object.assign(Object.create(World.prototype), {
        minecraft: { player: null, isSingleplayer: () => false, worldRenderer: { rebuildAll() {} } },
        entities: [first, second], scheduledBlockTicks: new Map(), time: 6000, skylightSubtracted: 0, cloudOffset: 0,
        clouds: { position: {}, material: { color: { setRGB() {} } } }, cloudTexture: { offset: {} },
        blockEntities: new Map(), removeEntityById(id) { this.entities = this.entities.filter(entity => entity.id !== id); }
    });
    world.onTick();
    assert.deepEqual(world.entities, [second]);
    assert.equal(second.ticks, 1);
});

test('mob loot preserves stack counts and applies a short pickup delay', () => {
    const player = makePlayer({ username: 'tester', x: 0, y: 64, z: 0 });
    const { mob, player: actualPlayer } = makeMob('zombie', player, false);
    mob.random.nextInt = max => max - 1;
    mob.random.nextFloat = () => 0.99;
    mob.damageEntity(25, 'tester');

    const drops = mob.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.equal(drops.length, 1);
    assert.equal(drops[0].blockId, BlockRegistry.ITEM_ROTTEN_FLESH.getId());
    assert.equal(drops[0].itemCount, 2);
    assert.equal(drops[0].pickupDelayTicks, 10);
    assert.equal(actualPlayer.health, 20);
});

test('26.3 Looting increases undead drop counts and rare-drop chances; item enchantments survive inventory sync', () => {
    const inventory = new InventoryPlayer();
    const sword = new ItemStack(BlockRegistry.ITEM_IRON.getId(), 1);
    sword.setEnchantmentLevel('minecraft:looting', 1);
    inventory.setItemInSelectedSlot(sword);
    const replica = new InventoryPlayer();
    replica.applyNetworkState(inventory.toNetworkState());
    assert.equal(replica.getItemInSelectedSlot().getEnchantmentLevel('looting'), 1);

    const skeleton = makeMob('skeleton', makePlayer({ username: 'tester' }), false);
    skeleton.player.inventory = replica;
    skeleton.mob.random.nextInt = () => 0; // zero base arrow/bone rolls
    skeleton.mob.random.nextFloat = () => 0.99; // Looting's uniform addition rounds up to one
    skeleton.mob.damageEntity(25, 'tester', 'player_attack', skeleton.player);
    const skeletonDrops = skeleton.mob.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.deepEqual(skeletonDrops.map(entity => [entity.blockId, entity.itemCount]).sort((a, b) => a[0] - b[0]),
        [[BlockRegistry.ITEM_ARROW.getId(), 1], [BlockRegistry.ITEM_BONE.getId(), 1]].sort((a, b) => a[0] - b[0]));

    const zombie = makeMob('zombie', makePlayer({ username: 'tester' }), false);
    const lootingStack = new ItemStack(BlockRegistry.ITEM_IRON.getId(), 1);
    lootingStack.setEnchantmentLevel('looting', 1);
    zombie.player.inventory = { getItemInSelectedSlot: () => lootingStack };
    zombie.mob.random.nextInt = max => max - 1; // flesh=2, rare item=potato
    zombie.mob.random.nextFloat = () => 0.03; // above 2.5%, below Looting-I's 3.5%
    zombie.mob.damageEntity(25, 'tester', 'player_attack', zombie.player);
    assert.ok(zombie.mob.world.entities.some(entity => entity.constructor.name === 'ItemEntity' &&
        entity.blockId === BlockRegistry.ITEM_POTATO.getId()), 'Looting I raises zombie rare-drop chance to 3.5%');

    const smeltingZombie = makeMob('husk', makePlayer({ username: 'tester' }), false);
    const fireAspectSword = new ItemStack(BlockRegistry.ITEM_IRON.getId(), 1);
    fireAspectSword.setEnchantmentLevel('fire_aspect', 1);
    smeltingZombie.player.inventory = { getItemInSelectedSlot: () => fireAspectSword };
    smeltingZombie.mob.random.nextInt = max => max - 1; // flesh=2, rare pool selects potato
    smeltingZombie.mob.random.nextFloat = () => 0;
    smeltingZombie.mob.damageEntity(25, 'tester', 'player_attack', smeltingZombie.player);
    assert.ok(smeltingZombie.mob.world.entities.some(entity => entity.constructor.name === 'ItemEntity' &&
        entity.blockId === BlockRegistry.ITEM_BAKED_POTATO.getId()),
    'the JAR smelts zombie-family potato loot when the direct attacker has Fire Aspect');
});

test('mob drop item sprites are present in both the asset manifest and vanilla texture pack', () => {
    for (const texture of ['rotten_flesh.png', 'bone.png', 'arrow.png', 'copper_ingot.png',
        'carrot.png', 'potato.png', 'baked_potato.png', 'tipped_arrow_base.png', 'tipped_arrow_head.png']) {
        assert.ok(atlasItemTextures.includes(texture), `${texture} is included in the item atlas`);
        assert.ok(existsSync(resolve('src/resources/terrain/pack/minecraft/textures/items', texture)),
            `${texture} exists in the pinned texture pack`);
    }
    assert.deepEqual(BlockRegistry.ITEM_TIPPED_ARROW.getTextureLayers(),
        ['tipped_arrow_base', 'tipped_arrow_head'], 'Stray tipped arrows use the JAR two-layer generated-item sprite');
    assert.ok(uiTextures.includes('entities/mobs/wither_skeleton.png'),
        'the skull model skin is loaded as a standalone nearest-filtered model texture');
    assert.equal(BlockRegistry.ITEM_WITHER_SKELETON_SKULL.modelTexture, 'entities/mobs/wither_skeleton.png');
    assert.ok(existsSync(resolve('src/resources/entities/mobs/wither_skeleton.png')),
        'the wither skull uses the same pinned skin as its matching mob model');
});

test('player-killed strays drop a tipped arrow and fire-cooked zombie rare drops use baked potatoes', () => {
    const stray = makeMob('stray', makePlayer({ username: 'tester' }), false).mob;
    stray.random.nextInt = max => max - 1;
    stray.random.nextFloat = () => 0;
    stray.damageEntity(20, 'tester');
    const strayDrops = stray.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.ok(strayDrops.some(drop => drop.blockId === BlockRegistry.ITEM_TIPPED_ARROW.getId()));
    assert.ok(strayDrops.some(drop => drop.blockId === BlockRegistry.ITEM_TIPPED_ARROW.getId() && drop.itemCount === 1));

    const zombie = makeMob('zombie', makePlayer({ username: 'tester' }), false).mob;
    zombie.random.nextInt = max => max - 1; // rare pool selects potato
    zombie.random.nextFloat = () => 0; // trigger the player-only rare drop
    zombie.fireTicks = 40;
    zombie.damageEntity(25, 'tester');
    const zombieDrops = zombie.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.ok(zombieDrops.some(drop => drop.blockId === BlockRegistry.ITEM_BAKED_POTATO.getId()));
});

test('mob kills never satisfy the JAR killed_by_player loot condition when a username matches the mob type', () => {
    const { mob, player } = makeMob('zombie', makePlayer({ username: 'skeleton' }), false);
    const attacker = createMobEntity(mob.minecraft, mob.world, 'skeleton', { x: 2, y: 64, z: 0 });
    mob.world.addEntity(attacker);
    mob.random.nextInt = max => max - 1;
    mob.random.nextFloat = () => 0;
    mob.damageEntity(25, 'skeleton', 'mob_attack', attacker);
    const drops = mob.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.deepEqual(drops.map(drop => drop.blockId), [BlockRegistry.ITEM_ROTTEN_FLESH.getId()]);
    assert.equal(mob.lastHurtByPlayerTicks, 0);
    assert.equal(player.health, 20);
});

test('Drowned, skeleton and Wither Skeleton use their distinct JAR loot pools', () => {
    const drowned = makeMob('drowned', makePlayer({ username: 'tester' }), false).mob;
    drowned.random.nextInt = max => max - 1;
    drowned.random.nextFloat = () => 0;
    drowned.damageEntity(25, 'tester');
    const drownedDrops = drowned.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.ok(drownedDrops.some(drop => drop.blockId === BlockRegistry.ITEM_ROTTEN_FLESH.getId() && drop.itemCount === 2));
    assert.ok(drownedDrops.some(drop => drop.blockId === BlockRegistry.ITEM_COPPER_INGOT.getId()));

    const skeleton = makeMob('skeleton', makePlayer({ username: 'tester' }), false).mob;
    skeleton.random.nextInt = max => max - 1;
    skeleton.random.nextFloat = () => 0.99;
    skeleton.damageEntity(20, 'tester');
    const skeletonDrops = skeleton.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.ok(skeletonDrops.some(drop => drop.blockId === BlockRegistry.ITEM_ARROW.getId() && drop.itemCount === 2));
    assert.ok(skeletonDrops.some(drop => drop.blockId === BlockRegistry.ITEM_BONE.getId() && drop.itemCount === 2));

    const wither = makeMob('wither_skeleton', makePlayer({ username: 'tester' }), false).mob;
    wither.random.nextInt = max => max - 1;
    wither.random.nextFloat = () => 0;
    wither.damageEntity(20, 'tester');
    const witherDrops = wither.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.ok(witherDrops.some(drop => drop.blockId === BlockRegistry.ITEM_COAL.getId()));
    assert.ok(witherDrops.some(drop => drop.blockId === BlockRegistry.ITEM_WITHER_SKELETON_SKULL.getId()));
});

test('Drowned loot cannot roll the Zombie/Husk iron, carrot or potato rare pool', () => {
    const drowned = makeMob('drowned', makePlayer({ username: 'tester' }), false).mob;
    drowned.random.nextInt = max => max - 1;
    drowned.random.nextFloat = () => 0; // would trigger a zombie rare roll if incorrectly shared
    drowned.damageEntity(25, 'tester');
    const drops = drowned.world.entities.filter(entity => entity.constructor.name === 'ItemEntity');
    assert.deepEqual(drops.map(item => item.blockId), [BlockRegistry.ITEM_ROTTEN_FLESH.getId(), BlockRegistry.ITEM_COPPER_INGOT.getId()]);
});

test('recent player damage retains JAR kill credit when fire deals the lethal hit', () => {
    const { mob } = makeMob('zombie', makePlayer({ username: 'tester' }), false);
    mob.random.nextInt = max => max - 1; // rare pool chooses potato
    mob.random.nextFloat = () => 0; // trigger player-only rare drop
    mob.damageEntity(1, 'tester');
    assert.equal(mob.lastHurtByPlayerTicks, 100);
    mob.health = 1;
    mob.invulnerableTime = 0;
    mob.damageEntity(2, null, 'on fire');
    assert.ok(mob.world.entities.some(entity => entity.constructor.name === 'ItemEntity' &&
        entity.blockId === BlockRegistry.ITEM_POTATO.getId()));
});
