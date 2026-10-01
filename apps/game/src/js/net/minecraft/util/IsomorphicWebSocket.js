const isNode = typeof window === 'undefined' && typeof process !== 'undefined';

let NativeWS = null;
let NativeServer = null;

if (isNode) {
    try {
        const wsModule = await import('ws');
        NativeWS = wsModule.WebSocket || wsModule.default;
        NativeServer = wsModule.WebSocketServer || wsModule.Server;
    } catch {
        if (typeof globalThis.WebSocket !== 'undefined') {
            NativeWS = globalThis.WebSocket;
        }
    }
} else {
    NativeWS = window.WebSocket;
}

export class LoopbackServer {
    #listeners = new Set();
    #worker = null;
    #nextSocketId = 1;
    #relays = new Map();

    onConnection(callback) {
        this.#listeners.add(callback);
    }

    offConnection(callback) {
        this.#listeners.delete(callback);
    }

    // When an integrated-server worker is attached, new client connections
    // are forwarded to it instead of being handled in-process: the server's
    // connection handler runs inside the worker, and both sides of the socket
    // traffic are relayed as socket-connect / socket-message / socket-close
    // postMessages (see handleWorkerMessage and integrated.worker.js).
    attachWorker(worker) {
        this.#worker = worker;
    }

    #post(message, transfer) {
        if (!this.#worker) return;
        if (transfer) {
            this.#worker.postMessage(message, transfer);
        } else {
            this.#worker.postMessage(message);
        }
    }

    connectClient(clientSocket) {
        if (this.#worker) {
            const socketId = this.#nextSocketId++;
            const serverSocket = new LoopbackSocket('server');

            clientSocket._pair(serverSocket);
            serverSocket._pair(clientSocket);

            // Client -> worker.
            serverSocket.onmessage = (event) => {
                const data = event && event.data;
                if (typeof data === 'string') {
                    this.#post({ type: 'socket-message', socketId, data, isBinary: false });
                    return;
                }
                let payload = data;
                if (data instanceof ArrayBuffer) {
                    payload = data;
                } else if (ArrayBuffer.isView(data)) {
                    payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                } else {
                    this.#post({ type: 'socket-message', socketId, data: String(data), isBinary: false });
                    return;
                }
                this.#post({ type: 'socket-message', socketId, data: payload, isBinary: true }, [payload]);
            };
            serverSocket.onclose = () => {
                this.#relays.delete(socketId);
                this.#post({ type: 'socket-close', socketId });
            };

            this.#relays.set(socketId, { client: clientSocket, server: serverSocket });
            this.#post({ type: 'socket-connect', socketId });
            return;
        }

        const serverSocket = new LoopbackSocket('server');

        clientSocket._pair(serverSocket);
        serverSocket._pair(clientSocket);

        setTimeout(() => {
            serverSocket._readyState = 1;
            clientSocket._readyState = 1;

            this.#listeners.forEach((listener) => listener(serverSocket));

            const openEvent = new Event('open');
            if (typeof clientSocket.onopen === 'function') {
                clientSocket.onopen(openEvent);
            }
            clientSocket.dispatchEvent(openEvent);
        }, 0);
    }

    // Worker -> client: open/message/close events for relayed connections.
    handleWorkerMessage(msg) {
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'socket-open') {
            const relay = this.#relays.get(msg.socketId);
            if (!relay) return;
            relay.server._readyState = 1;
            relay.client._readyState = 1;

            const openEvent = new Event('open');
            if (typeof relay.client.onopen === 'function') {
                relay.client.onopen(openEvent);
            }
            relay.client.dispatchEvent(openEvent);
            return;
        }

        if (msg.type === 'socket-message') {
            const relay = this.#relays.get(msg.socketId);
            if (!relay) return;
            const messageEvent = new MessageEvent('message', { data: msg.data });
            if (typeof relay.client.onmessage === 'function') {
                relay.client.onmessage(messageEvent);
            }
            relay.client.dispatchEvent(messageEvent);
            return;
        }

        if (msg.type === 'socket-close') {
            const relay = this.#relays.get(msg.socketId);
            if (!relay) return;
            this.#relays.delete(msg.socketId);
            relay.client._readyState = 3;
            relay.server._readyState = 3;

            const closeEvent = new CloseEvent('close', { code: msg.code || 1000, reason: msg.reason || '' });
            if (typeof relay.client.onclose === 'function') {
                relay.client.onclose(closeEvent);
            }
            relay.client.dispatchEvent(closeEvent);
        }
    }
}

export const globalLoopbackServer = new LoopbackServer();

export class LoopbackSocket extends EventTarget {
    #peer = null;

    constructor(role = 'client') {
        super();
        this.role = role;
        this._readyState = 0;
        this.binaryType = 'arraybuffer';

        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
    }

    get readyState() {
        return this._readyState;
    }

    _pair(peerSocket) {
        this.#peer = peerSocket;
    }

    send(data) {
        if (this._readyState !== 1) {
            throw new Error('WebSocket is not open');
        }

        let formattedData = data;
        if (this.binaryType === 'arraybuffer' && data instanceof ArrayBuffer) {
            formattedData = data;
        } else if (ArrayBuffer.isView(data)) {
            formattedData = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }

        setTimeout(() => {
            if (!this.#peer || this.#peer.readyState !== 1) return;

            const messageEvent = new MessageEvent('message', { data: formattedData });
            if (typeof this.#peer.onmessage === 'function') {
                this.#peer.onmessage(messageEvent);
            }
            this.#peer.dispatchEvent(messageEvent);
        }, 0);
    }

    close(code = 1000, reason = '') {
        if (this._readyState === 3) return;
        this._readyState = 3;

        setTimeout(() => {
            const closeEvent = new CloseEvent('close', { code, reason, wasClean: true });

            if (typeof this.onclose === 'function') this.onclose(closeEvent);
            this.dispatchEvent(closeEvent);

            if (this.#peer && this.#peer.readyState !== 3) {
                this.#peer._readyState = 3;
                if (typeof this.#peer.onclose === 'function') this.#peer.onclose(closeEvent);
                this.#peer.dispatchEvent(closeEvent);
            }
        }, 0);
    }
}

export class TunnelSocket extends EventTarget {
    _readyState = 0; // CONNECTING
    binaryType = 'arraybuffer';
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;

    /**
     * @param {string} code       The tunnel join code (e.g. "AB3X9Z")
     * @param {string} [serverUrl] Full ws:// URL of the tunnel server.
     *                            Auto-detected when omitted.
     */
    constructor(code, serverUrl) {
        super();

        this._ws = null;
        this._handshakeDone = false;
        this._code = code;

        // Resolve server URL
        const resolvedUrl = serverUrl || IsomorphicWebSocket.tunnelServerUrl || (() => {
            const proto = isNode ? 'ws' : (location.protocol === 'https:' ? 'wss:' : 'ws');
            return `${proto}://tunnel.breakmine.com`;
        })();

        // Always try wss:// first, then fall back to ws://
        const fallbacks = [];
        if (resolvedUrl.startsWith('wss://')) {
            fallbacks.push(resolvedUrl, resolvedUrl.replace('wss://', 'ws://'));
        } else {
            fallbacks.push(resolvedUrl.replace('ws://', 'wss://'), resolvedUrl);
        }

        const WS = NativeWS || (typeof WebSocket !== 'undefined' ? WebSocket : null);
        if (!WS) {
            this._readyState = 3;
            const err = new Error('No native WebSocket available for tunnel connection');
            this.onerror?.(err);
            this.dispatchEvent(new Event('error'));
            const closeEv = new CloseEvent('close', { code: 1006, reason: err.message, wasClean: false });
            this.onclose?.(closeEv);
            this.dispatchEvent(closeEv);
            return;
        }

        const connectNext = () => {
            const url = fallbacks.shift();
            if (!url) {
                this._readyState = 3;
                const closeEv = new CloseEvent('close', { code: 1006, reason: 'All tunnel connection attempts failed', wasClean: false });
                if (typeof this.onclose === 'function') this.onclose(closeEv);
                this.dispatchEvent(closeEv);
                return;
            }

            let ws;
            try {
                ws = new WS(url);
            } catch (err) {
                if (fallbacks.length > 0) {
                    connectNext();
                    return;
                }
                this._readyState = 3;
                const errorEvent = new Event('error');
                if (typeof this.onerror === 'function') this.onerror(errorEvent);
                this.dispatchEvent(errorEvent);
                const closeEv = new CloseEvent('close', { code: 1006, reason: err.message, wasClean: false });
                if (typeof this.onclose === 'function') this.onclose(closeEv);
                this.dispatchEvent(closeEv);
                return;
            }
            ws.binaryType = this.binaryType;
            this._ws = ws;

            ws.onopen = () => {
                // Send join handshake
                ws.send(JSON.stringify({ type: 'join', code: this._code }));
            };

            ws.onmessage = (event) => {
                if (!this._handshakeDone) {
                    let msg;
                    try {
                        msg = JSON.parse(
                            typeof event.data === 'string'
                                ? event.data
                                : new TextDecoder().decode(event.data),
                        );
                    } catch { return; }

                    if (msg.type === 'joined') {
                        this._handshakeDone = true;
                        this._readyState = 1;
                        const openEvent = new Event('open');
                        if (typeof this.onopen === 'function') this.onopen(openEvent);
                        this.dispatchEvent(openEvent);
                        return;
                    }
                    if (msg.type === 'error') {
                        this._readyState = 3;
                        const errorEvent = new Event('error');
                        if (typeof this.onerror === 'function') this.onerror(errorEvent);
                        this.dispatchEvent(errorEvent);
                        const closeEvent = new CloseEvent('close', {
                            code: 1003,
                            reason: msg.message || 'Tunnel error',
                            wasClean: false,
                        });
                        if (typeof this.onclose === 'function') this.onclose(closeEvent);
                        this.dispatchEvent(closeEvent);
                        this._ws?.close();
                        return;
                    }
                    return;
                }

                // Relay: forward as a normal message event
                const messageEvent = new MessageEvent('message', { data: event.data });
                if (typeof this.onmessage === 'function') this.onmessage(messageEvent);
                this.dispatchEvent(messageEvent);
            };

            ws.onclose = (event) => {
                if (this._ws !== ws) return;
                if (this._readyState === 3) return;
                if (!this._handshakeDone && fallbacks.length > 0) {
                    this._ws = null;
                    connectNext();
                    return;
                }
                this._readyState = 3;
                const closeEvent = new CloseEvent('close', {
                    code: event.code || 1006,
                    reason: event.reason || '',
                    wasClean: event.wasClean || false,
                });
                if (typeof this.onclose === 'function') this.onclose(closeEvent);
                this.dispatchEvent(closeEvent);
            };

            ws.onerror = () => {
                const errorEvent = new Event('error');
                if (typeof this.onerror === 'function') this.onerror(errorEvent);
                this.dispatchEvent(errorEvent);
            };
        };

        connectNext();
    }

    get readyState() {
        return this._readyState;
    }

    send(data) {
        if (this._readyState !== 1) {
            throw new Error('WebSocket is not open');
        }
        this._ws.send(data);
    }

    close(code = 1000, reason = '') {
        if (this._readyState === 3) return;
        this._readyState = 3;
        if (this._ws) this._ws.close(code, reason);
    }
}

export class IsomorphicWebSocket extends EventTarget {
    #socket = null;
    #binaryType = 'arraybuffer';
    /** Global default tunnel server URL. Set once to override auto-detection. */
    static tunnelServerUrl = null;

    #userOnOpen = null;
    #userOnMessage = null;
    #userOnError = null;
    #userOnClose = null;

    constructor(url, options = {}) {
        super();
        this.url = url;
        
        const isUrlLoopback = typeof url === 'string' && (
            url === 'ws://loopback' || 
            url === 'wss://loopback' || 
            url.startsWith('loopback://') || 
            url === 'loopback'
        );
        const isUrlTunnel = typeof url === 'string' && url.startsWith('tunnel://');
        
        this.isLoopback = options.loopback || isUrlLoopback;
        this.isTunnel = isUrlTunnel;

        if (this.isTunnel) {
            const code = url.replace('tunnel://', '');
            const serverUrl = options.tunnelServerUrl || IsomorphicWebSocket.tunnelServerUrl;
            this.#socket = new TunnelSocket(code, serverUrl);
            this.#setupInternalForwarding();
        } else if (this.isLoopback) {
            this.#socket = new LoopbackSocket('client');
            this.#setupInternalForwarding();
            globalLoopbackServer.connectClient(this.#socket);
        } else {
            if (!NativeWS) {
                throw new Error('No native WebSocket engine found in this runtime environment.');
            }
            this.#socket = new NativeWS(url, options.protocols);
            this.#socket.binaryType = this.#binaryType;
            this.#setupNativeForwarding();
        }
    }

    get readyState() {
        return this.#socket.readyState;
    }

    get binaryType() {
        return this.#binaryType;
    }

    set binaryType(val) {
        this.#binaryType = val;
        if (this.#socket) {
            this.#socket.binaryType = val;
        }
    }

    send(data) {
        this.#socket.send(data);
    }

    close(code, reason) {
        this.#socket.close(code, reason);
    }

    get onopen() {
        return (this.isLoopback || this.isTunnel) ? this.#socket.onopen : this.#userOnOpen;
    }

    set onopen(fn) {
        if (this.isLoopback || this.isTunnel) {
            this.#socket.onopen = fn;
        } else {
            this.#userOnOpen = fn;
        }
    }

    get onmessage() {
        return (this.isLoopback || this.isTunnel) ? this.#socket.onmessage : this.#userOnMessage;
    }

    set onmessage(fn) {
        if (this.isLoopback || this.isTunnel) {
            this.#socket.onmessage = fn;
        } else {
            this.#userOnMessage = fn;
        }
    }

    get onerror() {
        return (this.isLoopback || this.isTunnel) ? this.#socket.onerror : this.#userOnError;
    }

    set onerror(fn) {
        if (this.isLoopback || this.isTunnel) {
            this.#socket.onerror = fn;
        } else {
            this.#userOnError = fn;
        }
    }

    get onclose() {
        return (this.isLoopback || this.isTunnel) ? this.#socket.onclose : this.#userOnClose;
    }

    set onclose(fn) {
        if (this.isLoopback || this.isTunnel) {
            this.#socket.onclose = fn;
        } else {
            this.#userOnClose = fn;
        }
    }

    // Clone the event to avoid "The event is already being dispatched" errors.
    // queueMicrotask can run before the native dispatch loop finishes, so
    // deferring doesn't work reliably.
    #forwardEvent(e) {
        let clonedEvent;

        if (typeof MessageEvent !== 'undefined' && e instanceof MessageEvent) {
            clonedEvent = new MessageEvent(e.type, {
                data: e.data,
                origin: e.origin,
                lastEventId: e.lastEventId,
                source: e.source,
                ports: e.ports
            });
        } else if (typeof CloseEvent !== 'undefined' && e instanceof CloseEvent) {
            clonedEvent = new CloseEvent(e.type, {
                code: e.code,
                reason: e.reason,
                wasClean: e.wasClean
            });
        } else {
            clonedEvent = new Event(e.type, {
                bubbles: e.bubbles,
                cancelable: e.cancelable,
                composed: e.composed
            });
        }

        this.dispatchEvent(clonedEvent);
    }

    /** Forward events from LoopbackSocket or TunnelSocket → this (addEventListener). */
    #setupInternalForwarding() {
        ['open', 'message', 'error', 'close'].forEach((event) => {
            this.#socket.addEventListener(event, (e) => this.#forwardEvent(e));
        });
    }

    #setupNativeForwarding() {
        this.#socket.onopen = (e) => {
            if (typeof this.#userOnOpen === 'function') this.#userOnOpen(e);
            this.#forwardEvent(e);
        };
        this.#socket.onmessage = (e) => {
            if (typeof this.#userOnMessage === 'function') this.#userOnMessage(e);
            this.#forwardEvent(e);
        };
        this.#socket.onerror = (e) => {
            if (typeof this.#userOnError === 'function') this.#userOnError(e);
            this.#forwardEvent(e);
        };
        this.#socket.onclose = (e) => {
            if (typeof this.#userOnClose === 'function') this.#userOnClose(e);
            this.#forwardEvent(e);
        };
    }
}

export class IsomorphicServer {
    static create(options = {}, connectionCallback) {
        if (isNode && NativeServer) {
            const wss = new NativeServer(options);
            if (connectionCallback) wss.on('connection', connectionCallback);
            return wss;
        }

        if (connectionCallback) {
            globalLoopbackServer.onConnection(connectionCallback);
        }
        return globalLoopbackServer;
    }
}

export default IsomorphicWebSocket;