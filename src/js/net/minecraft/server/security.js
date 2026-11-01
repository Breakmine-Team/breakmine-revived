// Connection hardening for the standalone multiplayer server.
//
// Two independent layers live here:
//
//   1. Anti-DDoS: refuse floods of new sockets from one address, cap the
//      number of sockets an address may hold open, and rate-limit the messages
//      an established socket can send. Repeat offenders are blocked for a
//      while instead of being hammered on individually.
//
//   2. Anti-VPN: ask an IP-reputation service whether an address belongs to a
//      VPN, proxy or hosting provider and refuse the login when it does.
//      Results are cached (reputation changes slowly), lookups never block the
//      event loop, and a service outage falls back to the configured
//      fail-open/fail-closed behaviour.
//
// Everything in here is inert unless the server is running under Node and a
// real socket request is available, so the singleplayer integrated server
// (which runs inside a browser worker and is reached through a loopback
// adapter) is never affected.
import { createDisconnectPacket } from './packets.js';
import Logger from './logger.js';

const log = Logger;

const ENV = (typeof process !== 'undefined' && process.env) || {};
const IS_NODE = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

function envFlag(name, fallback) {
    const raw = ENV[name];
    if (typeof raw !== 'string' || raw.trim() === '') return fallback;
    const value = raw.trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    return fallback;
}

function envInt(name, fallback, min, max) {
    const parsed = parseInt(ENV[name], 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const trustProxyMode = parseTrustProxyMode();

function parseTrustedProxies(mode) {
    if (mode !== 'list') return [];
    return String(ENV.SERVER_TRUST_PROXY || '')
        .split(',')
        .map((entry) => normalizeAddress(entry))
        .filter(Boolean);
}

export const settings = {
    antiDdos: envFlag('SERVER_ANTIDDOS', true),
    antiVpn: envFlag('SERVER_ANTIVPN', true),
    // "ipapi" needs no account (free, non-commercial, HTTP only). "proxycheck"
    // is more accurate and adds datacenter detection, but needs a key.
    vpnProvider: String(ENV.SERVER_ANTIVPN_PROVIDER || 'ipapi').trim().toLowerCase(),
    vpnKey: String(ENV.SERVER_ANTIVPN_KEY || '').trim(),
    // Datacenter/hosting ranges are blocked by default: a server owner who only
    // wants to stop VPNs (and not, say, cloud-hosted friends) can turn this off.
    blockHosting: envFlag('SERVER_ANTIVPN_BLOCK_HOSTING', true),
    // Fail open keeps the server playable when the reputation service is down.
    vpnFailOpen: envFlag('SERVER_ANTIVPN_FAIL_OPEN', true),
    vpnTimeoutMs: envInt('SERVER_ANTIVPN_TIMEOUT_MS', 3000, 250, 15000),
    // Which peers may tell us who the real client is (see getClientIp).
    //   unset            -> only loopback/LAN peers, i.e. a proxy on this host
    //   true             -> any peer (only safe when this port is not public)
    //   false            -> never trust forwarded headers
    //   <ip>,<ip>,...    -> those peers only
    trustProxyMode,
    trustedProxies: parseTrustedProxies(trustProxyMode)
};

// Flood limits. Generous enough for normal play (a client sends ~20 position
// updates a second) but orders of magnitude below what a spray attack needs.
const CONNECTION_WINDOW_MS = 10 * 1000;
const MAX_CONNECTIONS_PER_WINDOW = 12;
const MAX_CONCURRENT_PER_IP = 5;
const MAX_TOTAL_CONNECTIONS = 256;
const MESSAGE_BURST = 900;
const MESSAGE_REFILL_PER_SECOND = 300;
const MAX_TEXT_MESSAGE_BYTES = 1024 * 1024;
const MAX_BINARY_MESSAGE_BYTES = 4 * 1024 * 1024;

const VIOLATION_WINDOW_MS = 30 * 1000;
const VIOLATION_LIMIT = 12;
const BAN_MS = 10 * 60 * 1000;

const VPN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const VPN_CACHE_MAX_ENTRIES = 5000;
// How many login/movement messages are replayed once a pending VPN verdict
// arrives. A client only sends a handful before it is in game.
const MAX_HELD_MESSAGES = 32;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const bans = new Map(); // ip -> expiresAt
const connectionHistory = new Map(); // ip -> { count, windowStart }
const activeConnections = new Map(); // ip -> open socket count
const violations = new Map(); // ip -> { score, since }
const vpnCache = new Map(); // ip -> { blocked, reason, expires }
let totalConnections = 0;
let warnedNoKey = false;

// ---------------------------------------------------------------------------
// Addressing helpers
// ---------------------------------------------------------------------------

function normalizeAddress(ip) {
    if (!ip) return null;
    let address = String(ip).trim();
    if (!address) return null;
    // IPv4-mapped IPv6 (::ffff:1.2.3.4) and zone ids must not split the cache.
    if (address.startsWith('::ffff:') && address.includes('.')) {
        address = address.slice(7);
    }
    const zone = address.indexOf('%');
    if (zone !== -1) address = address.slice(0, zone);
    return address || null;
}

function parseTrustProxyMode() {
    const raw = String(ENV.SERVER_TRUST_PROXY || '').trim().toLowerCase();
    if (raw === '') return 'local';
    if (['0', 'false', 'no', 'off'].includes(raw)) return 'off';
    if (['1', 'true', 'yes', 'on'].includes(raw)) return 'any';
    return 'list';
}

// A machine that can only be reached by something on this box or this network:
// loopback, RFC1918, link-local, IPv6 ULA. This is the set of peers trusted by
// default, because a public client can never make its source look like one.
// CGNAT (100.64/10) is deliberately not included: those are real clients.
function isPrivatePeer(ip) {
    if (!ip) return false;
    if (ip === '::1') return true;
    if (/^127\./.test(ip)) return true;
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^169\.254\./.test(ip)) return true;
    const lower = ip.toLowerCase();
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80:')) return true;
    return false;
}

function isTrustedPeer(ip) {
    if (!ip) return false;
    if (settings.trustProxyMode === 'any') return true;
    if (settings.trustProxyMode === 'off') return false;
    if (settings.trustedProxies.includes(ip)) return true;
    return settings.trustProxyMode === 'local' && isPrivatePeer(ip);
}

/**
 * Address the game should treat as the player's.
 *
 * Behind the play.breakmine.com reverse proxy every socket comes from the
 * proxy, so the per-IP flood limits and the VPN verdict would otherwise all be
 * shared by every player. When the peer is a trusted proxy the real address is
 * taken from the headers it sets: CF-Connecting-IP first (Cloudflare always
 * overwrites it), then the last X-Forwarded-For entry, which is the address the
 * proxy itself saw rather than anything the client typed.
 */
export function getClientIp(req) {
    if (!req) return null;

    const socket = req.socket || req.connection;
    const peer = normalizeAddress(socket && socket.remoteAddress);

    if (!isTrustedPeer(peer)) {
        return peer;
    }

    const headers = req.headers || {};
    const cfAddress = headers['cf-connecting-ip'];
    if (typeof cfAddress === 'string' && cfAddress.trim()) {
        const forwardedClient = normalizeAddress(cfAddress.split(',')[0]);
        if (forwardedClient) return forwardedClient;
    }

    const forwarded = headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        const hops = forwarded.split(',').map((hop) => normalizeAddress(hop)).filter(Boolean);
        if (hops.length > 0) return hops[hops.length - 1];
    }

    return peer;
}

// Loopback, LAN and CGNAT addresses are never looked up: they are not public
// VPN endpoints, and looking them up only burns the provider's rate limit.
function isLocalAddress(ip) {
    if (!ip) return true;
    if (ip === '::1' || ip === '0.0.0.0' || ip === '::') return true;
    if (/^127\./.test(ip)) return true;
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^169\.254\./.test(ip)) return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
    const lower = ip.toLowerCase();
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // IPv6 ULA
    if (lower.startsWith('fe80:')) return true; // IPv6 link-local
    return false;
}

function isBanned(ip, now) {
    const until = bans.get(ip);
    if (!until) return false;
    if (until > now) return true;
    bans.delete(ip);
    return false;
}

function ban(ip, reason) {
    bans.set(ip, Date.now() + BAN_MS);
    log.warn('Security', `Temporarily blocked ${ip} for ${Math.round(BAN_MS / 60000)} min (${reason})`);
}

function countViolation(ip, reason) {
    const now = Date.now();
    let record = violations.get(ip);
    if (!record || now - record.since > VIOLATION_WINDOW_MS) {
        record = { score: 0, since: now };
        violations.set(ip, record);
    }
    record.score += 1;
    if (record.score >= VIOLATION_LIMIT) {
        violations.delete(ip);
        ban(ip, reason);
        return true;
    }
    return false;
}

function releaseConnection(ip) {
    const open = (activeConnections.get(ip) || 1) - 1;
    if (open <= 0) activeConnections.delete(ip);
    else activeConnections.set(ip, open);
    totalConnections = Math.max(0, totalConnections - 1);
}

// ---------------------------------------------------------------------------
// Admission control (ws `verifyClient`): runs before the HTTP upgrade
// completes, so refused clients never get a WebSocket.
// ---------------------------------------------------------------------------

/**
 * Decide whether a new upgrade may open a socket.
 *
 * @returns {{accepted: boolean, ip?: string, code?: number, message?: string, reason?: string}}
 */
export function verifyConnection(info) {
    if (!IS_NODE || !settings.antiDdos) {
        return { accepted: true };
    }

    const req = info && info.req;
    const ip = getClientIp(req);
    if (!ip) {
        return { accepted: true };
    }

    const now = Date.now();

    if (isBanned(ip, now)) {
        return {
            accepted: false,
            ip,
            code: 403,
            message: 'Your address is temporarily blocked.',
            reason: 'address is temporarily blocked'
        };
    }

    if (totalConnections >= MAX_TOTAL_CONNECTIONS) {
        return {
            accepted: false,
            ip,
            code: 503,
            message: 'Server is full, try again later.',
            reason: `total connection cap (${MAX_TOTAL_CONNECTIONS}) reached`
        };
    }

    const open = activeConnections.get(ip) || 0;
    if (open >= MAX_CONCURRENT_PER_IP) {
        countViolation(ip, 'too many concurrent sockets');
        return {
            accepted: false,
            ip,
            code: 429,
            message: 'Too many connections from your address.',
            reason: `${open} sockets already open`
        };
    }

    let history = connectionHistory.get(ip);
    if (!history || now - history.windowStart > CONNECTION_WINDOW_MS) {
        history = { count: 0, windowStart: now };
        connectionHistory.set(ip, history);
    }
    history.count += 1;
    if (history.count > MAX_CONNECTIONS_PER_WINDOW) {
        const banned = countViolation(ip, 'connection flood');
        return {
            accepted: false,
            ip,
            code: 429,
            message: 'Too many connection attempts, slow down.',
            reason: banned
                ? `connection flood (${history.count} attempts in ${CONNECTION_WINDOW_MS / 1000}s), banned`
                : `connection flood (${history.count} attempts in ${CONNECTION_WINDOW_MS / 1000}s)`
        };
    }

    activeConnections.set(ip, open + 1);
    totalConnections += 1;

    // The socket may close before (or without) the WebSocket handshake
    // finishing, so release the slot from the socket itself.
    const socket = req && (req.socket || req.connection);
    if (socket && typeof socket.once === 'function') {
        socket.once('close', () => releaseConnection(ip));
    }

    return { accepted: true, ip };
}

// ---------------------------------------------------------------------------
// Anti-VPN lookups
// ---------------------------------------------------------------------------

function readVpnCache(ip, now) {
    const entry = vpnCache.get(ip);
    if (!entry) return null;
    if (entry.expires <= now) {
        vpnCache.delete(ip);
        return null;
    }
    return entry;
}

function writeVpnCache(ip, blocked, reason) {
    if (vpnCache.size >= VPN_CACHE_MAX_ENTRIES) {
        // Map keeps insertion order: drop the oldest verdict.
        const oldest = vpnCache.keys().next();
        if (!oldest.done) vpnCache.delete(oldest.value);
    }
    vpnCache.set(ip, { blocked, reason, expires: Date.now() + VPN_CACHE_TTL_MS });
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.vpnTimeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function lookupIpApi(ip) {
    const data = await fetchJson(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,proxy,hosting,countryCode`
    );
    if (!data || data.status !== 'success') {
        throw new Error((data && data.message) || 'lookup failed');
    }
    if (data.proxy === true) {
        return { blocked: true, reason: 'VPN or proxy' };
    }
    if (settings.blockHosting && data.hosting === true) {
        return { blocked: true, reason: 'datacenter/hosting address' };
    }
    return { blocked: false, reason: '' };
}

async function lookupProxycheck(ip) {
    const data = await fetchJson(
        `https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(settings.vpnKey)}&vpn=1&asn=1`
    );
    if (!data || (data.status !== 'ok' && data.status !== 'warning')) {
        throw new Error((data && data.message) || 'lookup failed');
    }
    const entry = data[ip] || {};
    if (String(entry.proxy).toLowerCase() === 'yes') {
        const type = String(entry.type || 'VPN').trim();
        return { blocked: true, reason: `${type.toLowerCase()} address` };
    }
    if (settings.blockHosting && /hosting|datacenter|server/i.test(String(entry.type || ''))) {
        return { blocked: true, reason: 'datacenter/hosting address' };
    }
    return { blocked: false, reason: '' };
}

async function lookupVpn(ip) {
    const wantsProxycheck = settings.vpnProvider === 'proxycheck' || settings.vpnProvider === 'proxycheck.io';
    if (wantsProxycheck) {
        if (settings.vpnKey) {
            return lookupProxycheck(ip);
        }
        if (!warnedNoKey) {
            warnedNoKey = true;
            log.warn('Security', 'SERVER_ANTIVPN_PROVIDER=proxycheck needs SERVER_ANTIVPN_KEY; falling back to ip-api.com');
        }
    }
    return lookupIpApi(ip);
}

/**
 * Resolve whether an address may join. Never throws: a failed lookup resolves
 * to the configured fail-open/fail-closed verdict.
 */
export function checkAddress(ip) {
    const address = normalizeAddress(ip);
    if (!address || !settings.antiVpn || isLocalAddress(address)) {
        return Promise.resolve({ blocked: false, reason: '', skipped: true });
    }

    const cached = readVpnCache(address, Date.now());
    if (cached) {
        return Promise.resolve({ blocked: cached.blocked, reason: cached.reason });
    }

    return lookupVpn(address)
        .then((verdict) => {
            writeVpnCache(address, verdict.blocked, verdict.reason);
            return verdict;
        })
        .catch((error) => {
            if (settings.vpnFailOpen) {
                log.warn('Security', `VPN check for ${address} failed (${error.message}); allowing connection`);
                return { blocked: false, reason: '', error: error.message };
            }
            log.warn('Security', `VPN check for ${address} failed (${error.message}); refusing connection`);
            return { blocked: true, reason: 'address could not be verified' };
        });
}

// ---------------------------------------------------------------------------
// Per-connection gate
// ---------------------------------------------------------------------------

function messageSize(message) {
    if (typeof message === 'string') return message.length;
    if (message && typeof message.byteLength === 'number') return message.byteLength;
    if (message && typeof message.length === 'number') return message.length;
    return 0;
}

/**
 * Build the per-socket gate. Returns null when there is no real socket (the
 * integrated singleplayer server) or when both protections are disabled.
 */
export function createConnectionGate(req, ws) {
    if (!IS_NODE || !req || (!settings.antiDdos && !settings.antiVpn)) {
        return null;
    }

    const ip = getClientIp(req);
    if (!ip) return null;

    const gate = {
        ip,
        // Called by the caller for each message released after a pending VPN
        // verdict, so buffered messages re-enter the normal handler.
        onFlush: null,
        held: [],
        tokens: MESSAGE_BURST,
        lastRefill: Date.now(),
        closed: false,
        denied: false,
        vpnPending: settings.antiVpn && !isLocalAddress(ip),
        vpnAllowed: !settings.antiVpn || isLocalAddress(ip),
        ws
    };

    function closeSocket() {
        if (gate.closed) return;
        gate.closed = true;
        try {
            if (ws && ws.readyState === 1) ws.close();
        } catch (e) {
            // Closing an already-broken socket is not an error.
        }
    }

    function deny(reason) {
        gate.denied = true;
        gate.held.length = 0;
        try {
            if (ws && ws.readyState === 1) {
                ws.send(createDisconnectPacket(`§c${reason}`));
            }
        } catch (e) {
            // Fall through to the close below.
        }
        log.info('Security', `Refused ${ip}: ${reason}`);
        closeSocket();
    }

    function refillTokens() {
        const now = Date.now();
        const elapsed = (now - gate.lastRefill) / 1000;
        if (elapsed <= 0) return;
        gate.lastRefill = now;
        gate.tokens = Math.min(
            MESSAGE_BURST,
            gate.tokens + elapsed * MESSAGE_REFILL_PER_SECOND
        );
    }

    gate.beforeMessage = function beforeMessage(message, isBinary) {
        if (gate.closed) return 'drop';

        if (settings.antiDdos) {
            // A socket opened before its address was blocked must not keep
            // talking after the block went in.
            if (isBanned(ip, Date.now())) {
                closeSocket();
                return 'drop';
            }

            const limit = isBinary ? MAX_BINARY_MESSAGE_BYTES : MAX_TEXT_MESSAGE_BYTES;
            if (messageSize(message) > limit) {
                countViolation(ip, 'oversized message');
                closeSocket();
                return 'drop';
            }

            refillTokens();
            if (gate.tokens < 1) {
                const banned = countViolation(ip, 'message flood');
                if (banned) {
                    closeSocket();
                }
                return 'drop';
            }
            gate.tokens -= 1;
        }

        if (gate.denied) return 'drop';

        if (gate.vpnPending) {
            if (gate.held.length < MAX_HELD_MESSAGES) {
                gate.held.push({ message, isBinary });
            }
            return 'hold';
        }

        return gate.vpnAllowed ? 'ok' : 'drop';
    };

    gate.dispose = function dispose() {
        gate.closed = true;
        gate.held.length = 0;
    };

    if (gate.vpnPending) {
        checkAddress(ip)
            .then((verdict) => {
                if (gate.closed) return;
                gate.vpnPending = false;
                if (verdict.blocked) {
                    deny(`Connections through a ${verdict.reason || 'VPN or proxy'} are not allowed on this server.`);
                    return;
                }
                gate.vpnAllowed = true;
                const queued = gate.held.splice(0);
                if (typeof gate.onFlush === 'function') {
                    for (const entry of queued) {
                        gate.onFlush(entry.message, entry.isBinary);
                    }
                }
            })
            .catch((error) => {
                gate.vpnPending = false;
                gate.vpnAllowed = true;
                log.warn('Security', `VPN gate for ${ip} failed open: ${error.message}`);
                const queued = gate.held.splice(0);
                if (typeof gate.onFlush === 'function') {
                    for (const entry of queued) {
                        gate.onFlush(entry.message, entry.isBinary);
                    }
                }
            });
    }

    return gate;
}

// ---------------------------------------------------------------------------
// Maintenance + startup summary
// ---------------------------------------------------------------------------

function sweep() {
    const now = Date.now();

    for (const [ip, until] of bans) {
        if (until <= now) bans.delete(ip);
    }
    for (const [ip, record] of violations) {
        if (now - record.since > VIOLATION_WINDOW_MS) violations.delete(ip);
    }
    for (const [ip, history] of connectionHistory) {
        if (now - history.windowStart > CONNECTION_WINDOW_MS && !activeConnections.has(ip)) {
            connectionHistory.delete(ip);
        }
    }
    for (const [ip, entry] of vpnCache) {
        if (entry.expires <= now) vpnCache.delete(ip);
    }
}

if (IS_NODE) {
    const timer = setInterval(sweep, 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
}

/** One-line summary for the startup log. */
export function describeSettings() {
    const parts = [];

    if (settings.antiDdos) {
        parts.push(
            `anti-DDoS on (${MAX_CONNECTIONS_PER_WINDOW} connections/${CONNECTION_WINDOW_MS / 1000}s per IP, ` +
            `${MAX_CONCURRENT_PER_IP} concurrent, ${MAX_TOTAL_CONNECTIONS} total)`
        );
    } else {
        parts.push('anti-DDoS off');
    }

    if (settings.trustProxyMode === 'any') {
        parts.push('trusting forwarded client IPs from any peer (bind this port to the proxy only)');
    } else if (settings.trustProxyMode === 'off') {
        parts.push('client IPs taken from the socket (forwarded headers ignored)');
    } else if (settings.trustProxyMode === 'list') {
        parts.push(`trusting forwarded client IPs from ${settings.trustedProxies.join(', ')}`);
    } else {
        parts.push('trusting forwarded client IPs from loopback/LAN proxies');
    }

    if (settings.antiVpn) {
        const provider = settings.vpnProvider === 'proxycheck' || settings.vpnProvider === 'proxycheck.io'
            ? (settings.vpnKey ? 'proxycheck.io' : 'ip-api.com (proxycheck key missing)')
            : 'ip-api.com';
        parts.push(
            `anti-VPN on via ${provider}` +
            `${settings.blockHosting ? ', datacenter addresses blocked' : ''}` +
            `${settings.vpnFailOpen ? ', fail-open' : ', fail-closed'}`
        );
    } else {
        parts.push('anti-VPN off');
    }

    return parts.join('; ');
}
