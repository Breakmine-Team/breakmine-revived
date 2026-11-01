/**
 * Look up a library that index.html loaded as a classic/module script
 * (`pako`, `aesjs`, `sha1`, `ASN1`, `bigint-mod-arith`).
 *
 * This lives in its own module on purpose. It used to be exported from
 * Start.js, which made every network module import the entry point:
 *
 *     Start.js -> Minecraft.js -> NetworkManager.js -> Start.js
 *
 * That cycle is harmless when the browser evaluates Start.js as the entry
 * module, but a bundler is free to emit Start's body before Minecraft's class
 * declaration, and then `Minecraft.VERSION` throws "Cannot access 'Minecraft'
 * before initialization". Importing this tiny leaf module instead keeps the
 * entry point out of the network import graph.
 */
export function require(module) {
    return window[module];
}

export default require;
