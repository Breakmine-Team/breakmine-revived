import EntityLiving from './EntityLiving.js';
import MathHelper from '../../util/MathHelper.js';
import BoundingBox from '../../util/BoundingBox.js';
import { BlockRegistry } from '../world/block/BlockRegistry.js';
import { applyKnockback, damageAfterArmor } from '../../../../../../packages/vanilla-gameplay/combat.mjs';
import MobArrowEntity from './MobArrowEntity.js';
import ItemEntity from './ItemEntity.js';
import ExperienceOrbEntity from './ExperienceOrbEntity.js';
import { findMobPath, isMobStableDestination } from './MobNavigation.js';
import { splitExperienceOrbValues } from '../../../../../../packages/vanilla-gameplay/experience.mjs';
import EnumSkyBlock from '../../util/EnumSkyBlock.js';
import { isFluidType } from '../../../../../../packages/vanilla-worldgen/fluid-state.mjs';
import { entityFluidDepth, travelInWater, travelInLava, pointInFluid } from '../../../../../../packages/vanilla-gameplay/movement.mjs';

const ARMOR_BYPASS_DAMAGE_NAMES = new Set([
    'on fire', 'in wall', 'cramming', 'drown', 'drowning', 'fly into wall',
    'generic', 'wither', 'dragon breath', 'starve', 'starvation', 'fall',
    'ender pearl', 'freeze', 'stalagmite', 'magic', 'indirect magic',
    'out of world', 'void', 'generic kill', 'sonic boom', 'outside border'
]);
const FIRE_DAMAGE_NAMES = new Set([
    'in fire', 'campfire', 'on fire', 'lava', 'hot floor', 'sulfur cube hot',
    'unattributed fireball', 'fireball'
]);

function normalizeDamageName(name) {
    return String(name ?? '').toLowerCase().replace(/^minecraft:/, '').replaceAll('_', ' ');
}

function getLootingLevel(attacker) {
    const stack = attacker?.inventory?.getItemInSelectedSlot?.() ?? attacker?.getMainHandItem?.() ?? attacker?.mainHandItem;
    const level = stack?.getEnchantmentLevel?.('minecraft:looting') ??
        stack?.enchantments?.['minecraft:looting'] ?? stack?.enchantments?.looting ?? stack?.lootingLevel ?? 0;
    return Number.isFinite(Number(level)) ? Math.max(0, Math.floor(Number(level))) : 0;
}

function hasSmeltsLootEnchantment(attacker) {
    const stack = attacker?.inventory?.getItemInSelectedSlot?.() ?? attacker?.getMainHandItem?.() ?? attacker?.mainHandItem;
    const level = stack?.getEnchantmentLevel?.('minecraft:fire_aspect') ??
        stack?.enchantments?.['minecraft:fire_aspect'] ?? stack?.enchantments?.fire_aspect ?? 0;
    return Number.isFinite(Number(level)) && Number(level) > 0;
}

/** Controller for the undead mobs supported by Vanillith. */
export default class MobEntity extends EntityLiving {
    static name = 'MobEntity';

    constructor(minecraft, world, id, type, x, y, z) {
        super(minecraft, world, id);
        const definition = MOB_ENTITY_TYPES[type];
        if (!definition) throw new Error(`Unsupported mob entity type: ${type}`);
        this.entityType = type;
        this.mobFamily = definition.family;
        // Zombie.finalizeSpawn enables door-capable ground navigation for new
        // spawns; callers restoring saved state can override this explicitly.
        this.canBreakDoors = definition.family === 'zombie';
        this.doorBreakPosition = null;
        this.doorBreakTicks = 0;
        this.width = definition.width;
        this.height = definition.height;
        this.health = definition.health;
        this.armor = definition.armor ?? 0;
        this.armorToughness = definition.armorToughness ?? 0;
        this.fireImmune = type === 'minecraft:wither_skeleton';
        this.fireTicks = 0;
        // Drowned.createAttributes in the reference client overrides STEP_HEIGHT to 1.0 for
        // amphibious travel; the other supported adult mobs keep the default.
        this.stepHeight = type === 'minecraft:drowned' ? 1.0 : 0.6;
        this.flying = false;
        this.jumpMovementFactor = 0.02;
        this.moveForward = 0;
        this.moveStrafing = 0;
        // MoveControl keeps a separate speed modifier from the movement
        // inputs. In the reference client, STRAFE uses 0.25 even though its forward/sideways
        // inputs are each +/-0.5.
        this.moveControlSpeedModifier = 1.0;
        this.jumping = false;
        this.attackTarget = null;
        this.targetScanTicks = 0;
        this.targetUnseenTicks = 0;
        this.attackCooldown = 0;
        this.rangedChargeTicks = 0;
        this.rangedAttackCooldown = 0;
        this.tridentAttackTime = -1;
        this.rangedSeeTime = 0;
        this.tridentSeeTime = 0;
        this.rangedStrafingTime = -1;
        this.rangedStrafingClockwise = false;
        this.rangedStrafingBackwards = false;
        this.navigationPath = null;
        this.navigationIndex = 1;
        this.navigationTargetCell = null;
        this.navigationRepathTicks = 0;
        this.sunHideTarget = null;
        this.setPositionAndRotation(x, y, z, 0, 0);
        const seedText = `${type}:${Math.floor(x * 31)}:${Math.floor(y * 17)}:${Math.floor(z * 13)}`;
        let seed = world?.seed ?? 0;
        for (let i = 0; i < seedText.length; i++) seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
        this.random.setSeed(seed);
        this.hasTrident = false;
        this.drownedWeapon = null;
        if (type === 'minecraft:drowned' && this.random.nextFloat() > 0.9) {
            this.drownedWeapon = this.random.nextInt(16) < 10 ? 'trident' : 'fishing_rod';
            this.hasTrident = this.drownedWeapon === 'trident';
        }
        this.heldWeaponTexture = type === 'minecraft:skeleton' || type === 'minecraft:stray'
            ? 'bow'
            : type === 'minecraft:wither_skeleton' ? 'stone_sword'
                : type === 'minecraft:drowned' ? this.drownedWeapon : null;
        this.swimAmount = 0;
        this.prevSwimAmount = 0;
        this.wanderNavigationTarget = null;
        this.waterNavigationTarget = null;
        this.beachSearchCooldown = 0;
        this.beachNavigationTarget = null;
        this.drownedSearchingForLand = false;
        this.drownedSwimUpTarget = null;
        this.drownedControlSpeed = 0;
        this.waterAfflictionTicks = 0;
        this.waterConversionTicks = -1;
        this.freezeAfflictionTicks = 0;
        this.freezeConversionTicks = -1;
        this.lootDropped = false;
        this.deathTime = 0;
        this.prevDeathTime = 0;
        this.lastHurtByPlayerName = null;
        this.lastHurtByPlayerTicks = 0;
        this.lastDamageLootingLevel = 0;
        this.lastDamageSmeltsLoot = false;
        // Zombie.randomizeReinforcementsChance() in the reference client assigns nextDouble()
        // * 0.1 when spawn attributes are finalized. Keep the caller/callee
        // charges separately because vanilla stores them as additive modifiers.
        this.reinforcementChance = this.mobFamily === 'zombie' ? this.random.nextDouble() * 0.1 : 0;
        this.reinforcementCallerCharge = 0;
        this.reinforcementCalleeCharge = 0;
    }

    onLivingUpdate() {
        if (this.health <= 0) {
            this.prevDeathTime = this.deathTime;
            if (++this.deathTime >= 20) this.isDead = true;
            return;
        }
        this.updateMobAI();
        // Skeleton.tick updates its ConversionTracker before the base skeleton
        // tick; sample powder snow at the same pre-movement point.
        this.tickFreezeConversion();
        super.onLivingUpdate();
        this.prevSwimAmount = this.swimAmount;
        const visuallySwimming = this.entityType === 'minecraft:drowned' && this.isEyeInWater() &&
            (this.drownedSearchingForLand || this.attackTarget?.isInWater?.());
        this.swimAmount = Math.max(0, Math.min(1, this.swimAmount + (visuallySwimming ? 0.09 : -0.09)));
        this.pushOverlappingEntities();
        if (this.lastHurtByPlayerTicks > 0 && --this.lastHurtByPlayerTicks === 0) {
            this.lastHurtByPlayerName = null;
        }
        this.tickWaterConversion();
    }

    pushOverlappingEntities() {
        if (!this.boundingBox || this.isDead || this.health <= 0) return;
        const entities = new Set([this.minecraft?.player, ...(this.world?.entities ?? [])]);
        for (const other of entities) {
            if (!other || other === this || other.isDead || other.health <= 0 || other.spectator ||
                other.noPhysics || other.collidable === false || !other.boundingBox) continue;
            const a = this.boundingBox, b = other.boundingBox;
            if (!(a.minY < b.maxY && a.maxY > b.minY && a.minX < b.maxX && a.maxX > b.minX &&
                a.minZ < b.maxZ && a.maxZ > b.minZ)) continue;

            const dx = other.x - this.x, dz = other.z - this.z;
            // Entity.push uses sqrt(absMax(dx,dz)), not Euclidean distance.
            // Vanilla deliberately ignores coincident/nearly coincident centers.
            const maximum = Math.max(Math.abs(dx), Math.abs(dz));
            if (maximum < .009999999776482582) continue;
            const distance = Math.sqrt(maximum);
            const strength = Math.min(1, 1 / distance) * .05000000074505806;
            const pushX = dx / distance * strength;
            const pushZ = dz / distance * strength;
            this.motionX -= this.horizontalMotionSign * pushX;
            this.motionZ -= this.horizontalMotionSign * pushZ;
            const sign = other.horizontalMotionSign ?? 1;
            if (Number.isFinite(other.motionX)) other.motionX += sign * pushX;
            if (Number.isFinite(other.motionZ)) other.motionZ += sign * pushZ;
        }
    }

    onAcceptedDamage(attackerName, attackerEntity = null) {
        const attacker = attackerEntity ?? [this.minecraft?.player, ...(this.world?.entities ?? [])].find(entity =>
            entity && (entity === this.minecraft?.player || /Player/.test(entity.constructor?.name)) &&
            (entity.username === attackerName || entity.name === attackerName));
        this.lastDamageLootingLevel = getLootingLevel(attacker);
        this.lastDamageSmeltsLoot = hasSmeltsLootEnchantment(attacker);
        if (!attacker) return;
        const isPlayer = attacker === this.minecraft?.player || /Player/.test(attacker.constructor?.name);
        if (isPlayer) {
            this.lastHurtByPlayerName = attacker.username ?? attacker.name ?? attackerName;
            this.lastHurtByPlayerTicks = 100;
        }
        // reference HurtByTargetGoal retaliates against the actual attacking living
        // entity, not only named players. Keep the player-only loot credit
        // separate from the general revenge target.
        if (typeof attacker.damageEntity === 'function' && !attacker.isDead && attacker.health > 0 &&
            (!isPlayer || !attacker.creative && !attacker.spectator ||
                this.world?.vanillaPreview && !this.world.vanillithPlayable)) {
            this.attackTarget = attacker;
            this.targetUnseenTicks = 0;
            this.targetScanTicks = 10;
            this.trySpawnReinforcement(attacker);
        }
    }

    trySpawnReinforcement(attacker) {
        const world = this.world;
        if (this.mobFamily !== 'zombie' || !attacker || world?.difficulty !== 'hard' ||
            world.mobSpawning === false || world.doMobSpawning === false ||
            world.vanillaPreview && world.mobCombatEnabled === false ||
            typeof world.addEntity !== 'function') return null;

        // hurtServer consumes the chance roll only on Hard with a living target,
        // after the hit has already been accepted by the superclass.
        const chance = this.reinforcementChance + this.reinforcementCallerCharge + this.reinforcementCalleeCharge;
        if (this.random.nextFloat() >= chance) return null;

        const originX = Math.floor(this.x), originY = Math.floor(this.y), originZ = Math.floor(this.z);
        // Zombie.hurtServer creates one instance before its 50-position loop,
        // then repositions that same entity for every candidate.
        const reinforcement = createMobEntity(this.minecraft, world, this.entityType, {
            x: this.x, y: this.y, z: this.z, reinforcementCallee: true
        });
        if (!reinforcement) return null;
        const livingEntities = [this.minecraft?.player, ...(world.entities ?? [])]
            .filter((entity, index, list) => entity && list.indexOf(entity) === index &&
                typeof entity.damageEntity === 'function' && !entity.isDead && !entity.spectator && entity.health > 0);
        const intersects = (a, b) => a.minX < b.maxX && a.maxX > b.minX &&
            a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
        const spawnRandom = world.getGameplayRandom?.() ?? world.random ?? this.random;
        const blockRules = (x, y, z) => world.getSpawnBlockRulesAt?.(x, y, z) ?? null;
        const canOccupySpawnBlock = (x, y, z) => {
            const rules = blockRules(x, y, z);
            if (rules) return !rules.collisionFullBlock && rules.fluidEmpty;
            const fluid = world.getFluidState?.(x, y, z);
            return (!fluid || fluid.empty) && !(world.getBlockCollisionBoxesAt?.(x, y, z) ?? []).some(box =>
                box.minX <= x && box.maxX >= x + 1 && box.minY <= y && box.maxY >= y + 1 &&
                box.minZ <= z && box.maxZ >= z + 1);
        };
        const isDarkEnoughToSpawn = (x, y, z) => {
            if (typeof world.getSavedLightValue !== 'function') {
                const combined = world.getTotalLightAt?.(x, y, z);
                return !Number.isFinite(combined) || combined <= 7;
            }
            const skyLight = world.getSavedLightValue(EnumSkyBlock.SKY, x, y, z);
            // Monster.isDarkEnoughToSpawn first compares sky light to a
            // random 0..31 value, then checks block light against the
            // dimension's monsterSpawnBlockLightLimit (0 in the Overworld).
            if (skyLight > spawnRandom.nextInt(32)) return false;
            const blockLight = world.getSavedLightValue(EnumSkyBlock.BLOCK, x, y, z);
            if (blockLight > (world.monsterSpawnBlockLightLimit ?? 0)) return false;
            const skyDarken = world.calculateSkylightSubtracted?.(1.0) ?? world.skylightSubtracted ?? 0;
            const rawBrightness = world.getRawBrightness?.(x, y, z, skyDarken) ??
                Math.max(blockLight, Math.max(0, skyLight - skyDarken));
            const allowedRawBrightness = world.sampleMonsterSpawnLightTest?.(spawnRandom) ?? spawnRandom.nextInt(8);
            return rawBrightness <= allowedRawBrightness;
        };

        for (let attempt = 0; attempt < 50; attempt++) {
            const coordinate = origin => origin + (7 + this.random.nextInt(34)) * (this.random.nextInt(3) - 1);
            const x = coordinate(originX), y = coordinate(originY), z = coordinate(originZ);
            reinforcement.setPosition(x, y, z);
            const box = reinforcement.boundingBox;
            const minX = Math.floor(box.minX), maxX = Math.floor(box.maxX - 1e-7);
            const minY = Math.floor(box.minY), maxY = Math.floor(box.maxY - 1e-7);
            const minZ = Math.floor(box.minZ), maxZ = Math.floor(box.maxZ - 1e-7);

            // Never force-load terrain from combat. Reinforcement placement only
            // consults blocks, fluids and light in already-present chunks.
            let loaded = true;
            for (let bx = minX; bx <= maxX && loaded; bx++) {
                for (let bz = minZ; bz <= maxZ; bz++) {
                    if (typeof world.blockExists === 'function') {
                        for (let by = minY - 1; by <= maxY + 1; by++) {
                            if (!world.blockExists(bx, by, bz)) { loaded = false; break; }
                        }
                    } else if (typeof world.chunkExists === 'function' && !world.chunkExists(bx >> 4, bz >> 4)) {
                        loaded = false;
                    }
                }
            }
            if (!loaded) continue;

            // Zombie/Husk reinforcement placement needs solid ground. Drowned's
            // reference placement predicate instead requires water at feet and below;
            // reinforcement spawn reason bypasses its extra biome/depth rarity.
            const drowned = this.entityType === 'minecraft:drowned';
            if (drowned) {
                const atFeet = world.getFluidState?.(Math.floor(x), Math.floor(y), Math.floor(z));
                const below = world.getFluidState?.(Math.floor(x), Math.floor(y) - 1, Math.floor(z));
                if (!isFluidType(atFeet, 'water') || !isFluidType(below, 'water')) continue;
                const above = blockRules(Math.floor(x), Math.floor(y) + 1, Math.floor(z));
                if (above?.sturdyUp) continue;
            } else {
                const supportY = Math.floor(y) - 1;
                const support = blockRules(Math.floor(x), supportY, Math.floor(z));
                if (support ? !support.sturdyUp : !(world.getBlockCollisionBoxesAt?.(Math.floor(x), supportY, Math.floor(z)) ?? [])
                    .some(shape => shape.maxY >= y - 0.05 && shape.minY < y &&
                        shape.maxX > box.minX && shape.minX < box.maxX && shape.maxZ > box.minZ && shape.minZ < box.maxZ)) continue;
                if (!canOccupySpawnBlock(Math.floor(x), Math.floor(y), Math.floor(z)) ||
                    !canOccupySpawnBlock(Math.floor(x), Math.floor(y) + 1, Math.floor(z))) continue;
            }

            // SpawnPlacements.checkSpawnRules runs before nearby-player and
            // collision rejection, and owns its light RNG draws in ServerLevel.
            if (!isDarkEnoughToSpawn(Math.floor(x), Math.floor(y), Math.floor(z))) continue;
            const nearbyPlayer = livingEntities.some(entity =>
                (entity === this.minecraft?.player || /Player/.test(entity.constructor?.name)) &&
                (entity.x - x) ** 2 + (entity.y - y) ** 2 + (entity.z - z) ** 2 < 49);
            if (nearbyPlayer) continue;

            let obstructed = false, inLiquid = false;
            for (let bx = minX; bx <= maxX && !obstructed; bx++) {
                for (let by = minY; by <= maxY && !obstructed; by++) {
                    for (let bz = minZ; bz <= maxZ; bz++) {
                        const fluid = world.getFluidState?.(bx, by, bz);
                        if (fluid && !fluid.empty && !drowned) {
                            inLiquid = true;
                            break;
                        }
                        const shapes = world.getBlockCollisionBoxesAt?.(bx, by, bz) ?? [];
                        if (shapes.some(shape => intersects(shape, box))) { obstructed = true; break; }
                    }
                }
            }
            if (obstructed || inLiquid) continue;

            reinforcement.attackTarget = attacker;
            reinforcement.targetScanTicks = 10;
            world.addEntity?.(reinforcement);
            this.reinforcementCallerCharge -= 0.05;
            return reinforcement;
        }
        return null;
    }

    damageEntity(amount, attackerName, cause = null, attackerEntity = null) {
        if (this.health <= 0) return 0;
        // These match the vanilla damage-type bypasses relevant to supported
        // mobs. Normal melee, arrows, tridents and explosions still use armor.
        const damageName = normalizeDamageName(cause);
        if (this.fireImmune && FIRE_DAMAGE_NAMES.has(damageName)) return 0;
        // Skeleton.canFreeze() explicitly returns false in the reference client. Powder snow
        // still advances its Stray conversion tracker, but freeze damage itself
        // must not hurt the skeleton.
        if (this.entityType === 'minecraft:skeleton' && damageName === 'freeze') return 0;
        if (!ARMOR_BYPASS_DAMAGE_NAMES.has(damageName)) {
            amount = damageAfterArmor(amount, this.armor, this.armorToughness);
        }
        return super.damageEntity(amount, attackerName, cause, attackerEntity);
    }

    updateMobAI() {
        this.moveForward = 0;
        this.moveStrafing = 0;
        this.moveControlSpeedModifier = 1.0;
        this.jumping = false;
        if (this.world?.difficulty === 'peaceful' && this.world?.vanillithPlayable) {
            this.isDead = true;
            this.attackTarget = null;
            return;
        }
        if (this.attackCooldown > 0) this.attackCooldown--;
        this.updateDaylightBurning();
        if (this.isDead) return;
        if (this.updateDoorBreakingAI()) return;

        const localPlayer = this.minecraft?.player;
        const players = [...new Set([localPlayer, ...(this.world?.entities ?? [])])]
            .filter(entity => entity && (entity === localPlayer || /Player/.test(entity.constructor?.name)));
        const isValidTarget = candidate => {
            const previewSpectator = this.world?.vanillaPreview && !this.world.vanillithPlayable && candidate?.spectator;
            const isPlayer = candidate === localPlayer || /Player/.test(candidate?.constructor?.name);
            const drownedRejectsDryDayTarget = this.entityType === 'minecraft:drowned' &&
                isPlayer && this.isBrightOutside() && !candidate?.isInWater?.();
            return candidate && candidate !== this && typeof candidate.damageEntity === 'function' &&
                !candidate.isDead && candidate.health > 0 &&
                (!isPlayer || !candidate.creative && !candidate.spectator || previewSpectator) && !drownedRejectsDryDayTarget;
        };
        let validTarget = isValidTarget(this.attackTarget) ? this.attackTarget : null;
        // Target goals stop as soon as their target becomes invalid; the next
        // periodic nearest-player scan must not leave a dead/creative target
        // active for the remainder of its scan interval.
        if (!validTarget) {
            if (this.attackTarget && this.mobFamily === 'skeleton' && this.entityType !== 'minecraft:wither_skeleton') {
                this.resetSkeletonBowGoal();
            }
            if (this.entityType === 'minecraft:drowned' && this.hasTrident) this.resetDrownedRangedGoal();
            this.attackTarget = null;
        }
        const maxRange = MOB_ENTITY_TYPES[this.entityType].followRange;
        // NearestAttackableTargetGoal(Player, mustSee=true) uses a random
        // interval of ten ticks: it rolls nextInt(10) on each eligible tick,
        // rather than scanning on a fixed ten-tick countdown.
        if (!validTarget && this.random.nextInt(10) === 0) {
            this.targetScanTicks = 10;
            let nearestDistance = maxRange * maxRange;
            for (const player of players) {
                if (!isValidTarget(player) || !this.canSeeTarget(player)) continue;
                const dx = player.x - this.x, dy = player.y - this.y, dz = player.z - this.z;
                const distance = dx * dx + dy * dy + dz * dz;
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    validTarget = player;
                }
            }
            this.attackTarget = validTarget;
            this.targetUnseenTicks = 0;
        } else if (!validTarget) {
            this.targetScanTicks = Math.min(10, this.targetScanTicks + 1);
        }

        const target = this.attackTarget;
        if (this.entityType === 'minecraft:drowned' && target) this.drownedSearchingForLand = false;
        if (this.updateDrownedEnvironmentAI()) return;
        if (!target) {
            if (this.mobFamily === 'skeleton' && this.entityType !== 'minecraft:wither_skeleton') {
                this.resetSkeletonBowGoal();
            }
            if (this.entityType === 'minecraft:drowned' && this.hasTrident) this.resetDrownedRangedGoal();
            if (this.updateFleeSunAI()) {
                this.wanderNavigationTarget = null;
                return;
            }
            if (!this.updateWanderAI()) {
                this.navigationPath = null;
                this.navigationTargetCell = null;
            }
            return;
        }
        this.sunHideTarget = null;
        this.wanderNavigationTarget = null;
        const dx = target.x - this.x;
        const dz = target.z - this.z;
        const dy = target.y - this.y;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq > maxRange * maxRange) {
            this.attackTarget = null;
            if (this.mobFamily === 'skeleton' && this.entityType !== 'minecraft:wither_skeleton') {
                this.resetSkeletonBowGoal();
            }
            if (this.entityType === 'minecraft:drowned' && this.hasTrident) this.resetDrownedRangedGoal();
            return;
        }

        this.rotationYaw = MathHelper.toDegrees(Math.atan2(-dx, dz));
        this.rotationYawHead = this.rotationYaw;
        const horizontalDistance = Math.hypot(dx, dz);
        const hasLineOfSight = this.canSeeTarget(target);
        if (this.mobFamily === 'skeleton' && this.entityType !== 'minecraft:wither_skeleton') {
            if (hasLineOfSight) {
                this.targetUnseenTicks = 0;
                this.updateSkeletonRangedAI(target, distanceSq, horizontalDistance, true);
            } else {
                if (++this.targetUnseenTicks > 60) {
                    this.attackTarget = null;
                    this.targetUnseenTicks = 0;
                    this.navigationPath = null;
                    this.resetSkeletonBowGoal();
                    this.updateWanderAI();
                    return;
                }
                this.updateSkeletonRangedAI(target, distanceSq, horizontalDistance, false);
            }
            return;
        }
        if (!hasLineOfSight) {
            if (this.entityType === 'minecraft:drowned' && this.hasTrident) {
                this.tridentSeeTime = 0;
                this.tridentAttackTime--;
                if (this.tridentAttackTime < 0) this.tridentAttackTime = Math.floor(Math.sqrt(distanceSq) / 10 * 40);
            }
            // NearestAttackableTargetGoal forgets a target after 60 consecutive
            // unseen ticks; path navigation can still route around a wall
            // during that memory window.
            if (++this.targetUnseenTicks > 60) {
                this.attackTarget = null;
                this.targetUnseenTicks = 0;
                this.navigationPath = null;
                this.updateWanderAI();
                return;
            }
            this.navigateTo(target);
            return;
        }
        this.targetUnseenTicks = 0;

        if (this.entityType === 'minecraft:drowned' && this.hasTrident) {
            // RangedAttackGoal configured in the JAR uses speed 1, a 40-tick
            // interval and a 10-block radius. It approaches until it has held
            // line of sight for five ticks, then stops navigation to throw.
            this.tridentSeeTime++;
            this.tridentAttackTime--;
            if (distanceSq > 100 || this.tridentSeeTime < 5) {
                this.navigateTo(target);
            } else {
                this.navigationPath = null;
                this.navigationTargetCell = null;
                this.moveForward = 0;
            }
            if (distanceSq <= 100 && this.tridentAttackTime === 0) {
                this.shootTrident(target);
                this.tridentAttackTime = Math.floor(MathHelper.clamp(Math.sqrt(distanceSq) / 10, 0.1, 1) * 40);
            } else if (this.tridentAttackTime < 0) {
                this.tridentAttackTime = Math.floor(Math.sqrt(distanceSq) / 10 * 40);
            }
            return;
        }

        // Minecraft's wither skeleton equips a stone sword and selects the
        // melee goal; the bow goal is only active for skeleton/stray.
        if (this.isWithinMeleeAttackRange(target)) {
            if (this.attackCooldown === 0 && !target.creative && !target.spectator) {
                const meleeDamage = MOB_ENTITY_TYPES[this.entityType].meleeDamage ?? 3;
                const damage = target.damageEntity?.(meleeDamage,
                    this.entityType.split(':').pop(), 'mob_attack', this) ?? 0;
                // LivingEntity.dealDefaultKnockback applies 0.4 on an accepted
                // entity hit; Mob#getKnockback adds nothing for these unenchanted mobs.
                if (damage > 0) applyKnockback(target, this, 0.4);
                if (damage > 0 && this.entityType === 'minecraft:husk') {
                    // Husk.doHurtTarget constructs the effect with
                    // (int)(140 * effectiveDifficulty), so fractional local
                    // difficulty is truncated before the effect is applied.
                    const hungerDuration = 140 * Math.floor(this.getEffectiveDifficulty());
                    if (hungerDuration > 0) target.addStatusEffect?.('hunger', hungerDuration, 0);
                }
                if (damage > 0 && this.entityType === 'minecraft:wither_skeleton') target.addStatusEffect?.('wither', 200, 0);
                if (damage > 0 && this.mobFamily === 'zombie' && !this.drownedWeapon && this.fireTicks > 0) {
                    // Zombie.doHurtTarget ignites a successful melee target
                    // only with an empty main hand, using 30% per effective
                    // difficulty and integer-truncated seconds.
                    const effectiveDifficulty = this.getEffectiveDifficulty();
                    if (this.random.nextFloat() < effectiveDifficulty * 0.3) {
                        const seconds = 2 * Math.floor(effectiveDifficulty);
                        if (seconds > 0) target.igniteForSeconds?.(seconds);
                    }
                }
                this.swingArm({ type: 'whack', duration: 6 });
                this.attackCooldown = 20;
            }
            return;
        }

        this.navigateTo(target);
    }

    updateDoorBreakingAI() {
        const world = this.world;
        if (this.mobFamily !== 'zombie' || !this.canBreakDoors || world?.difficulty !== 'hard' ||
            world?.mobGriefing === false || !world?.getBlockAt) {
            this.doorBreakPosition = null;
            this.doorBreakTicks = 0;
            return false;
        }

        const closedDoorAt = (x, y, z) => {
            let id = world.getBlockAt(x, y, z);
            let bottomY = id === 161 ? y - 1 : y;
            id = world.getBlockAt(x, bottomY, z);
            if ((id !== 160 && id !== 161) || ((world.getBlockDataAt?.(x, bottomY, z) ?? 0) & 8) !== 0) return null;
            return { x, y: bottomY, z };
        };

        let door = this.doorBreakPosition && closedDoorAt(
            this.doorBreakPosition.x, this.doorBreakPosition.y, this.doorBreakPosition.z);
        if (!door && this.collision && this.navigationPath?.length) {
            const first = Math.max(0, this.navigationIndex ?? 0);
            for (let i = first; i < Math.min(this.navigationPath.length, first + 3) && !door; i++) {
                const node = this.navigationPath[i];
                const x = Math.floor(node.x), y = Math.floor(node.y), z = Math.floor(node.z);
                // The vanilla door goal probes the next two path nodes at y+1.
                // Include the feet-level cell because this pathfinder stores
                // entity feet directly rather than Minecraft's node offset.
                door = closedDoorAt(x, y, z) || closedDoorAt(x, y + 1, z);
            }
            if (door) {
                const dx = door.x + 0.5 - this.x, dy = door.y + 0.5 - this.y, dz = door.z + 0.5 - this.z;
                if (dx * dx + dy * dy + dz * dz > 2.25) door = null;
            }
            if (door) {
                this.doorBreakPosition = door;
                this.doorBreakTicks = 0;
            }
        }

        if (!door) {
            this.doorBreakPosition = null;
            this.doorBreakTicks = 0;
            return false;
        }

        const dx = door.x + 0.5 - this.x, dy = door.y + 0.5 - this.y, dz = door.z + 0.5 - this.z;
        if (dx * dx + dy * dy + dz * dz > 4) {
            this.doorBreakPosition = null;
            this.doorBreakTicks = 0;
            return false;
        }

        // Vanilla BreakDoorGoal uses max(240, configuredTime) and is registered
        // only on finalized zombies. Its valid-difficulty predicate is HARD.
        if (this.random.nextInt(20) === 0 && !this.isSwinging?.()) this.swingArm({ type: 'whack', duration: 6 });
        this.doorBreakTicks++;
        if (this.doorBreakTicks >= 240) {
            const { x, y, z } = door;
            if (world.getBlockAt(x, y + 1, z) === 161) world.setBlockAt(x, y + 1, z, 0);
            if (world.getBlockAt(x, y, z) === 160) world.setBlockAt(x, y, z, 0);
            this.doorBreakPosition = null;
            this.doorBreakTicks = 0;
        }
        return true;
    }

    updateSkeletonRangedAI(target, distanceSq, horizontalDistance, hasLineOfSight) {
        // Mirrors the stateful parts of reference RangedBowAttackGoal: the skeleton
        // closes until it has held line of sight for 20 ticks inside 15 blocks,
        // then strafes and backs away only when it gets too close.
        if (hasLineOfSight) this.rangedSeeTime = Math.max(0, this.rangedSeeTime) + 1;
        else this.rangedSeeTime = Math.min(0, this.rangedSeeTime) - 1;

        const attackRadiusSq = 15 * 15;
        if (distanceSq > attackRadiusSq || this.rangedSeeTime < 20) {
            this.navigateTo(target);
            this.rangedStrafingTime = -1;
        } else {
            this.navigationPath = null;
            this.rangedStrafingTime++;
            if (this.rangedStrafingTime >= 20) {
                if (this.random.nextFloat() < 0.3) this.rangedStrafingClockwise = !this.rangedStrafingClockwise;
                if (this.random.nextFloat() < 0.3) this.rangedStrafingBackwards = !this.rangedStrafingBackwards;
                this.rangedStrafingTime = 0;
            }
            if (distanceSq > attackRadiusSq * 0.75) this.rangedStrafingBackwards = false;
            else if (distanceSq < attackRadiusSq * 0.25) this.rangedStrafingBackwards = true;
            this.moveForward = this.rangedStrafingBackwards ? -0.5 : 0.5;
            this.moveStrafing = this.rangedStrafingClockwise ? 0.5 : -0.5;
            // MoveControl.strafe() in the reference JAR hard-codes speedModifier
            // to 0.25; the +/-0.5 inputs do not themselves encode that speed.
            this.moveControlSpeedModifier = 0.25;
        }

        if (this.rangedChargeTicks > 0) {
            this.rangedChargeTicks++;
            if (hasLineOfSight && this.rangedChargeTicks >= 20) {
                this.shootArrow(target);
                this.rangedChargeTicks = 0;
                this.rangedAttackCooldown = this.world?.difficulty === 'hard' ? 20 : 40;
            } else if (this.rangedSeeTime < -60) {
                this.rangedChargeTicks = 0;
            }
        } else {
            if (this.rangedAttackCooldown > 0) this.rangedAttackCooldown--;
            if (this.rangedAttackCooldown === 0 && this.rangedSeeTime >= -60) this.rangedChargeTicks = 1;
        }
    }

    resetSkeletonBowGoal() {
        // RangedBowAttackGoal.stop() in the reference JAR clears seeTime, sets
        // attackTime to -1 and stops using the bow. Reset the local equivalent
        // whenever the goal loses its target so a later target cannot inherit
        // a partially drawn bow or stale cooldown.
        this.rangedChargeTicks = 0;
        this.rangedAttackCooldown = 0;
        this.rangedSeeTime = 0;
    }

    resetDrownedRangedGoal() {
        // RangedAttackGoal.stop() clears its target/visibility memory and
        // resets attackTime to -1. The next target therefore gets a fresh
        // distance-scaled wind-up instead of inheriting an old trident timer.
        this.tridentSeeTime = 0;
        this.tridentAttackTime = -1;
    }

    isWithinMeleeAttackRange(target) {
        // Mob#getAttackBoundingBox in the reference client inflates the mob AABB by
        // sqrt(2.04) - 0.6 on X/Z, then intersects the target hitbox.
        const reach = Math.sqrt(2.04) - 0.6;
        const targetWidth = target.width ?? 0.6;
        const targetHeight = target.height ?? 1.8;
        const halfWidth = (this.width + targetWidth) * 0.5 + reach;
        const verticalOverlap = this.y < target.y + targetHeight && this.y + this.height > target.y;
        return verticalOverlap && Math.abs(target.x - this.x) < halfWidth && Math.abs(target.z - this.z) < halfWidth;
    }

    updateDaylightBurning() {
        if (this.fireImmune) this.fireTicks = 0;
        const sunSensitive = this.entityType === 'minecraft:zombie' || this.entityType === 'minecraft:skeleton' ||
            this.entityType === 'minecraft:stray';
        if (!sunSensitive) return;
        const world = this.world;
        if (!world || world.monstersBurn === false) return;
        const dayTime = ((world.time ?? 0) % 24000 + 24000) % 24000;
        if (dayTime >= 12000) return;
        const x = Math.floor(this.x), y = Math.floor(this.y + this.getEyeHeight()), z = Math.floor(this.z);
        const brightness = world.getLightBrightness?.(x, y, z);
        if (!Number.isFinite(brightness) || brightness <= 0.5) return;

        const inRain = world.isRainingAt?.(x, y, z) ?? world.isRaining?.(this) ?? world.raining ?? false;
        const inPowderSnow = world.isInPowderSnow?.(this) ?? this.isInPowderSnow ?? false;
        if (inRain || inPowderSnow || this.isInWater()) return;

        let seesSky = true;
        if (typeof world.canSeeSkyAt === 'function') {
            try { seesSky = world.canSeeSkyAt(x, y, z); } catch { seesSky = false; }
        } else if (typeof world.getHeightAt === 'function') {
            try { seesSky = y >= world.getHeightAt(x, z); } catch { seesSky = false; }
        }
        if (!seesSky) return;

        // Mob#isSunBurnTick in the reference JAR evaluates
        // nextFloat()*30 < (brightness-0.4)*2 after its sky/water gates.
        // At full light this is a 4% ignition chance per tick, not guaranteed.
        if (this.random.nextFloat() * 30 >= (brightness - 0.4) * 2) return;
        this.fireTicks = Math.max(this.fireTicks, 160);
    }

    isBrightOutside() {
        const world = this.world;
        if (world?.dimensionHasFixedTime) return false;
        const skyDarken = world?.calculateSkylightSubtracted?.(1.0) ?? world?.skylightSubtracted;
        if (Number.isFinite(skyDarken)) return skyDarken < 4;

        // Lightweight worlds in AI unit tests do not expose the Level sky
        // brightness API; keep their deterministic daytime fallback while
        // real worlds use the exact world-level reference skyDarken threshold.
        const time = ((this.world?.time ?? 0) % 24000 + 24000) % 24000;
        if (time >= 12000) return false;
        const x = Math.floor(this.x), y = Math.floor(this.y + this.height * 0.8), z = Math.floor(this.z);
        let seesSky = true;
        if (typeof this.world?.getHeightAt === 'function') {
            try { seesSky = y >= this.world.getHeightAt(x, z); } catch { seesSky = false; }
        }
        const brightness = this.world?.getLightBrightness?.(x, y, z);
        return seesSky && (!Number.isFinite(brightness) || brightness >= 0.5);
    }

    updateFleeSunAI() {
        // Zombie#addBehaviourGoals / AbstractSkeleton register RestrictSun and
        // FleeSun. The latter is a MOVE goal at speed 1 and only starts when
        // the mob has no target, is burning in bright daylight, can see sky,
        // and has no head item. These supported spawns have no equipment API.
        const sunSensitive = this.entityType === 'minecraft:zombie' || this.entityType === 'minecraft:skeleton' ||
            this.entityType === 'minecraft:stray';
        if (!sunSensitive || this.attackTarget) {
            this.sunHideTarget = null;
            return false;
        }
        if (this.sunHideTarget) {
            const dx = this.sunHideTarget.x - this.x;
            const dz = this.sunHideTarget.z - this.z;
            if (dx * dx + dz * dz < 0.25) {
                this.sunHideTarget = null;
                this.navigationPath = null;
                this.navigationTargetCell = null;
            } else {
                this.navigateTo(this.sunHideTarget);
                if (this.onGround && this.collision && !this.navigationPath) {
                    // PathNavigation.moveTo fails with a completed path in
                    // vanilla; do not leave a failed shade goal monopolizing
                    // movement forever.
                    this.sunHideTarget = null;
                    this.navigationTargetCell = null;
                    return false;
                }
                return true;
            }
        }
        if (this.fireTicks <= 0 || !this.isBrightOutside()) return false;

        const originX = Math.floor(this.x), originY = Math.floor(this.y), originZ = Math.floor(this.z);
        const heightAt = this.world?.getHeightAt;
        if (typeof heightAt !== 'function') return false;
        // FleeSunGoal#getHidePos tries at most ten offsets, in this exact
        // x/y/z RNG order and ranges. Only accept a candidate outside direct
        // sky light and with a negative path malus when the world exposes it.
        for (let attempt = 0; attempt < 10; attempt++) {
            const x = originX + this.random.nextInt(20) - 10;
            const y = originY + this.random.nextInt(6) - 3;
            const z = originZ + this.random.nextInt(20) - 10;
            let skyVisible = true;
            try { skyVisible = y >= heightAt.call(this.world, x, z); } catch { /* unknown candidate: do not call it shade */ }
            if (skyVisible) continue;
            const pathValue = this.world.getWalkTargetValue?.(x, y, z);
            if (Number.isFinite(pathValue) && pathValue >= 0) continue;
            this.sunHideTarget = { x: x + 0.5, y, z: z + 0.5 };
            this.navigationTargetCell = null;
            this.navigationPath = null;
            this.navigationRepathTicks = 0;
            this.navigateTo(this.sunHideTarget);
            if (this.onGround && this.collision && !this.navigationPath) {
                this.sunHideTarget = null;
                this.navigationTargetCell = null;
                return false;
            }
            return true;
        }
        return false;
    }

    getSeaLevel() {
        return this.world?.getSeaLevel?.() ??
            this.world?.chunkProvider?.generator?.getSeaLevel?.() ??
            this.world?.chunkProvider?.generator?.seaLevel ?? 63;
    }

    getEffectiveDifficulty() {
        const effectiveDifficulty = this.world?.effectiveDifficulty;
        if (Number.isFinite(effectiveDifficulty)) return Math.max(0, effectiveDifficulty);

        // The reference DifficultyInstance.calculateDifficulty. World.time
        // here is time-of-day, so only use total-age / inhabited-time fields
        // when the world implementation explicitly provides them.
        const difficultyName = String(this.world?.difficulty ?? 'normal').toLowerCase();
        if (difficultyName === 'peaceful') return 0;
        const difficultyId = difficultyName === 'easy' ? 1 : difficultyName === 'hard' ? 3 : 2;
        const worldAge = Number.isFinite(this.world?.worldAgeTicks) ? this.world.worldAgeTicks
            : Number.isFinite(this.world?.worldAge) ? this.world.worldAge
                : Number.isFinite(this.world?.age) ? this.world.age : 0;
        const sampledInhabitedTime = this.world?.getInhabitedTimeAt?.(this.x, this.z);
        const inhabitedTicks = Number.isFinite(sampledInhabitedTime) ? sampledInhabitedTime
            : Number.isFinite(this.world?.inhabitedTimeTicks) ? this.world.inhabitedTimeTicks
                : Number.isFinite(this.world?.inhabitedTime) ? this.world.inhabitedTime : 0;
        const sampledMoonBrightness = this.world?.getMoonBrightness?.();
        const moonBrightness = Number.isFinite(sampledMoonBrightness) ? sampledMoonBrightness
            : Number.isFinite(this.world?.moonBrightness) ? this.world.moonBrightness : 0;
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const globalTimeFactor = clamp((worldAge - 72000) / 1440000, 0, 1) * 0.25;
        const base = 0.75 + globalTimeFactor;
        let local = clamp(inhabitedTicks / 3600000, 0, 1) * (difficultyName === 'hard' ? 1 : 0.75);
        local += clamp(moonBrightness * 0.25, 0, globalTimeFactor);
        if (difficultyName === 'easy') local *= 0.5;
        return difficultyId * (base + local);
    }

    findNearbyWaterTarget() {
        const originX = Math.floor(this.x), originY = Math.floor(this.y), originZ = Math.floor(this.z);
        for (let attempt = 0; attempt < 10; attempt++) {
            const x = originX + this.random.nextInt(20) - 10;
            const y = originY - 2 - this.random.nextInt(8);
            const z = originZ + this.random.nextInt(20) - 10;
            const fluid = this.world?.getFluidState?.(x, y, z);
            const waterId = BlockRegistry.WATER?.getId?.();
            const isWater = fluid
                ? isFluidType(fluid, 'water')
                : waterId !== undefined && this.world?.getBlockAt?.(x, y, z) === waterId;
            if (isWater) return { x: x + 0.5, y, z: z + 0.5 };
        }
        return null;
    }

    findNearbyBeachTarget() {
        if (typeof this.world?.getHeightAt !== 'function' || typeof this.world?.getCollisionBoxes !== 'function') return null;
        const originX = Math.floor(this.x), originY = Math.floor(this.y), originZ = Math.floor(this.z);
        let closest = null;
        let closestDistanceSq = Infinity;
        // JAR DrownedGoToBeachGoal searches an 8-block horizontal radius and
        // two blocks vertically, accepts a standable block with two clear
        // blocks above, and then sends navigation to the block's top center.
        for (let dz = -8; dz <= 8; dz++) {
            for (let dx = -8; dx <= 8; dx++) {
                if (dx * dx + dz * dz > 64) continue;
                const x = originX + dx, z = originZ + dz;
                let surfaceY;
                try { surfaceY = this.world.getHeightAt(x, z); } catch { continue; }
                if (!Number.isFinite(surfaceY)) continue;
                const floorY = Math.floor(surfaceY) - 1;
                if (Math.abs(floorY - originY) > 2) continue;
                const support = new BoundingBox(x + 0.05, floorY + 0.75, z + 0.05,
                    x + 0.95, floorY + 1.02, z + 0.95);
                const headroom = new BoundingBox(x + 0.05, floorY + 1, z + 0.05,
                    x + 0.95, floorY + 3, z + 0.95);
                if (!this.world.getCollisionBoxes(support).length || this.world.getCollisionBoxes(headroom).length) continue;
                const distanceSq = dx * dx + dz * dz + (floorY - originY) ** 2;
                if (distanceSq >= closestDistanceSq) continue;
                closestDistanceSq = distanceSq;
                closest = { x: x + 0.5, y: floorY + 1, z: z + 0.5 };
            }
        }
        return closest;
    }

    canSeeTarget(target) {
        if (typeof this.world?.rayTraceBlocks !== 'function') return true;
        const from = { x: this.x, y: this.y + this.height * 0.85, z: this.z };
        const to = {
            x: target.x,
            y: target.y + (target.getEyeHeight?.() ?? (target.height || 1.8) * 0.85),
            z: target.z
        };
        return !this.world.rayTraceBlocks(from, to);
    }

    updateDrownedEnvironmentAI() {
        if (this.entityType !== 'minecraft:drowned') return false;
        const inWater = this.isInWater();
        this.drownedInWaterThisTick = inWater;
        const brightOutside = this.isBrightOutside();
        if (brightOutside && !inWater) {
            if (this.waterNavigationTarget) {
                const target = this.waterNavigationTarget;
                if (Math.hypot(target.x - this.x, target.z - this.z) > 1.25) {
                    this.navigateTo(target);
                    return true;
                }
                this.waterNavigationTarget = null;
                this.navigationPath = null;
            }
            // DrownedGoToWaterGoal.canUse is evaluated every goal-selector
            // tick in the reference client. If its ten-position probe finds no water, retry
            // next tick instead of adding a non-vanilla 20-tick cooldown.
            this.waterNavigationTarget = this.findNearbyWaterTarget();
            if (this.waterNavigationTarget) {
                this.navigateTo(this.waterNavigationTarget);
                return true;
            }
            return false;
        }
        this.waterNavigationTarget = null;
        const seaLevel = this.getSeaLevel();
        if (!brightOutside && inWater && !this.attackTarget) {
            // Goal priorities in the reference client put DrownedGoToBeachGoal (5) ahead of
            // DrownedSwimUpGoal (6). Their eligibility overlaps from
            // seaLevel-3 to seaLevel-2, so resolve a valid beach route first.
            if (this.y >= seaLevel - 3) {
                if (this.beachNavigationTarget) {
                    const target = this.beachNavigationTarget;
                    if (Math.hypot(target.x - this.x, target.z - this.z) > 1.25) {
                        this.navigateTo(target);
                        return true;
                    }
                    this.beachNavigationTarget = null;
                    this.navigationPath = null;
                }
                if (this.beachSearchCooldown > 0) this.beachSearchCooldown--;
                else {
                    this.beachSearchCooldown = 200 + this.random.nextInt(200);
                    this.beachNavigationTarget = this.findNearbyBeachTarget();
                    if (this.beachNavigationTarget) {
                        this.navigateTo(this.beachNavigationTarget);
                        return true;
                    }
                }
            }
            if (this.y < seaLevel - 2) {
                this.drownedSearchingForLand = true;
                const target = this.drownedSwimUpTarget;
                const targetDistanceSq = target
                    ? (Math.floor(target.x) - this.x) ** 2 + (Math.floor(target.y) - this.y) ** 2 +
                        (Math.floor(target.z) - this.z) ** 2
                    : Infinity;
                if (this.y < seaLevel - 1 && (!this.navigationPath || targetDistanceSq < 4)) {
                    this.drownedSwimUpTarget = this.findDrownedSwimUpTarget(seaLevel);
                    this.navigationPath = null;
                    this.navigationTargetCell = null;
                    this.navigationRepathTicks = 0;
                }
                if (this.drownedSwimUpTarget) this.navigateTo(this.drownedSwimUpTarget);
                if (!this.navigationPath) {
                    this.drownedSwimUpTarget = null;
                    this.drownedSearchingForLand = false;
                    return false;
                }
                return true;
            }
            this.drownedSwimUpTarget = null;
            this.drownedSearchingForLand = false;
        } else {
            this.drownedSearchingForLand = false;
            this.beachNavigationTarget = null;
            this.drownedSwimUpTarget = null;
        }
        return false;
    }

    findDrownedSwimUpTarget(seaLevel) {
        // DrownedSwimUpGoal uses DefaultRandomPos.getPosTowards(mob, 4, 8,
        // {x, seaLevel - 1, z}, PI/2), retaining the highest walk-target
        // value among ten stable destinations.
        let best = null;
        let bestScore = -Infinity;
        const angleBase = Math.atan2(0, 0) - Math.PI / 2;
        for (let attempt = 0; attempt < 10; attempt++) {
            const angle = angleBase + (2 * this.random.nextFloat() - 1) * Math.PI / 2;
            const radius = Math.sqrt(this.random.nextDouble()) * 4 * Math.SQRT2;
            const offsetX = -radius * Math.sin(angle);
            const offsetZ = radius * Math.cos(angle);
            const offsetY = this.random.nextInt(17) - 8;
            if (Math.abs(offsetX) > 4 || Math.abs(offsetZ) > 4) continue;
            const x = Math.floor(this.x + offsetX);
            const y = Math.floor(this.y + offsetY);
            const z = Math.floor(this.z + offsetZ);
            if (!isMobStableDestination(this.world, this, x, y, z)) continue;
            const score = this.world.getWalkTargetValue?.(x, y, z) ?? 0;
            if (!Number.isFinite(score) || score <= bestScore) continue;
            bestScore = score;
            best = { x: x + 0.5, y, z: z + 0.5 };
        }
        return best;
    }

    isEyeInWater() {
        return pointInFluid(this.world, this.x, this.y + this.height * .9 - .11111111, this.z, 'water', BlockRegistry.WATER?.getId?.());
    }

    tickWaterConversion() {
        if (this.entityType !== 'minecraft:zombie' && this.entityType !== 'minecraft:husk') return;
        if (!this.isEyeInWater()) {
            this.waterAfflictionTicks = 0;
            this.waterConversionTicks = -1;
            return;
        }
        if (this.waterConversionTicks >= 0) {
            if (--this.waterConversionTicks < 0) {
                this.convertInWater();
            }
            return;
        }
        if (++this.waterAfflictionTicks >= 600) this.waterConversionTicks = 300;
    }

    convertInWater() {
        const convertedType = this.entityType === 'minecraft:husk'
            ? 'minecraft:zombie'
            : 'minecraft:drowned';
        return this.convertToEntityType(convertedType);
    }

    tickFreezeConversion() {
        if (this.entityType !== 'minecraft:skeleton') return;
        const afflicted = this.world?.isInPowderSnow?.(this) ?? this.isInPowderSnow ?? false;
        if (!afflicted) {
            // ConversionTracker resets rather than pauses its timers when the
            // skeleton leaves powder snow.
            this.freezeAfflictionTicks = -1;
            this.freezeConversionTicks = -1;
            return;
        }
        if (this.freezeConversionTicks >= 0) {
            if (--this.freezeConversionTicks < 0) this.convertToEntityType('minecraft:stray');
            return;
        }
        if (++this.freezeAfflictionTicks >= 140) this.freezeConversionTicks = 300;
    }

    convertToEntityType(convertedType) {
        const converted = createMobEntity(this.minecraft, this.world, convertedType, {
            x: this.x, y: this.y, z: this.z, yaw: this.rotationYaw, pitch: this.rotationPitch
        });
        if (!converted) return false;
        converted.id = this.id;
        converted.health = this.health;
        converted.motionX = this.motionX;
        converted.motionY = this.motionY;
        converted.motionZ = this.motionZ;
        converted.statusEffects = new Map([...this.statusEffects].map(([id, effect]) => [id, { ...effect }]));
        converted.ticksExisted = this.ticksExisted;
        converted.fireTicks = this.fireTicks;
        converted.lastAttackerName = this.lastAttackerName;
        converted.lastHurtByPlayerName = this.lastHurtByPlayerName;
        converted.lastHurtByPlayerTicks = this.lastHurtByPlayerTicks;
        converted.lastDamageLootingLevel = this.lastDamageLootingLevel;
        converted.lastDamageSmeltsLoot = this.lastDamageSmeltsLoot;
        converted.attackTarget = this.attackTarget;
        if (typeof this.world?.removeEntityById === 'function') this.world.removeEntityById(this.id);
        else this.world.entities = (this.world.entities ?? []).filter(entity => entity !== this);
        this.isDead = true;
        this.world?.addEntity?.(converted);
        return true;
    }

    addStatusEffect(effect, duration, amplifier = 0) {
        if (typeof effect !== 'string' || !Number.isFinite(duration) || duration <= 0) return false;
        if (effect === 'poison' || effect === 'regeneration') return false;
        const level = Math.max(0, Math.floor(Number.isFinite(amplifier) ? amplifier : 0));
        const strength = 2 ** level;
        if (effect === 'instant_health') {
            // Undead invert the two instant effects: Healing harms them for
            // four points per level instead of restoring health.
            this.damageEntity(4 * strength, null, 'magic');
            return true;
        }
        if (effect === 'instant_damage') {
            // Harming heals undead. Keep the effect synchronous, as in the
            // JAR's instantaneous MobEffect path, and clamp to mob max health.
            if (this.health > 0 && !this.isDead) this.health = Math.min(MOB_ENTITY_TYPES[this.entityType].health, this.health + 6 * strength);
            return true;
        }
        return super.addStatusEffect(effect, duration, level);
    }

    canReceiveStatusEffect(effect) {
        if (this.entityType === 'minecraft:wither_skeleton' && effect === 'wither') return false;
        return true;
    }

    die() {
        if (this.lootDropped) return;
        this.lootDropped = true;
        // LivingEntity.tickDeath in the reference client leaves the dying entity in-world for
        // 20 ticks. Loot/XP are emitted by die() immediately; only removal waits.
        this.health = 0;
        this.deathTime = 0;
        this.prevDeathTime = 0;
        this.isDead = false;
        // LivingEntity.shouldDropLoot and dropExperience are both gated by
        // GameRules.MOB_DROPS in the reference server.
        if (this.world?.mobDrops === false) return;
        this.dropMobLoot();
        if (this.lastHurtByPlayerTicks > 0) this.dropExperience(5);
    }

    dropExperience(amount) {
        if (!this.world?.addEntity) return;
        for (const value of splitExperienceOrbValues(amount)) {
            const orb = new ExperienceOrbEntity(this.minecraft, this.world, this.x, this.y + 0.5, this.z, value);
            orb.motionX = (this.random.nextFloat() - 0.5) * 0.2;
            orb.motionY = this.random.nextFloat() * 0.2;
            orb.motionZ = (this.random.nextFloat() - 0.5) * 0.2;
            this.world.addEntity(orb);
        }
    }

    dropMobLoot() {
        // reference sets LootContextParams.LAST_DAMAGE_PLAYER from
        // lastHurtByPlayerMemoryTime; a killer name alone is not player credit
        // (mob types can collide with usernames, and mob kills aren't players).
        const killedByPlayer = this.lastHurtByPlayerTicks > 0;
        const drop = (item, count) => {
            const id = item?.getId?.();
            if (!Number.isInteger(id) || count <= 0 || !this.world?.addEntity) return;
            const entity = new ItemEntity(this.minecraft, this.world, id, this.x, this.y, this.z, count);
            entity.pickupDelayTicks = 10;
            entity.motionX = (this.random.nextFloat() - 0.5) * 0.1;
            entity.motionY = this.random.nextFloat() * 0.1 + 0.1;
            entity.motionZ = (this.random.nextFloat() - 0.5) * 0.1;
            this.world.addEntity(entity);
        };
        const lootingLevel = Math.max(0, this.lastDamageLootingLevel ?? 0);
        const count = max => this.random.nextInt(max + 1);
        const withLooting = (baseCount, limit = Infinity) => Math.min(limit,
            baseCount + (lootingLevel > 0 ? Math.round(lootingLevel * this.random.nextFloat()) : 0));
        const rareDropChance = (unenchanted, firstLevel) => lootingLevel > 0
            ? firstLevel + (lootingLevel - 1) * 0.01
            : unenchanted;

        if (this.mobFamily === 'zombie') {
            drop(BlockRegistry.ITEM_ROTTEN_FLESH, withLooting(count(2)));
            // Zombie and Husk share the rare iron/carrot/potato pool. Drowned
            // has its own loot table (rotten flesh + player-only copper) and
            // must never roll this pool.
            if (this.entityType !== 'minecraft:drowned' && killedByPlayer &&
                this.random.nextFloat() < rareDropChance(0.025, 0.035)) {
                const rare = this.random.nextInt(3);
                drop(rare === 0 ? BlockRegistry.ITEM_IRON
                    : rare === 1 ? BlockRegistry.ITEM_CARROT
                        : this.fireTicks > 0 || this.lastDamageSmeltsLoot
                            ? BlockRegistry.ITEM_BAKED_POTATO : BlockRegistry.ITEM_POTATO, 1);
            }
            if (this.entityType === 'minecraft:drowned' && killedByPlayer &&
                this.random.nextFloat() < rareDropChance(0.11, 0.13)) {
                drop(BlockRegistry.ITEM_COPPER_INGOT, 1);
            }
            return;
        }

        if (this.entityType === 'minecraft:wither_skeleton') {
            drop(BlockRegistry.ITEM_COAL, withLooting(this.random.nextInt(3) - 1));
            drop(BlockRegistry.ITEM_BONE, withLooting(count(2)));
            if (killedByPlayer && this.random.nextFloat() < rareDropChance(0.025, 0.035)) {
                drop(BlockRegistry.ITEM_WITHER_SKELETON_SKULL, 1);
            }
            return;
        }

        drop(BlockRegistry.ITEM_ARROW, withLooting(count(2)));
        drop(BlockRegistry.ITEM_BONE, withLooting(count(2)));
        if (this.entityType === 'minecraft:stray' && killedByPlayer) {
            drop(BlockRegistry.ITEM_TIPPED_ARROW, withLooting(count(1), 1));
        }
    }

    updateWanderAI() {
        if (this.wanderNavigationTarget && this.navigationPath) {
            this.navigateTo(this.wanderNavigationTarget);
            if (this.navigationPath) return true;
        }
        this.wanderNavigationTarget = null;
        this.navigationPath = null;
        this.navigationTargetCell = null;
        this.moveForward = 0;
        this.jumping = false;

        // reference RandomStrollGoal uses a 120-tick interval. DefaultRandomPos
        // tries ten offsets (10 blocks horizontally, 7 vertically) and picks
        // the valid destination with the best walk-target score.
        if (this.random.nextInt(120) !== 0 || typeof this.world?.getCollisionBoxes !== 'function') return false;
        let best = null;
        let bestScore = -Infinity;
        for (let attempt = 0; attempt < 10; attempt++) {
            const offsetX = this.random.nextInt(21) - 10;
            const offsetY = this.random.nextInt(15) - 7;
            const offsetZ = this.random.nextInt(21) - 10;
            const x = Math.floor(this.x + offsetX);
            const y = Math.floor(this.y + offsetY);
            const z = Math.floor(this.z + offsetZ);
            if (!isMobStableDestination(this.world, this, x, y, z)) continue;
            const score = this.world.getWalkTargetValue?.(x, y, z) ?? 0;
            if (!Number.isFinite(score) || score <= bestScore) continue;
            bestScore = score;
            best = { x: x + 0.5, y, z: z + 0.5 };
        }
        if (!best) return false;
        this.wanderNavigationTarget = best;
        this.navigateTo(best);
        if (this.navigationPath) return true;
        this.wanderNavigationTarget = null;
        this.moveForward = 0;
        this.jumping = false;
        return false;
    }

    navigateTo(target) {
        // Mob.setSpeed in the JAR sets BOTH speed and forward input. MOVE_TO
        // therefore uses the movement attribute here, while STRAFE overrides
        // its input separately. Using 1 made ordinary walkers ~4x too fast.
        this.moveForward = this.getAIMoveSpeed();
        this.jumping = this.onGround && this.collision;
        const targetCell = `${Math.floor(target.x)},${Math.floor(target.y)},${Math.floor(target.z)}`;
        if (this.navigationRepathTicks > 0) this.navigationRepathTicks--;
        if (this.navigationTargetCell !== targetCell) this.navigationPath = null;
        const canRepath = this.collision && this.onGround ||
            this.entityType === 'minecraft:drowned' && (this.drownedInWaterThisTick ?? this.isInWater());
        if (canRepath && this.navigationRepathTicks === 0) {
            this.navigationPath = findMobPath(this.world, this, target);
            this.navigationIndex = 1;
            this.navigationTargetCell = targetCell;
            this.navigationRepathTicks = 12;
        }
        if (!this.navigationPath) return;

        let waypoint = this.navigationPath[this.navigationIndex];
        while (waypoint && Math.hypot(waypoint.x - this.x, waypoint.z - this.z) < 0.22 &&
            Math.abs(waypoint.y - this.y) < 0.8) {
            waypoint = this.navigationPath[++this.navigationIndex];
        }
        if (!waypoint) {
            this.navigationPath = null;
            return;
        }
        const dx = waypoint.x - this.x, dz = waypoint.z - this.z;
        this.rotationYaw = MathHelper.toDegrees(Math.atan2(-dx, dz));
        this.rotationYawHead = this.rotationYaw;
        const swimming = this.entityType === 'minecraft:drowned' &&
            (this.drownedInWaterThisTick ?? this.isInWater());
        this.jumping = swimming
            ? waypoint.y > this.y + 0.25
            : this.onGround && (this.collision || waypoint.y > this.y + 0.25);
    }

    // Kept as an alias for existing preview commands/tests that used the
    // first zombie-only AI prototype name.
    updateZombieAI() { this.updateMobAI(); }

    shootArrow(target) {
        return this.shootProjectile(target, { kind: 'arrow', effect: this.entityType === 'minecraft:stray' ? 'slowness' : null });
    }

    shootTrident(target) {
        return this.shootProjectile(target, { kind: 'trident', damage: 8 });
    }

    shootProjectile(target, { kind = 'arrow', effect = null, damage = kind === 'trident' ? 8 : 2 } = {}) {
        const dx = target.x - this.x;
        const dz = target.z - this.z;
        const speed = 1.6;
        const horizontal = Math.hypot(dx, dz);
        const aimHorizontal = Math.hypot(dx, dz) || 1;
        const projectileY = this.y + this.getEyeHeight() - 0.1;
        const targetY = target.y + (target.height ?? 1.8) / 3;
        // the reference client's skeleton/trident ranged-attack code raises the target aim by
        // 0.2 blocks per horizontal block to account for projectile gravity.
        const dy = targetY - projectileY + horizontal * 0.2;
        const length = Math.hypot(aimHorizontal, dy) || 1;
        const difficultyId = ({ peaceful: 0, easy: 1, normal: 2, hard: 3 })[this.world?.difficulty] ?? 2;
        const uncertainty = Math.max(0, 14 - difficultyId * 4);
        const arrow = new MobArrowEntity(this.minecraft, this.world, this,
            this.x,
            projectileY,
            this.z,
            { x: dx / length * speed, y: dy / length * speed, z: dz / length * speed }, effect, { damage, kind, uncertainty });
        this.world.addEntity(arrow);
        this.swingArm({ type: kind === 'trident' ? 'spear' : 'bow', duration: 20 });
        return arrow;
    }

    isInWater() {
        return entityFluidDepth(this, 'water', BlockRegistry.WATER?.getId?.()) > 0;
    }

    isInLava() {
        return entityFluidDepth(this, 'lava', BlockRegistry.LAVA?.getId?.()) > 0;
    }

    getSwimAmount(partialTicks = 0) {
        return this.prevSwimAmount + (this.swimAmount - this.prevSwimAmount) * partialTicks;
    }

    jump() {
        this.motionY = 0.42;
    }

    getBlockSlipperiness() { return this.onGround ? 0.6 : 1.0; }
    getAIMoveSpeed() {
        const slowness = this.statusEffects?.get('slowness')?.amplifier ?? -1;
        const baseSpeed = MOB_ENTITY_TYPES[this.entityType].movementSpeed;
        const effectModifier = slowness < 0 ? 1 : Math.max(0.1, 1 - 0.15 * (slowness + 1));
        return baseSpeed * this.moveControlSpeedModifier * effectModifier;
    }

    moveRelative(forward, up, strafe, friction) {
        let magnitude = strafe * strafe + up * up + forward * forward;
        if (magnitude < 0.0001) return;
        magnitude = Math.max(1, Math.sqrt(magnitude));
        const amount = friction / magnitude;
        strafe *= amount; up *= amount; forward *= amount;
        const radians = MathHelper.toRadians(this.rotationYaw + 180);
        const sin = Math.sin(radians), cos = Math.cos(radians);
        this.motionX += strafe * cos - forward * sin;
        this.motionY += up;
        this.motionZ += forward * cos + strafe * sin;
    }

    travel(forward, vertical, strafe) {
        const previousSlipperiness = this.getBlockSlipperiness() * 0.91;
        const friction = this.onGround
            ? this.getAIMoveSpeed() * 0.16277136 / (previousSlipperiness ** 3)
            : this.jumpMovementFactor;
        this.moveRelative(forward, vertical, strafe, friction);
        const slipperiness = this.getBlockSlipperiness() * 0.91;
        this.collision = this.moveCollide(-this.motionX, this.motionY, -this.motionZ);
        if (!this.flying) this.motionY -= 0.08;
        this.motionX *= slipperiness;
        this.motionY *= 0.98;
        this.motionZ *= slipperiness;
    }

    travelInWater(forward, vertical, strafe) {
        const drownedWantsToSwim = this.entityType === 'minecraft:drowned' &&
            this.isEyeInWater() && (this.drownedSearchingForLand || this.attackTarget?.isInWater?.());
        if (drownedWantsToSwim) {
            const waypoint = this.navigationPath?.[this.navigationIndex];
            const wanted = waypoint ?? (this.attackTarget?.isInWater?.() ? this.attackTarget : null);
            if (wanted) {
                const baseSpeed = this.getAIMoveSpeed();
                // MoveControl uses Mth.lerp(0.125, currentSpeed,
                // movementSpeed * speedModifier), not an instantaneous speed.
                this.drownedControlSpeed += 0.125 * (baseSpeed - this.drownedControlSpeed);
            } else {
                this.drownedControlSpeed = 0;
            }
            if (wanted && (wanted.y > this.y || this.drownedSearchingForLand)) this.motionY += 0.002;
            if (wanted) {
                const dx = wanted.x - this.x;
                const dy = wanted.y - this.y;
                const dz = wanted.z - this.z;
                const distance = Math.hypot(dx, dy, dz);
                if (distance > 1e-8) {
                    // DrownedMoveControl applies distinct horizontal and
                    // vertical steering coefficients after its speed lerp.
                    const steeringSpeed = this.drownedControlSpeed;
                    const desiredYaw = MathHelper.toDegrees(Math.atan2(dz, dx)) - 90;
                    const yawDelta = MathHelper.wrapAngleTo180(desiredYaw - this.rotationYaw);
                    this.rotationYaw += MathHelper.clamp(yawDelta, -90, 90);
                    this.rotationYawHead = this.rotationYaw;
                    this.motionX += steeringSpeed * dx / distance * 0.005;
                    this.motionY += steeringSpeed * dy / distance * 0.1;
                    this.motionZ += steeringSpeed * dz / distance * 0.005;
                }
            }
            // Drowned.travelInWater's submerged swimming branch uses 0.01
            // acceleration and 0.9 drag, with no generic water gravity.
            this.moveRelative(forward, vertical, strafe, 0.01);
            this.collision = this.moveCollide(-this.motionX, this.motionY, -this.motionZ);
            this.motionX *= 0.9;
            this.motionY *= 0.9;
            this.motionZ *= 0.9;
            return;
        }
        if (this.entityType === 'minecraft:drowned') this.drownedControlSpeed = 0;
        travelInWater(this, forward, vertical, strafe);
    }

    travelInLava(forward, vertical, strafe) {
        travelInLava(this, forward, vertical, strafe);
    }
}

export const MOB_ENTITY_TYPES = Object.freeze({
    'minecraft:zombie': { family: 'zombie', skinLayout: 'legacy', texture: 'entities/mobs/zombie.png', sourceTexture: 'zombie/zombie.png', width: 0.6, height: 1.95, health: 20, armor: 2, movementSpeed: 0.23, followRange: 35 },
    'minecraft:husk': { family: 'zombie', skinLayout: 'legacy', texture: 'entities/mobs/husk.png', sourceTexture: 'zombie/husk.png', width: 0.6, height: 1.95, health: 20, armor: 2, movementSpeed: 0.23, followRange: 35 },
    'minecraft:drowned': { family: 'zombie', texture: 'entities/mobs/drowned.png', sourceTexture: 'zombie/drowned.png', overlayTexture: 'entities/mobs/drowned_outer_layer.png', sourceOverlayTexture: 'zombie/drowned_outer_layer.png', width: 0.6, height: 1.95, health: 20, armor: 2, movementSpeed: 0.23, followRange: 35 },
    'minecraft:skeleton': { family: 'skeleton', texture: 'entities/mobs/skeleton.png', sourceTexture: 'skeleton/skeleton.png', width: 0.6, height: 1.99, health: 20, movementSpeed: 0.25, followRange: 16 },
    'minecraft:stray': { family: 'skeleton', texture: 'entities/mobs/stray.png', sourceTexture: 'skeleton/stray.png', overlayTexture: 'entities/mobs/stray_overlay.png', sourceOverlayTexture: 'skeleton/stray_overlay.png', width: 0.6, height: 1.99, health: 20, movementSpeed: 0.25, followRange: 16 },
    // JAR finalizeSpawn sets base attack damage to 4 and equips a stone sword;
    // the reference stone-sword attribute modifier adds 4, for 8 total.
    'minecraft:wither_skeleton': { family: 'skeleton', texture: 'entities/mobs/wither_skeleton.png', sourceTexture: 'skeleton/wither_skeleton.png', width: 0.7, height: 2.4, health: 20, movementSpeed: 0.25, followRange: 16, meleeDamage: 8 }
});

const aliases = new Map(Object.keys(MOB_ENTITY_TYPES).flatMap(id => {
    const shortName = id.slice('minecraft:'.length);
    return [[id, id], [shortName, id], [shortName.toLowerCase(), id]];
}));

export function resolveMobEntityType(type) {
    if (typeof type !== 'string') return null;
    return aliases.get(type) ?? aliases.get(type.toLowerCase()) ?? null;
}

export function createMobEntity(minecraft, world, type, payload) {
    const canonicalType = resolveMobEntityType(type);
    if (!canonicalType) return null;
    const entity = new MobEntity(minecraft, world, -2, canonicalType, payload.x, payload.y, payload.z);
    if (payload.canBreakDoors !== undefined) entity.canBreakDoors = !!payload.canBreakDoors;
    if (payload.reinforcementCallee) entity.reinforcementCalleeCharge = -0.05;
    entity.setRotation(payload.yaw ?? 0, payload.pitch ?? 0);
    return entity;
}
