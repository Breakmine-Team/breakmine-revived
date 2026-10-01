'use strict';

const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');

const TUNNEL_PORT       = parseInt(process.env.TUNNEL_PORT, 10) || 6007;
const CODE_LENGTH       = 6;
const CODE_CHARSET      = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I/L)
const TUNNEL_TTL_MS     = 24 * 60 * 60 * 1000; // 24 h default lifetime
const MAX_BUFFER_BYTES  = 1 * 1024 * 1024;     // 1 MB per tunnel before a joiner arrives
const CLEANUP_INTERVAL  = 60_000;               // check for expired tunnels every minute

const CTRL_KEY = '__tunnel_ctrl__';

function isControlFrame(data) {
    if (typeof data !== 'string') return false;
    try {
        const obj = JSON.parse(data);
        return obj && obj[CTRL_KEY] === true;
    } catch {
        return false;
    }
}

function ctrlMessage(type, extra = {}) {
    return JSON.stringify({ [CTRL_KEY]: true, type, ...extra });
}

class TunnelServer {
    /**
     * @param {object}  [opts]
     * @param {number}  [opts.port=6007]
     * @param {string}  [opts.host='0.0.0.0']
     * @param {number}  [opts.ttlMs]           tunnel lifetime in ms (default 24 h)
     * @param {number}  [opts.maxPayload]      max frame size in bytes (default 10 MB)
     */
    constructor({ port = TUNNEL_PORT, host = '0.0.0.0', ttlMs, maxPayload } = {}) {
        this.port  = port;
        this.host  = host;
        this.ttlMs = ttlMs ?? TUNNEL_TTL_MS;

        /** @type {Map<string, { provider: WebSocket, joiners: Set<WebSocket>, maxJoiners: number, createdAt: number, buffer: Array<{data, isBinary}> | null }>} */
        this.tunnels = new Map();

        this.wss    = null;
        this.server = null;
        this._cleanupHandle = null;
    }

    /** Start listening. Returns a promise that resolves once the server is up. */
    start() {
        this.server = http.createServer();
        this.wss = new WebSocketServer({
            server: this.server,
            maxPayload: 10 * 1024 * 1024,
        });

        this.wss.on('connection', (ws, _req) => this._onConnection(ws));

        return new Promise((resolve, reject) => {
            this.server.on('error', reject);
            this.server.listen(this.port, this.host, () => {
                console.log(`[Tunnel] Listening on ${this.host}:${this.port}`);
                resolve();
            });
        });
    }

    /** Gracefully stop. */
    stop() {
        if (this._cleanupHandle) clearInterval(this._cleanupHandle);

        for (const [, tunnel] of this.tunnels) {
            this._closeWs(tunnel.provider, 1001, 'Server shutting down');
            for (const j of tunnel.joiners) this._closeWs(j, 1001, 'Server shutting down');
        }
        this.tunnels.clear();

        return new Promise((resolve) => {
            if (!this.wss) return resolve();
            this.wss.close(() => {
                this.server.close(() => resolve());
            });
        });
    }

    /**
     * Start the periodic expired-tunnel cleanup.  Call once after `start()`.
     * @param {number} [intervalMs=60000]
     */
    startCleanup(intervalMs = CLEANUP_INTERVAL) {
        this._cleanupHandle = setInterval(() => {
            const now = Date.now();
            for (const [code, tunnel] of this.tunnels) {
                if (now - tunnel.createdAt > this.ttlMs) {
                    console.log(`[Tunnel] Expired: ${code}`);
                    this._closeWs(tunnel.provider, 1001, 'Tunnel expired');
                    for (const j of tunnel.joiners) this._closeWs(j, 1001, 'Tunnel expired');
                    this.tunnels.delete(code);
                }
            }
        }, intervalMs);
    }

    /** Snapshot of active tunnels and connected peers. */
    get stats() {
        let totalPeers = 0;
        for (const t of this.tunnels.values()) totalPeers += t.joiners.size;
        return { activeTunnels: this.tunnels.size, totalPeers };
    }

    /** Generate a short, human-friendly join code. */
    _generateCode() {
        const bytes = crypto.randomBytes(CODE_LENGTH);
        let code = '';
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
        }
        return code;
    }

    /**
     * Handle every incoming WebSocket connection.
     * The first text frame MUST be a JSON handshake (`create` or `join`).
     * After the handshake the connection enters pure-relay mode.
     */
    _onConnection(ws) {
        let role = null;        // 'provider' | 'joiner'
        let tunnelCode = null;  // code string
        let handshakeDone = false;

        const cleanupProvider = () => {
            const tunnel = this.tunnels.get(tunnelCode);
            if (!tunnel) return;
            for (const j of tunnel.joiners) this._closeWs(j, 1001, 'Provider disconnected');
            this.tunnels.delete(tunnelCode);
        };

        const cleanupJoiner = () => {
            const tunnel = this.tunnels.get(tunnelCode);
            if (!tunnel) return;
            const wasEmpty = tunnel.joiners.size === 0;
            tunnel.joiners.delete(ws);
            // Notify provider so it can optionally tear down the target conn
            if (tunnel.provider.readyState === 1) {
                tunnel.provider.send(ctrlMessage('peer_disconnected', {
                    remaining: tunnel.joiners.size,
                }));
            }
        };

        ws.on('message', (data, isBinary) => {
            if (!handshakeDone) {
                if (isBinary) { this._closeWs(ws, 1002, 'Expected text handshake'); return; }

                let msg;
                try { msg = JSON.parse(data.toString()); } catch { this._closeWs(ws, 1002, 'Invalid JSON'); return; }

                if (msg.type === 'create') {
                    role = 'provider';

                    let code = this._generateCode();
                    let attempts = 0;
                    while (this.tunnels.has(code) && attempts < 200) {
                        code = this._generateCode();
                        attempts++;
                    }

                    tunnelCode = code;
                    const maxJoiners = (typeof msg.maxJoiners === 'number' && msg.maxJoiners > 0)
                        ? msg.maxJoiners : 5;

                    this.tunnels.set(code, {
                        provider: ws,
                        joiners: new Set(),
                        maxJoiners,
                        createdAt: Date.now(),
                        buffer: [],
                    });

                    handshakeDone = true;
                    ws.send(JSON.stringify({ type: 'created', code }));
                    console.log(`[Tunnel] Created: ${code}  (max ${maxJoiners} joiner${maxJoiners === 1 ? '' : 's'})`);
                    return;
                }

                // --- Joiner: attach to an existing tunnel ---
                if (msg.type === 'join') {
                    role = 'joiner';
                    const tunnel = this.tunnels.get(msg.code);

                    if (!tunnel) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Tunnel not found or expired' }));
                        this._closeWs(ws, 1003, 'Tunnel not found');
                        return;
                    }
                    if (tunnel.joiners.size >= tunnel.maxJoiners) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Tunnel is full' }));
                        this._closeWs(ws, 1003, 'Tunnel full');
                        return;
                    }

                    tunnelCode = msg.code;
                    tunnel.joiners.add(ws);
                    handshakeDone = true;

                    ws.send(JSON.stringify({ type: 'joined', code: msg.code }));
                    console.log(`[Tunnel] Join: ${msg.code}  (now ${tunnel.joiners.size}/${tunnel.maxJoiners})`);

                    // Flush any data the provider already sent
                    if (tunnel.buffer && tunnel.buffer.length > 0) {
                        for (const frame of tunnel.buffer) {
                            if (ws.readyState === 1) ws.send(frame.data, { binary: frame.isBinary });
                        }
                        tunnel.buffer = null;
                    }

                    // Notify provider so it can (e.g.) lazily connect the target
                    if (tunnel.provider.readyState === 1) {
                        tunnel.provider.send(ctrlMessage('peer_connected', {
                            peerCount: tunnel.joiners.size,
                        }));
                    }
                    return;
                }

                this._closeWs(ws, 1002, 'Unknown handshake type');
                return;
            }

            const tunnel = this.tunnels.get(tunnelCode);
            if (!tunnel) { this._closeWs(ws, 1003, 'Tunnel gone'); return; }

            if (role === 'provider') {
                // Provider → joiner(s)
                if (tunnel.joiners.size === 0) {
                    // Buffer until a joiner arrives
                    if (tunnel.buffer) {
                        const totalSize = tunnel.buffer.reduce(
                            (s, f) => s + (typeof f.data === 'string' ? f.data.length : (f.data.byteLength || 0)), 0,
                        );
                        if (totalSize < MAX_BUFFER_BYTES) {
                            tunnel.buffer.push({ data, isBinary });
                        }
                    }
                    return;
                }
                for (const j of tunnel.joiners) {
                    if (j.readyState === 1) j.send(data, { binary: isBinary });
                }
            } else {
                // Joiner → provider
                if (tunnel.provider.readyState === 1) {
                    tunnel.provider.send(data, { binary: isBinary });
                }
            }
        });

        ws.on('close', () => {
            if (role === 'provider') cleanupProvider();
            else if (role === 'joiner') cleanupJoiner();
        });

        ws.on('error', () => {
            // ws will emit 'close' immediately after
        });
    }

    /** Helper: close a ws without throwing if already closing/closed. */
    _closeWs(ws, code, reason) {
        if (!ws || ws.readyState === 2 || ws.readyState === 3) return;
        try { ws.close(code, reason); } catch { /* ignore */ }
    }
}

if (require.main === module) {
    const srv = new TunnelServer();
    srv.startCleanup();
    srv.start().catch((err) => {
        console.error('[Tunnel] Failed to start:', err.message);
        process.exit(1);
    });

    const shutdown = () => srv.stop().then(() => process.exit(0));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

module.exports = { TunnelServer };
