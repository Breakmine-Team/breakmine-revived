export const VANILLA_WORLD_TYPE = 'vanilla_26_3';
export const VANILLITH_VERSION = '0.2.0-alpha';
export const VANILLITH_VERSION_LABEL = `Vanillith ${VANILLITH_VERSION}`;
export const VANILLA_WORLDGEN_READY = false;
export const VANILLA_WORLDGEN_PREVIEW_READY = true;
export const VANILLA_WORLDGEN_MESSAGE = `${VANILLITH_VERSION_LABEL} — a playable work in progress.`;

export function summarizeVanillaWorldgenError(error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown terrain error');
    const mappings = message.match(/Unsupported render mappings? for vanilla states:\s*([\s\S]*)/i);
    if (mappings) {
        const names = [...new Set([...mappings[1].matchAll(/\d+\s+\(([^)]+)\)/g)].map(match => match[1].replace(/^minecraft:/, '')))];
        if (names.length) {
            const shown = names.slice(0, 3).join(', ');
            const more = names.length > 3 ? ` + ${names.length - 3} more` : '';
            return `${names.length} block render mappings missing: ${shown}${more}`;
        }
    }
    return message.split('\n', 1)[0];
}

export function assertWorldGeneratorReady(worldType) {
    if (worldType === VANILLA_WORLD_TYPE && !VANILLA_WORLDGEN_READY) {
        throw new Error(`Full Vanillith world generation is in development. ${VANILLA_WORLDGEN_MESSAGE}`);
    }
}
