const noModulesFlag =
    (typeof globalThis !== 'undefined' && globalThis.NO_MODULES === true) ||
    (typeof process !== 'undefined' &&
        Array.isArray(process.argv) &&
        process.argv.includes('--no-modules'));

export const NO_MODULES = noModulesFlag;

export const IS_BROWSER =
    typeof window !== 'undefined' && typeof window.document !== 'undefined';
