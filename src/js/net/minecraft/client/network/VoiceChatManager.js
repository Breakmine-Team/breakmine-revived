import { Peer } from "../../../../../../libraries/peerjs.js";

/**
 * P2P voice chat (push-to-talk).
 *
 * - Uses peerjs (WebRTC) for the actual audio connections, so voice traffic
 *   goes peer-to-peer and never through the game server.
 * - Peer discovery uses the game server's JSON relay channel: every client
 *   with voice enabled periodically announces its peerjs ID via
 *   NetworkManager.sendJson({ type: 'voice', ... }); the server broadcasts
 *   that to all other players. Peers then dial each other directly.
 * - Mesh call model: incoming calls are answered with a silent placeholder
 *   stream (so the SDP negotiation is always valid) and each client only ever
 *   transmits on its own outgoing calls. Every peer pair therefore ends up
 *   with two strictly one-way audio links, which cannot echo or double up.
 * - Push-to-talk: holding the "voice chat" key enables the local mic track.
 *   Audio connections stay open in the background; between presses the mic
 *   track is disabled, which surfaces as a 'mute' event on remote tracks.
 * - Opt-in: a client only starts dialing/listening after the user pressed the
 *   push-to-talk key at least once this session.
 * - Status: type "/voice" in chat to dump the current session state.
 */

const ANNOUNCE_INTERVAL = 3000;   // ms between peer ID announcements
const PEER_TIMEOUT = 12000;       // ms without an announce before a peer is dropped
const HEARING_RANGE = 40;         // distance (blocks) at which voices fade out entirely
const LINK_RETRY_DELAY = 8000;    // ms before re-dialing an outgoing link that has no audio yet
const LINK_MAX_RETRIES = 6;       // how many times a dead link may be re-dialed

// STUN servers map public IPs/ports to let peers route UDP traffic directly.
// TURN servers relay the media stream when a direct peer-to-peer connection
// cannot be established (symmetric NATs, guest Wi-Fi, some carrier networks).
// Default TURN: the free public relay at openrelay.metered.ca. Self-hosting a
// coturn instance is strongly recommended for heavy use; point the game
// settings at it via voiceTurnUrls / voiceTurnUsername / voiceTurnPassword.
const DEFAULT_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
];

// Fast, dependency-free string hash used to derive a stable peerjs ID.
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + (h2 >>> 0).toString(36);
}

export default class VoiceChatManager {

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.enabled = false;        // opt-in via first push-to-talk press
        this.talking = false;        // currently holding push-to-talk

        this.peer = null;
        this.peerSuffix = "";        // bumped if our preferred peer ID is taken
        this.ensuringPeer = false;

        this.localStream = null;
        this.micTrack = null;

        this.silentStream = null;    // placeholder stream for receive-only answers
        this.silentContext = null;

        this.remoteInfo = new Map(); // peerId -> { username, lastSeen }
        this.byUsername = new Map(); // username -> peerId
        this.dialed = new Map();     // peerId -> connectionId (own outgoing calls)
        this.calls = new Map();      // connectionId -> { call, peerId, username, audio, talking, outgoing, createdAt, retries }

        this.announceTimer = null;
        this.tickCounter = 0;

        this.warnedUnavailable = false;
        this.warnedNoMic = false;

        // Peerjs internals + negotiation flow are logged here to make it easy
        // to check on the console whether calls connect and streams flow.
        console.log("[Voice] Voice chat manager initialized");
    }

    /** Local player's username. */
    getUsername() {
        const session = this.minecraft.getSession();
        return session ? session.getProfile().getUsername() : "";
    }

    /** Stable peerjs ID derived from the username (a reconnect keeps its ID). */
    getPeerId() {
        return "bmvc-" + cyrb53(this.getUsername() + "|" + this.peerSuffix);
    }

    /** ICE servers for WebRTC: STUN for discovery + a TURN relay fallback.
     *  The settings allow pointing at a self-hosted coturn instance. */
    getIceServers() {
        const settings = this.minecraft.settings;
        const customUrls = (settings.voiceTurnUrls || "").trim();

        if (customUrls) {
            const urls = customUrls.split(",").map(url => url.trim()).filter(Boolean);
            const username = (settings.voiceTurnUsername || "").trim();
            const credential = (settings.voiceTurnPassword || "").trim();
            if (urls.length) {
                // STUN is still useful alongside a custom TURN server.
                return [
                    { urls: "stun:stun.l.google.com:19302" },
                    username && credential
                        ? { urls, username, credential }
                        : { urls }
                ];
            }
        }

        return DEFAULT_ICE_SERVERS;
    }

    /** True when connected to a (real or integrated) multiplayer server. */
    isAvailable() {
        return this.minecraft.isInGame() && !this.minecraft.isSingleplayer();
    }

    getNetworkManager() {
        const controller = this.minecraft.playerController;
        if (!controller || !controller.getNetworkHandler) return null;
        return controller.getNetworkHandler().getNetworkManager();
    }

    ///////////////////////////////////////////////////////////////////////////
    // Push-to-talk handling
    ///////////////////////////////////////////////////////////////////////////

    /** Called when the voice chat key is pressed down. */
    onKeyPressed() {
        if (!this.isAvailable()) {
            if (!this.warnedUnavailable) {
                this.warnedUnavailable = true;
                this.minecraft.addMessageToChat("\u00a77Voice chat is only available in multiplayer");
            }
            return;
        }

        // First press opts the player into voice chat: announce and start listening.
        if (!this.enabled) {
            this.enabled = true;
            this.ensurePeer();
            this.startAnnouncements();
            this.minecraft.addMessageToChat("\u00a77Voice chat enabled - hold \u00a7fO\u00a77 to talk (works within \u00a7f" + Math.floor(HEARING_RANGE) + "\u00a77 blocks)");
            console.log("[Voice] Enabled, username=" + this.getUsername());
        }

        this.startTalking();
    }

    /** Called when the voice chat key is released (even with a screen open). */
    onKeyReleased() {
        if (!this.talking) return;
        this.talking = false;
        if (this.micTrack) {
            this.micTrack.enabled = false;
        }
    }

    startTalking() {
        this.talking = true;
        console.log("[Voice] Push-to-talk start (micTrack=" + (this.micTrack ? "ready/enabled" : "not requested yet") + ")");

        if (this.micTrack) {
            this.micTrack.enabled = true;
        } else {
            this.ensureMic().then(ok => {
                if (ok) {
                    if (this.micTrack) this.micTrack.enabled = this.talking;
                    if (this.enabled) {
                        console.log("[Voice] Microphone acquired, dialing known peers");
                        this.dialKnownPeers();
                    }
                }
            });
        }

        this.dialKnownPeers();
    }

    async ensureMic() {
        if (this.localStream) return true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
            this.localStream = stream;
            this.micTrack = stream.getAudioTracks()[0] || null;
            if (this.micTrack) this.micTrack.enabled = false; // muted until push-to-talk
            console.log("[Voice] Microphone stream acquired (track=" + (this.micTrack ? this.micTrack.id.slice(0, 8) : "none") + ")");
            return true;
        } catch (err) {
            console.error("[Voice] getUserMedia failed:", err);
            if (!this.warnedNoMic) {
                this.warnedNoMic = true;
                this.minecraft.addMessageToChat("\u00a7cMicrophone access denied - voice chat unavailable");
            }
            return false;
        }
    }

    ///////////////////////////////////////////////////////////////////////////
    // Peerjs session
    ///////////////////////////////////////////////////////////////////////////

    ensurePeer() {
        if (this.peer || this.ensuringPeer) return;
        this.ensuringPeer = true;

        const peer = new Peer(this.getPeerId(), {
            // Log peerjs negotiation internals to the browser console.
            debug: 2,
            // WebRTC connection candidates: STUN + TURN relay fallback.
            config: { iceServers: this.getIceServers() }
        });
        this.peer = peer;

        peer.on("open", id => {
            this.ensuringPeer = false;
            console.log("[Voice] Peer open, id=" + id);
            this.sendAnnounce();
            this.dialKnownPeers();
        });

        peer.on("call", call => this.answerCall(call));

        peer.on("error", err => {
            if (err.type === "unavailable-id") {
                // Someone else took our ID (username collision) - retry with a suffix.
                this.ensuringPeer = false;
                console.warn("[Voice] Peer ID taken, retrying with a random suffix");
                try { this.peer.destroy(); } catch (e) { /* ignore */ }
                this.peer = null;
                this.peerSuffix = Date.now().toString(36);
                this.ensurePeer();
            } else if (err.type === "peer-unavailable") {
                // A dialed peer is not (yet) online; announcements retry later.
                console.warn("[Voice] Dialed peer is not online yet");
            } else {
                console.error("[Voice] Peer error:", err.type, err);
                this.minecraft.addMessageToChat("\u00a7cVoice chat error: " + err.type);
            }
        });

        peer.on("disconnected", () => {
            console.warn("[Voice] Disconnected from signaling server");
        });

        peer.on("close", () => {
            console.log("[Voice] Peer session closed");
        });
    }

    /** Silent audio stream used to answer calls we only listen on. */
    getSilentStream() {
        if (!this.silentStream) {
            this.silentContext = new AudioContext();
            const destination = this.silentContext.createMediaStreamDestination();
            const oscillator = this.silentContext.createOscillator();
            const gain = this.silentContext.createGain();
            gain.gain.value = 0; // true silence
            oscillator.connect(gain);
            gain.connect(destination);
            oscillator.start();
            this.silentStream = destination.stream;
            console.log("[Voice] Created silent placeholder stream");
        }
        return this.silentStream;
    }

    /** Register an outgoing or answered call and its audio plumbing. */
    registerCall(call, { peerId, username, outgoing }) {
        const connectionId = call.connectionId;
        if (this.calls.has(connectionId)) return;

        const record = {
            call, peerId, username, audio: null, talking: false, outgoing,
            createdAt: Date.now(), retries: 0
        };
        this.calls.set(connectionId, record);
        if (outgoing) {
            this.dialed.set(peerId, connectionId);
        }

        call.on("stream", stream => this.attachAudio(connectionId, stream, record));
        const onClose = () => this.closeCall(connectionId);
        call.on("close", onClose);
        call.on("error", onClose);
        console.log("[Voice] Call registered (" + (outgoing ? "outgoing dial" : "incoming") + ", peerId=" + peerId + ", connectionId=" + connectionId + ")");
    }

    dial(peerId, username) {
        if (!this.enabled || !this.peer || !this.peer.open || !this.localStream) return;
        if (peerId === this.peer.id || this.dialed.has(peerId)) return;

        const call = this.peer.call(peerId, this.localStream);
        if (!call) return;
        this.registerCall(call, { peerId, username, outgoing: true });
    }

    dialKnownPeers(force = false) {
        if (!this.enabled) return;
        for (const [username, peerId] of this.byUsername) {
            if (force) {
                const connectionId = this.dialed.get(peerId);
                if (connectionId) this.closeCall(connectionId);
            }
            this.dial(peerId, username);
        }
    }

    answerCall(call) {
        if (!this.enabled) {
            // Player has not opted in yet - the call stays unanswered and the
            // other side's dead-link retry will try again once we enabled.
            console.log("[Voice] Incoming call ignored (voice chat not enabled yet, peer=" + call.peer + ")");
            return;
        }

        // Answer with a silent placeholder: the connection stays valid SDP-wise
        // but this link stays receive-only. Our own audio goes out via our
        // outgoing dial to the same peer, so no link is ever both ways.
        call.answer(this.getSilentStream());
        this.registerCall(call, {
            peerId: call.peer,
            username: (this.remoteInfo.get(call.peer) || {}).username || "",
            outgoing: false
        });
    }

    attachAudio(connectionId, stream, record) {
        // The remote end of an outgoing call only ever sends the other side's
        // silent placeholder (they transmit via their own dial), so ignore it.
        if (record.outgoing) return;

        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.style.display = "none";
        audio.srcObject = stream;
        document.body.appendChild(audio);
        audio.play().then(() => {
            console.log("[Voice] Remote audio playing (from " + (record.username || record.peerId) + ")");
        }).catch(err => {
            console.error("[Voice] Audio play() rejected (autoplay blocked?):", err);
            // Autoplay blocked - retry on the next push-to-talk gesture and
            // periodically from onTick (once the user has interacted, play() is
            // usually allowed).
            record.pendingPlay = true;
        });
        record.audio = audio;

        const track = stream.getAudioTracks()[0];
        if (track) {
            // The sender toggles track.enabled for push-to-talk, which fires
            // these events on the receiving side.
            track.onmute = () => { record.talking = false; };
            track.onunmute = () => { record.talking = true; };
        }
    }

    retryPendingAudio() {
        for (const record of this.calls.values()) {
            if (record.pendingPlay && record.audio) {
                record.pendingPlay = false;
                record.audio.play().then(() => {
                    console.log("[Voice] Pending remote audio resumed");
                }).catch(() => {
                    record.pendingPlay = true;
                });
            }
        }
    }

    closeCall(connectionId) {
        const record = this.calls.get(connectionId);
        if (!record) return;
        try { record.call.close(); } catch (e) { /* ignore */ }
        if (record.audio) {
            record.audio.srcObject = null;
            record.audio.remove();
        }
        this.calls.delete(connectionId);
        if (record.outgoing && this.dialed.get(record.peerId) === connectionId) {
            this.dialed.delete(record.peerId);
        }
        console.log("[Voice] Call closed (connectionId=" + connectionId + ")");
    }

    ///////////////////////////////////////////////////////////////////////////
    // Discovery via the game server JSON relay
    ///////////////////////////////////////////////////////////////////////////

    startAnnouncements() {
        if (this.announceTimer) return;
        this.announceTimer = setInterval(() => {
            if (!this.enabled) return;
            this.sendAnnounce();
            if (!this.peer) this.ensurePeer();
            // Re-check peers that came online since our last dial attempt.
            this.dialKnownPeers();
        }, ANNOUNCE_INTERVAL);
    }

    sendAnnounce() {
        if (!this.peer || !this.peer.open) return;
        const nm = this.getNetworkManager();
        if (!nm) return;
        nm.sendJson({
            type: "voice",
            action: "announce",
            username: this.getUsername(),
            peerId: this.peer.id
        });
    }

    /** Incoming relay message forwarded by NetworkManager. */
    handleRelayMessage(payload) {
        if (payload.action !== "announce") return;
        const username = String(payload.username || "").slice(0, 32);
        const peerId = String(payload.peerId || "");
        if (!username || !peerId || !/^[a-zA-Z0-9_-]{1,64}$/.test(peerId)) return;
        if (peerId === (this.peer && this.peer.id)) return; // echo of ourselves

        console.log("[Voice] Announce received: " + username + " -> " + peerId);

        const info = this.remoteInfo.get(peerId);
        if (info) {
            info.lastSeen = Date.now();
        } else {
            this.remoteInfo.set(peerId, { username, lastSeen: Date.now() });
        }

        // A peer may have re-announced with a new ID after an ID collision.
        const previousId = this.byUsername.get(username);
        if (previousId && previousId !== peerId) {
            const oldConnectionId = this.dialed.get(previousId);
            this.remoteInfo.delete(previousId);
            this.dialed.delete(previousId);
            if (oldConnectionId) this.closeCall(oldConnectionId);
            for (const [connectionId, record] of Array.from(this.calls)) {
                if (record.peerId === previousId) {
                    this.closeCall(connectionId);
                }
            }
        }
        this.byUsername.set(username, peerId);

        this.dial(peerId, username);
    }

    ///////////////////////////////////////////////////////////////////////////
    // Periodic upkeep (called on every game tick while in game)
    ///////////////////////////////////////////////////////////////////////////

    onTick() {
        if (!this.enabled) return;
        this.tickCounter++;

        const now = Date.now();

        // Retry audio playback blocked by autoplay policies; once the user has
        // interacted with the page this is normally allowed.
        if (this.tickCounter % 40 === 0) {
            this.retryPendingAudio();
        }

        // Drop peers that stopped announcing (left the server or exited voice chat).
        for (const [peerId, info] of this.remoteInfo) {
            if (now - info.lastSeen > PEER_TIMEOUT) {
                console.log("[Voice] Peer timed out: " + (info.username || peerId));
                this.remoteInfo.delete(peerId);
                this.dialed.delete(peerId);
                for (const [connectionId, record] of Array.from(this.calls)) {
                    if (record.peerId === peerId) {
                        this.closeCall(connectionId);
                    }
                }
            }
        }
        for (const username of Array.from(this.byUsername.keys())) {
            if (!this.remoteInfo.has(this.byUsername.get(username))) {
                this.byUsername.delete(username);
            }
        }

        // Re-dial outgoing links that never received remote audio (the other
        // side probably enabled voice chat after we first dialed them).
        for (const [connectionId, record] of Array.from(this.calls)) {
            if (record.outgoing && !record.audio
                && now - record.createdAt > LINK_RETRY_DELAY
                && record.retries < LINK_MAX_RETRIES) {
                record.retries++;
                console.log("[Voice] Re-dialing peer without audio (" + record.retries + "/" + LINK_MAX_RETRIES + "): " + record.peerId);
                this.closeCall(connectionId);
            }
        }

        // Distance-based volume for every established call.
        for (const record of this.calls.values()) {
            if (!record.audio) continue;
            record.audio.volume = this.getVolumeForUsername(record.username);
        }
    }

    getVolumeForUsername(username) {
        const world = this.minecraft.world;
        const player = this.minecraft.player;
        if (!world || !player || !username) return 1.0;

        let entity = null;
        for (const e of world.entities) {
            if (e.username === username) {
                entity = e;
                break;
            }
        }
        if (!entity) return 1.0; // out of render distance / unknown - play at full volume

        const dx = entity.x - player.x;
        const dy = entity.y - player.y;
        const dz = entity.z - player.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance >= HEARING_RANGE) return 0.0;
        const factor = 1.0 - distance / HEARING_RANGE;
        return Math.min(1.0, 0.15 + 0.85 * factor * factor);
    }

    /** Names of everyone currently talking (including the local player). */
    getTalkers() {
        const names = [];
        if (this.talking) {
            names.push(this.getUsername());
        }
        for (const record of this.calls.values()) {
            if (record.talking && record.username && record.username !== this.getUsername()) {
                names.push(record.username);
            }
        }
        return names;
    }

    /** Human-readable session dump used by the "/voice" command. */
    getStatusLines() {
        const lines = [];
        lines.push("voice: " + (this.enabled ? "on" : "off") + " | talking: " + (this.talking ? "yes" : "no"));
        lines.push("peer id: " + (this.peer ? this.peer.id + (this.peer.open ? " (open)" : " (not open)") : "none"));
        const turnUrls = this.getIceServers()
            .filter(server => server.urls && String(server.urls).startsWith("turn"))
            .map(server => server.urls);
        lines.push("turn: " + (turnUrls.length ? turnUrls.join(", ") : "none"));
        lines.push("mic: " + (this.micTrack ? (this.micTrack.enabled ? "unmuted" : "muted") : "none"));
        lines.push("known peers: " + (this.byUsername.size ? [...this.byUsername].map(([u, p]) => u + " -> " + p).join(", ") : "none"));
        const callLines = [];
        for (const record of this.calls.values()) {
            const dir = record.outgoing ? "out" : "in";
            const state = record.audio ? "audio" : "no-audio";
            callLines.push(dir + " " + (record.username || record.peerId) + " " + state + (record.talking ? " [talking]" : ""));
        }
        lines.push("calls: " + (callLines.length ? callLines.join(", ") : "none"));
        return lines;
    }

    ///////////////////////////////////////////////////////////////////////////
    // Teardown
    ///////////////////////////////////////////////////////////////////////////

    /** Called when the connection to the server drops or the world is left. */
    reset() {
        console.log("[Voice] Resetting voice chat session");
        this.talking = false;
        this.enabled = false;

        for (const connectionId of Array.from(this.calls.keys())) {
            this.closeCall(connectionId);
        }
        this.calls.clear();
        this.remoteInfo.clear();
        this.byUsername.clear();
        this.dialed.clear();

        if (this.peer) {
            try { this.peer.destroy(); } catch (e) { /* ignore */ }
            this.peer = null;
        }
        this.ensuringPeer = false;

        if (this.localStream) {
            for (const track of this.localStream.getTracks()) {
                track.stop();
            }
            this.localStream = null;
            this.micTrack = null;
        }

        if (this.silentContext) {
            try { this.silentContext.close(); } catch (e) { /* ignore */ }
            this.silentContext = null;
            this.silentStream = null;
        }

        if (this.announceTimer) {
            clearInterval(this.announceTimer);
            this.announceTimer = null;
        }

        this.warnedUnavailable = false;
        this.warnedNoMic = false;
        this.tickCounter = 0;
    }

}
