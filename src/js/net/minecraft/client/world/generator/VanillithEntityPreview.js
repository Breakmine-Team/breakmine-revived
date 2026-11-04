import { createMobEntity, resolveMobEntityType } from '../../entity/MobEntity.js';

function parseCoordinate(value, origin) {
    if (value === undefined) return null;
    if (value === '~') return origin;
    if (value.startsWith('~')) {
        const offset = value.slice(1);
        if (!offset) return origin;
        const parsedOffset = Number(offset);
        return Number.isFinite(parsedOffset) ? origin + parsedOffset : null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function summonVanillithMob(minecraft, world, type, coordinateArgs = []) {
    const canonicalType = resolveMobEntityType(type);
    if (!canonicalType) return { ok: false, reason: 'unknown_type' };
    if (coordinateArgs.length !== 0 && coordinateArgs.length !== 3) return { ok: false, reason: 'usage' };

    const player = minecraft.player;
    if (!player) return { ok: false, reason: 'no_player' };
    const mobCount = world.entities?.filter(entity => entity.entityType && !entity.isDead).length ?? 0;
    if (mobCount >= 32) return { ok: false, reason: 'limit' };
    const look = player.getLook?.(1) ?? { x: 0, y: 0, z: 1 };
    const defaults = [player.x + look.x * 2, player.y, player.z + look.z * 2];
    const coordinates = coordinateArgs.length
        ? coordinateArgs.map((value, axis) => parseCoordinate(value, [player.x, player.y, player.z][axis]))
        : defaults;
    if (!coordinates.every(Number.isFinite)) return { ok: false, reason: 'invalid_position' };

    const entity = createMobEntity(minecraft, world, canonicalType, {
        x: coordinates[0], y: coordinates[1], z: coordinates[2], yaw: player.rotationYaw, pitch: 0
    });
    if (!entity) return { ok: false, reason: 'unknown_type' };
    world.addEntity(entity);
    return { ok: true, entity, type: canonicalType, x: coordinates[0], y: coordinates[1], z: coordinates[2] };
}
