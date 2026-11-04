export default class FoodData {
    constructor(state = {}) { this.restore(state); }
    restore(state = {}) {
        const bounded = (value, fallback, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
        this.foodLevel = Math.floor(bounded(state.foodLevel, 20, 20));
        this.saturationLevel = bounded(state.saturationLevel, 5, this.foodLevel);
        this.exhaustionLevel = bounded(state.exhaustionLevel, 0, 40);
        this.tickTimer = Math.floor(bounded(state.tickTimer, 0, 80));
    }
    snapshot() {
        return { foodLevel: this.foodLevel, saturationLevel: this.saturationLevel,
            exhaustionLevel: this.exhaustionLevel, tickTimer: this.tickTimer };
    }
    addExhaustion(value) { if (Number.isFinite(value) && value > 0) this.exhaustionLevel = Math.min(40, this.exhaustionLevel + value); }
    eat(nutrition, saturation) {
        this.foodLevel = Math.max(0, Math.min(20, this.foodLevel + nutrition));
        this.saturationLevel = Math.max(0, Math.min(this.foodLevel, this.saturationLevel + saturation));
    }
    tick(player, { difficulty = 'normal', naturalRegeneration = true } = {}) {
        if (player.creative || player.spectator || player.isDead || player.health <= 0) return;
        if (this.exhaustionLevel > 4) {
            this.exhaustionLevel -= 4;
            if (this.saturationLevel > 0) this.saturationLevel = Math.max(0, this.saturationLevel - 1);
            else if (difficulty !== 'peaceful') this.foodLevel = Math.max(0, this.foodLevel - 1);
        }
        if (naturalRegeneration && this.saturationLevel > 0 && this.foodLevel >= 20 && player.health < 20) {
            if (++this.tickTimer >= 10) {
                const saturation = Math.min(this.saturationLevel, 6);
                player.health = Math.min(20, player.health + saturation / 6);
                this.addExhaustion(saturation); this.tickTimer = 0;
            }
        } else if (naturalRegeneration && this.foodLevel >= 18 && player.health < 20) {
            if (++this.tickTimer >= 80) {
                player.health = Math.min(20, player.health + 1);
                this.addExhaustion(6); this.tickTimer = 0;
            }
        } else if (this.foodLevel <= 0) {
            if (++this.tickTimer >= 80) {
                if (difficulty === 'hard' || difficulty === 'normal' && player.health > 1 || difficulty === 'easy' && player.health > 10)
                    player.damageEntity?.(1, null, 'starved to death');
                this.tickTimer = 0;
            }
        } else this.tickTimer = 0;
    }
}
