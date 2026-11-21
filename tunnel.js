'use strict';

const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');

const TUNNEL_PORT       = parseInt(process.env.TUNNEL_PORT, 10) || 6007;
const CODE_LENGTH       = 6;
const CODE_CHARSET      = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I/L)
const TUNNEL_TTL_MS     = 24 * 60 * 60 * 1000; // 24 h before a tunnel without a host is reaped
const MAX_BUFFER_BYTES  = 1 * 1024 * 1024;     // 1 MB per tunnel before a joiner arrives
const JOIN_GRACE_MS     = 2_500;                // wait for a tunnel to appear before rejecting a join
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
     * @param {number}  [opts.ttlMs]           how long a tunnel whose host is gone
     *                                         is kept before it is reaped (default 24 h)
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
        this.server = http.createServer((req, res) => this._onHttpRequest(req, res));
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
     * Start the periodic cleanup of tunnels whose host connection is gone.
     * Call once after `start()`.
     * @param {number} [intervalMs=60000]
     */
    startCleanup(intervalMs = CLEANUP_INTERVAL) {
        this._cleanupHandle = setInterval(() => {
            const now = Date.now();
            for (const [code, tunnel] of this.tunnels) {
                // A tunnel whose host is still connected is live, however old
                // it is, and joiners must keep reaching it. Expiring it by age
                // used to answer "Tunnel not found or expired" for worlds that
                // were still being hosted.
                if (tunnel.provider && tunnel.provider.readyState === 1) continue;

                const lastSeen = tunnel.lastActivityAt ?? tunnel.createdAt;
                if (now - lastSeen < this.ttlMs) continue;

                console.log(`[Tunnel] Expired: ${code} (host connection lost)`);
                for (const j of tunnel.joiners) this._closeWs(j, 1001, 'Host closed the world');
                this.tunnels.delete(code);
            }
        }, intervalMs);
    }

    /** Snapshot of active tunnels and connected peers. */
    get stats() {
        let totalPeers = 0;
        for (const t of this.tunnels.values()) totalPeers += t.joiners.size;
        return { activeTunnels: this.tunnels.size, totalPeers };
    }

    /**
     * Plain-HTTP endpoints on the tunnel port. Only `/health` is served: it
     * reports counts, never join codes or peer identity, so the endpoint can
     * be probed by a load balancer without handing out ways into a world.
     */
    _onHttpRequest(req, res) {
        const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

        if (path === '/health') {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, HEAD' });
                res.end(JSON.stringify({ error: 'Method not allowed' }));
                return;
            }

            const { activeTunnels, totalPeers } = this.stats;
            const body = JSON.stringify({
                status: 'ok',
                activeTunnels,
                totalPeers,
                uptimeSeconds: Math.round(process.uptime()),
            });
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Cache-Control': 'no-store',
            });
            res.end(req.method === 'HEAD' ? undefined : body);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
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
        let handshakePending = false; // a join is waiting for its tunnel to appear

        const cleanupProvider = () => {
            const tunnel = this.tunnels.get(tunnelCode);
            if (!tunnel) return;
            for (const j of tunnel.joiners) this._closeWs(j, 1001, 'Host closed the world');
            this.tunnels.delete(tunnelCode);
        };

        const cleanupJoiner = () => {
            const tunnel = this.tunnels.get(tunnelCode);
            if (!tunnel) return;
            tunnel.joiners.delete(ws);
            tunnel.lastActivityAt = Date.now();
            // Notify provider so it can optionally tear down the target conn
            if (tunnel.provider.readyState === 1) {
                tunnel.provider.send(ctrlMessage('peer_disconnected', {
                    remaining: tunnel.joiners.size,
                }));
            }
        };

        ws.on('message', (data, isBinary) => {
            if (!handshakeDone) {
                if (handshakePending) return; // join in progress: frames cannot be relayed yet
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
                        lastActivityAt: Date.now(),
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
                    handshakePending = true;

                    const code = String(msg.code || '').trim().toUpperCase();

                    this._waitForTunnel(code, ws).then((tunnel) => {
                        handshakePending = false;

                        // The joiner gave up (or dropped) while we were waiting.
                        if (ws.readyState !== 1) return;

                        if (!tunnel) {
                            this._closeWithError(ws, 'Tunnel not found or expired');
                            return;
                        }
                        if (tunnel.joiners.size >= tunnel.maxJoiners) {
                            this._closeWithError(ws, 'Tunnel is full');
                            return;
                        }

                        tunnelCode = code;
                        tunnel.joiners.add(ws);
                        tunnel.lastActivityAt = Date.now();
                        handshakeDone = true;

                        ws.send(JSON.stringify({ type: 'joined', code }));
                        console.log(`[Tunnel] Join: ${code}  (now ${tunnel.joiners.size}/${tunnel.maxJoiners})`);

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
                    });
                    return;
                }

                this._closeWs(ws, 1002, 'Unknown handshake type');
                return;
            }

            const tunnel = this.tunnels.get(tunnelCode);
            if (!tunnel) { this._closeWithError(ws, 'Tunnel not found or expired'); return; }
            tunnel.lastActivityAt = Date.now();

            if (role === 'provider') {
                // Provider -> joiner(s)
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
                // Joiner -> provider
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

    /**
     * Resolve the tunnel for `code`, waiting up to JOIN_GRACE_MS for it to
     * appear. A join can arrive while the host's `create` handshake is still
     * in flight, which used to be answered with "Tunnel not found or expired"
     * for a tunnel that was in fact just being registered.
     *
     * @param {string}    code
     * @param {WebSocket} ws    the joiner, so the wait stops if it goes away
     * @returns {Promise<object|null>} the tunnel record, or null on timeout
     */
    async _waitForTunnel(code, ws) {
        const deadline = Date.now() + JOIN_GRACE_MS;

        for (;;) {
            const tunnel = this.tunnels.get(code);
            if (tunnel) {
                if (tunnel.provider && tunnel.provider.readyState === 1) return tunnel;
                // The host is gone but its close handler has not run yet: do
                // not hand out a tunnel nobody can serve.
                this.tunnels.delete(code);
            }

            if (Date.now() >= deadline || !ws || ws.readyState !== 1) return null;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    /**
     * Send an error frame and then close the socket. The frame is flushed
     * before the close: closing in the same tick can deliver the close first,
     * leaving the client with no message to show the player.
     */
    _closeWithError(ws, message) {
        if (!ws || ws.readyState !== 1) {
            this._closeWs(ws, 1003, message);
            return;
        }

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            this._closeWs(ws, 1003, message);
        };

        // Safety net: never leave a socket open because a flush never fired.
        setTimeout(close, 1_000);
        try {
            ws.send(JSON.stringify({ type: 'error', message }), close);
        } catch {
            close();
        }
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
