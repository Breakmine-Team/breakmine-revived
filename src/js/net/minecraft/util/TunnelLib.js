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

function normalizeServerUrl(serverUrl) {
    if (typeof serverUrl !== 'string' || serverUrl.trim() === '') return serverUrl;

    let url = serverUrl.trim();

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
    
    static defaultServerUrl = null;

    
    constructor(serverUrl) {
        this.serverUrl = normalizeServerUrl(serverUrl || TunnelLib.defaultServerUrl || defaultServerUrl());

         this._ws       = null;
         this._targetWs  = null;
         this._code      = null;
         this._targetUrl = null;
         this._lazy      = true;
         this._closingTarget = false;
         this._onPeerJoin   = null;
         this._onPeerLeave  = null;
         this._pendingToTarget = [];
         this._pendingToTargetBytes = 0;
    }

    
    createTunnel(targetUrl, { lazy = true, maxJoiners = 5 } = {}) {
        this._targetUrl = targetUrl;
        this._lazy      = lazy;

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

                
                if (this._code === null) {
                    let msg;
                    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
                    catch { return; } 

                    if (msg.type === 'created') {
                        clearTimeout(timer);
                        this._code = msg.code;

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

                
                if (isControlFrame(raw)) {
                    try {
                        const ctrl = JSON.parse(raw);
                        if (ctrl.type === 'peer_connected') {
                            if (this._lazy) this._connectTarget();
                            this._onPeerJoin?.(ctrl.peerCount);
                            return;
                        }
                        if (ctrl.type === 'peer_disconnected') {
                            if (ctrl.remaining === 0 && this._lazy) {
                                this._closeTarget();
                            }
                            this._onPeerLeave?.(ctrl.remaining);
                            return;
                        }
                    } catch {  }
                }

                
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
                    ws.send(JSON.stringify({
                        type: 'create',
                        maxJoiners: maxJoiners > 0 ? maxJoiners : 0,
                    }));
                };
                ws.onmessage = handleMessage;
                ws.onerror = () => {  };
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

    
    onPeerJoin(cb) { this._onPeerJoin = cb; }

    
    onPeerLeave(cb) { this._onPeerLeave = cb; }

    
    get code() { return this._code; }

    
    get isActive() { return this._ws !== null && this._ws.readyState === 1; }

    
    close() {
        this._closeTarget();
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
        this._code = null;
    }

    
    _connectTarget() {
        if (this._targetWs) return; 
        this._closingTarget = false;

        try {
            this._targetWs = new IsomorphicWebSocket(this._targetUrl);
        } catch (err) {
            console.error('[TunnelLib] Target connect failed:', err.message);
            return;
        }

        this._targetWs.onopen = () => {
            this._flushPendingToTarget();
        };

        this._targetWs.onmessage = (event) => {
            this._forwardToTunnel(event.data);
        };

        this._targetWs.onclose = () => {
            this._targetWs = null;
            this._pendingToTarget = [];
            this._pendingToTargetBytes = 0;
            if (this._closingTarget) return;
            if (this._ws && this._ws.readyState !== 3) {
                this._ws.close(1000, 'Target closed');
            }
        };

        this._targetWs.onerror = () => {
        };
    }

    
    _forwardToTarget(data) {
        if (this._targetWs && this._targetWs.readyState === 1) {
            this._targetWs.send(data);
            return;
        }

        const size = typeof data === 'string' ? data.length : (data?.byteLength || 0);
        if (this._pendingToTargetBytes + size > 1_048_576) {
            console.warn('[TunnelLib] Dropping frame: loopback target is not ready');
            return;
        }
        this._pendingToTarget.push(data);
        this._pendingToTargetBytes += size;
    }

    
    _flushPendingToTarget() {
        if (!this._targetWs || this._targetWs.readyState !== 1) return;

        const pending = this._pendingToTarget;
        this._pendingToTarget = [];
        this._pendingToTargetBytes = 0;

        for (let i = 0; i < pending.length; i++) {
            if (!this._targetWs || this._targetWs.readyState !== 1) {
                this._pendingToTarget = pending.slice(i);
                this._pendingToTargetBytes = this._pendingToTarget.reduce((sum, frame) => {
                    return sum + (typeof frame === 'string' ? frame.length : (frame?.byteLength || 0));
                }, 0);
                return;
            }
            this._targetWs.send(pending[i]);
        }
    }

    
    _forwardToTunnel(data) {
        if (this._ws && this._ws.readyState === 1) {
            this._ws.send(data);
        }
    }

    _closeTarget() {
        this._pendingToTarget = [];
        this._pendingToTargetBytes = 0;
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


if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TunnelLib };
}

export { TunnelLib };