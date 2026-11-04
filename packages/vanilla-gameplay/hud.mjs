export function halfHeartState(value, index) {
    const units = Math.ceil(Math.max(0, Math.min(20, value)));
    return units > index * 2 ? (units >= index * 2 + 2 ? 'full' : 'half') : null;
}
