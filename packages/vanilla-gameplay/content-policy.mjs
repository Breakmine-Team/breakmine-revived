// Product exclusions, not a modification of the pinned reference registries.
// Preserve native state IDs so existing saves still decode without data loss.
export function isExcludedVanillithContent(identifier) {
    if (typeof identifier !== 'string') return false;
    return false;
}
