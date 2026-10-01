'use strict';

import IsomorphicWebSocket from "./IsomorphicWebSocket.js";

const isNode = typeof window === 'undefined' && typeof process !== 'undefined';

let NativeWS;

if (isNode) {
    try {
        const mod = require('ws');
        NativeWS = mod.WebSocket || mod.default;
    } catch {
        throw new Error('[TunnelLib] ws module is required in Node.js.  npm install ws');
    }
} else {
    if (typeof WebSocket === 'undefined') {
        throw new Error('[TunnelLib] Native WebSocket not available in this environment.');
    }
    NativeWS = WebSocket;
}

const CTRL_KEY     = '__tunnel_ctrl__';

function defaultServerUrl() {
    return normalizeServerUrl(typeof location !== 'undefined' ? location.hostname : 'localhost');
}

/** Normalize a tunnel server URL/hostname into an absolute WebSocket URL. */
function normalizeServerUrl(serverUrl) {
    if (typeof serverUrl !== 'string' || serverUrl.trim() === '') return serverUrl;

    let url = serverUrl.trim();

    // Prepend scheme if missing (e.g. "tunnel.breakmine.com" -> "wss://tunnel.breakmine.com")
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
        const proto = isNode ? 'ws' : (typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws');
        url = `${proto}://${url}`;
    }

    return url;
}

function isControlFrame(data) {
    if (typeof data !== 'string') return false;
    try {
        const obj = JSON.parse(data);
        return obj && obj[CTRL_KEY] === true;
    } catch {
        return false;
    }
}

class TunnelLib {
    /** Global default tunnel server URL. Overrides auto-detection. */
    static defaultServerUrl = null;

    /** @param {string} [serverUrl] Falls back to static default, then auto-detect. */
    constructor(serverUrl) {
        this.serverUrl = normalizeServerUrl(serverUrl || TunnelLib.defaultServerUrl || defaultServerUrl());

        /** @private */ this._ws       = null;
        /** @private */ this._targetWs  = null;
        /** @private */ this._code      = null;
        /** @private */ this._targetUrl = null;
        /** @private */ this._lazy      = true;
        /** @private */ this._closingTarget = false;
        /** @private */ this._onPeerJoin   = null;
        /** @private */ this._onPeerLeave  = null;
    }

    /**
     * Create a tunnel that forwards to `targetUrl`.
     *
     * @param {string} targetUrl  The loopback / local WebSocket to expose
     *                             (e.g. `ws://localhost:25565`, `ws://loopback`).
     * @param {object} [opts]
     * @param {boolean} [opts.lazy=true]       Connect to target only when a peer
     *                                         joins.  Set `false` to connect eagerly.
     * @param {number}  [opts.maxJoiners=5]    Max simultaneous joiners (0 = unlimited).
     * @returns {Promise<string>}  The short join code (e.g. `"AB3X9Z"`).
     */
    createTunnel(targetUrl, { lazy = true, maxJoiners = 5 } = {}) {
        this._targetUrl = targetUrl;
        this._lazy      = lazy;

        // Always try wss:// first, then fall back to ws://
        const fallbacks = [];
        if (this.serverUrl.startsWith('wss://')) {
            fallbacks.push(this.serverUrl, this.serverUrl.replace('wss://', 'ws://'));
        } else {
            fallbacks.push(this.serverUrl.replace('ws://', 'wss://'), this.serverUrl);
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._closeServer();
                reject(new Error('[TunnelLib] Tunnel creation timed out'));
            }, 15_000);

            const handleMessage = (event) => {
                const raw = event.data;

                /* ---- Handshake response ---- */
                if (this._code === null) {
                    let msg;
                    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
                    catch { return; } // ignore non-JSON before handshake

                    if (msg.type === 'created') {
                        clearTimeout(timer);
                        this._code = msg.code;

                        // Eagerly connect the target if not lazy
                        if (!this._lazy) this._connectTarget();

                        resolve(msg.code);
                        return;
                    }
                    if (msg.type === 'error') {
                        clearTimeout(timer);
                        reject(new Error(msg.message || '[TunnelLib] Tunnel creation failed'));
                        return;
                    }
                    return;
                }

                /* ---- Post-handshake: control or relay ---- */
                if (isControlFrame(raw)) {
                    try {
                        const ctrl = JSON.parse(raw);
                        if (ctrl.type === 'peer_connected') {
                            if (this._lazy) this._connectTarget();
                            this._onPeerJoin?.(ctrl.peerCount);
                            return;
                        }
                        if (ctrl.type === 'peer_disconnected') {
                            // Optionally close target when last peer leaves
                            if (ctrl.remaining === 0 && this._lazy) {
                                this._closeTarget();
                            }
                            this._onPeerLeave?.(ctrl.remaining);
                            return;
                        }
                    } catch { /* fall through to relay */ }
                }

                /* ---- Relay: joiner data → target ---- */
                this._forwardToTarget(raw);
            };

            const connectNext = () => {
                const url = fallbacks.shift();
                if (!url) {
                    clearTimeout(timer);
                    reject(new Error('[TunnelLib] Connection to tunnel server failed'));
                    return;
                }

                let ws;
                try {
                    ws = new NativeWS(url);
                } catch (err) {
                    if (fallbacks.length > 0) {
                        connectNext();
                    } else {
                        clearTimeout(timer);
                        reject(err);
                    }
                    return;
                }
                this._ws = ws;
                ws.binaryType = 'arraybuffer';

                ws.onopen = () => {
                    // Send create handshake with options
                    ws.send(JSON.stringify({
                        type: 'create',
                        maxJoiners: maxJoiners > 0 ? maxJoiners : 0,
                    }));
                };
                ws.onmessage = handleMessage;
                ws.onerror = () => { /* 'close' will follow */ };
                ws.onclose = () => {
                    if (this._ws !== ws) return;
                    if (this._code === null && fallbacks.length > 0) {
                        this._ws = null;
                        connectNext();
                    } else {
                        this._closeTarget();
                        this._code = null;
                    }
                };
            };

            connectNext();
        });
    }

    /**
     * Register a callback invoked when a peer joins the tunnel.
     * @param {(peerCount: number) => void} cb
     */
    onPeerJoin(cb) { this._onPeerJoin = cb; }

    /**
     * Register a callback invoked when a peer leaves the tunnel.
     * @param {(remaining: number) => void} cb
     */
    onPeerLeave(cb) { this._onPeerLeave = cb; }

    /** The assigned tunnel code, or `null` if not yet created. */
    get code() { return this._code; }

    /** Whether the tunnel is currently active (provider connected to server). */
    get isActive() { return this._ws !== null && this._ws.readyState === 1; }

    /** Close the tunnel and all underlying connections. */
    close() {
        this._closeTarget();
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
        this._code = null;
    }

    /** Open a WebSocket to the target and wire up bidirectional relay. */
    _connectTarget() {
        if (this._targetWs) return; // already connected
        this._closingTarget = false;

        try {
            this._targetWs = new IsomorphicWebSocket(this._targetUrl);
        } catch (err) {
            console.error('[TunnelLib] Target connect failed:', err.message);
            return;
        }

        this._targetWs.onmessage = (event) => {
            this._forwardToTunnel(event.data);
        };

        this._targetWs.onclose = () => {
            this._targetWs = null;
            // If we closed the target ourselves (e.g. the last peer left while
            // lazy), keep the tunnel alive so the join slot stays open. Only a
            // genuine target failure tears the tunnel down.
            if (this._closingTarget) return;
            if (this._ws && this._ws.readyState !== 3) {
                this._ws.close(1000, 'Target closed');
            }
        };

        this._targetWs.onerror = () => {
            // 'close' will follow
        };
    }

    /** Forward a frame from the tunnel server (joiner data) → target. */
    _forwardToTarget(data) {
        if (this._targetWs && this._targetWs.readyState === 1) {
            this._targetWs.send(data);
        }
    }

    /** Forward a frame from the target → tunnel server (→ joiners). */
    _forwardToTunnel(data) {
        if (this._ws && this._ws.readyState === 1) {
            this._ws.send(data);
        }
    }

    _closeTarget() {
        if (this._targetWs) {
            this._closingTarget = true;
            this._targetWs.close();
            this._targetWs = null;
        }
    }

    _closeServer() {
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
    }
}

// CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TunnelLib };
}
// ES module default export (also available as named)
export { TunnelLib };