export function resolveNativeFluidState(state, rule) {
    if (!state || !rule || rule.fluidEmpty) return null;
    if (typeof rule.fluid !== 'string' || !rule.fluid.startsWith('minecraft:')) throw new Error('Invalid native fluid identifier');
    const name = rule.fluid.slice('minecraft:'.length).replace(/^flowing_/, '');
    const isFluidBlock = state.name === `minecraft:${name}`;
    const level = isFluidBlock ? Number(state.properties?.level ?? 0) : 0;
    if (!Number.isInteger(level) || level < 0 || level > 15) throw new Error(`Invalid native ${name} fluid level`);
    let baseHeight = 0, ceilingHeight = 1;
    if (state.properties?.waterlogged === 'true' && state.name.endsWith('_slab')) {
        if (state.properties.type === 'bottom') baseHeight = 0.5;
        if (state.properties.type === 'top') ceilingHeight = 0.5;
    }
    return { name, source: rule.fluidSource, level, falling: isFluidBlock && level >= 8,
        waterlogged: state.properties?.waterlogged === 'true', baseHeight, ceilingHeight, stateId: state.id };
}

/** Match both the resolver's canonical short name and namespaced API values. */
export function isFluidType(fluid, expectedName) {
    if (!fluid || fluid.empty) return false;
    const actual = String(fluid.name ?? fluid.id ?? '').replace(/^minecraft:/, '');
    const expected = String(expectedName ?? '').replace(/^minecraft:/, '');
    return actual === expected;
}
