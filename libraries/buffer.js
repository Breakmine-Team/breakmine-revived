// Self-contained, browser-safe Buffer for the raw (non-bundled) client.
//
// The browser cannot resolve the bare `buffer` specifier, so every module that
// needs Buffer imports this file instead of `'buffer'`. It re-exports the
// vendored buffer polyfill (libraries/buffer.polyfill.js, built from the
// `buffer` npm package) in the browser, and Node's native Buffer when running
// under Node so that `Buffer.isBuffer()` keeps accepting ws' native buffers.
import bufferModule from './buffer.polyfill.js';

const isNode =
    typeof process !== 'undefined' &&
    !!process.versions &&
    !!process.versions.node;

export const Buffer = isNode && typeof globalThis.Buffer !== 'undefined'
    ? globalThis.Buffer
    : bufferModule.Buffer;

export const SlowBuffer = isNode && typeof globalThis.SlowBuffer !== 'undefined'
    ? globalThis.SlowBuffer
    : bufferModule.SlowBuffer;

export const INSPECT_MAX_BYTES = 50;

export const kMaxLength = isNode
    ? (globalThis.Buffer && globalThis.Buffer.kMaxLength)
    : bufferModule.kMaxLength;
