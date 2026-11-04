export function experienceToNextLevel(level) {
    level = Math.max(0, Math.floor(Number.isFinite(level) ? level : 0));
    if (level >= 30) return 112 + (level - 30) * 9;
    if (level >= 15) return 37 + (level - 15) * 5;
    return 7 + level * 2;
}

export function addExperiencePoints(player, amount) {
    amount = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
    if (!amount) return 0;
    player.totalExperience = Math.max(0, Math.floor(player.totalExperience ?? 0)) + amount;
    player.experienceProgress = Math.max(0, Number(player.experienceProgress) || 0) +
        amount / experienceToNextLevel(player.experienceLevel ?? 0);
    while (player.experienceProgress >= 1) {
        player.experienceProgress -= 1;
        player.experienceLevel = Math.max(0, Math.floor(player.experienceLevel ?? 0)) + 1;
    }
    return amount;
}

export function splitExperienceOrbValues(amount) {
    const values = [];
    let remaining = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
    const denominations = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
    while (remaining > 0) {
        const value = denominations.find(candidate => remaining >= candidate) ?? 1;
        values.push(value);
        remaining -= value;
    }
    return values;
}
