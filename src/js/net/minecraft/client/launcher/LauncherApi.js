import * as AuthLib from "../network/AuthLib.js";
import GameProfile from "../../util/GameProfile.js";
import Session from "../../util/Session.js";
import GuiMainMenu from "../gui/screens/GuiMainMenu.js";
import ServerPinger from "../network/pinger/ServerPinger.js";
import { Version } from "../../../../../resources/version.js";

/**
 * Launcher integration.
 *
 * Loaded only with `?launcher=1`. Installs `window.BreakmineLauncher` for the
 * host (`<webview>` + executeJavaScript) and listens for launcher messages, and
 * it signs the player in from the account the launcher passes in the URL.
 *
 * See LAUNCHER_API.md for the protocol and the method reference.
 */

const API_VERSION = 1;
const MAX_QUEUED_EVENTS = 100;
const MODS_SITE = "https://mods.breakmine.com";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // wiki/app.py MAX_FILE_SIZE
const TEMP_UPLOAD_TTL_SECONDS = 300; // wiki/app.py /tempmod timer
const PING_TIMEOUT_MS = 10000;

const MESSAGE_CALL = "breakmine:launcher:call";
const MESSAGE_RESULT = "breakmine:launcher:result";
const MESSAGE_AUTH = "breakmine:launcher:auth";
const MESSAGE_EVENT = "breakmine:launcher:event";

const DOM_EVENT = "breakmine:launcher";

function messageOf(error) {
    return error && error.message ? String(error.message) : String(error);
}

function base64ToBytes(base64) {
    const clean = String(base64).replace(/^data:[^,]*,/, "");
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function isLauncherMode() {
    try {
        return new URLSearchParams(window.location.search).get("launcher") === "1";
    } catch (error) {
        return false;
    }
}

export default class LauncherApi {

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.events = [];
        this.lastAuthError = null;
        this.lastAccountKey = this.accountKey(this.getAccount());
        this.lastStateKey = null;

        this.handleMessage = this.handleMessage.bind(this);

        this.handlers = new Map([
            ["info", () => this.info()],
            ["accounts.get", () => this.getAccount()],
            ["accounts.list", () => this.listAccounts()],
            ["accounts.login", (params) => this.login(params)],
            ["accounts.loginWithToken", (params) => this.loginWithToken(params)],
            ["accounts.logout", () => this.logout()],
            ["mods.list", () => this.listMods()],
            ["mods.setEnabled", (params) => this.setModEnabled(params)],
            ["mods.installZip", (params) => this.installModZip(params)],
            ["mods.uninstall", (params) => this.uninstallMod(params)],
            ["mods.readPackage", (params) => this.readModPackage(params)],
            ["mods.upload", (params) => this.uploadModPackage(params)],
            ["mods.download", (params) => this.downloadModPackage(params)],
            ["mods.searchSite", (params) => this.searchSiteMods(params)],
            ["mods.openUploadPage", () => this.openModUploadPage()],
            ["mods.openFolder", () => this.openModFolder()],
            ["server.getPlayers", () => this.getServerPlayers()],
            ["server.getInfo", () => this.getServerInfo()],
            ["server.ping", (params) => this.pingServer(params)],
            ["discord.getInfo", () => this.getDiscordInfo()],
            ["discord.openLogin", () => this.openDiscordLogin()],
            ["game.getState", () => this.getGameState()],
            ["events.drain", () => this.drainEvents()],
        ]);
    }

    async init() {
        this.minecraft.launcherApi = this;

        window.BreakmineLauncher = this.createPublicApi();
        window.addEventListener("message", this.handleMessage);

        this.emitEvent("ready", this.info());
        await this.autoSignIn();

        return this;
    }

    createPublicApi() {
        return {
            apiVersion: API_VERSION,
            info: () => this.info(),

            accounts: {
                get: () => this.getAccount(),
                list: () => this.listAccounts(),
                login: (params) => this.login(params),
                loginWithToken: (params) => this.loginWithToken(params),
                logout: () => this.logout(),
            },

            mods: {
                list: () => this.listMods(),
                setEnabled: (params) => this.setModEnabled(params),
                installZip: (params) => this.installModZip(params),
                uninstall: (params) => this.uninstallMod(params),
                readPackage: (params) => this.readModPackage(params),
                upload: (params) => this.uploadModPackage(params),
                download: (params) => this.downloadModPackage(params),
                searchSite: (params) => this.searchSiteMods(params),
                openUploadPage: () => this.openModUploadPage(),
                openFolder: () => this.openModFolder(),
            },

            server: {
                getPlayers: () => this.getServerPlayers(),
                getInfo: () => this.getServerInfo(),
                ping: (params) => this.pingServer(params),
            },

            discord: {
                getInfo: () => this.getDiscordInfo(),
                openLogin: () => this.openDiscordLogin(),
            },

            game: {
                getState: () => this.getGameState(),
            },

            events: {
                drain: () => this.drainEvents(),
            },
        };
    }

    // --- Info -----------------------------------------------------------------

    info() {
        const account = this.getAccount();

        return {
            apiVersion: API_VERSION,
            gameVersion: Version.VERSION,
            launcherMode: true,
            signedIn: !!account,
            account: account,
            authError: this.lastAuthError,
        };
    }

    // --- Accounts -------------------------------------------------------------

    getAccount() {
        const settings = this.minecraft && this.minecraft.settings ? this.minecraft.settings : {};
        const session = typeof this.minecraft?.getSession === "function" ? this.minecraft.getSession() : null;
        const profile = session && typeof session.getProfile === "function" ? session.getProfile() : null;

        if (!settings.loggedIn || !profile) {
            return null;
        }

        return {
            username: profile.username || settings.username || "",
            uuid: profile.uuid ? String(profile.uuid) : null,
            signedIn: true,
        };
    }

    listAccounts() {
        const account = this.getAccount();
        return account ? [account] : [];
    }

    accountKey(account) {
        return account ? `${account.username}|${account.uuid}` : "signed-out";
    }

    async login({ username, password, uuid } = {}) {
        const name = String(username || "").trim();
        if (!name || !password) {
            throw new Error("accounts.login requires 'username' and 'password'.");
        }

        const result = await AuthLib.loginOrRegister(name, password);
        return this.loginWithToken({ username: name, token: result.token, uuid });
    }

    async loginWithToken({ username, token, uuid } = {}) {
        const name = String(username || "").trim();
        if (!name || !token) {
            throw new Error("accounts.loginWithToken requires 'username' and 'token'.");
        }

        AuthLib.saveAuthToken(token);

        if (uuid) {
            this.minecraft.setSession(new Session(new GameProfile(String(uuid), name), token));
        } else {
            this.minecraft.newSessionFromUsername(name);
        }
        this.minecraft.updateAccessToken(token);

        const settings = this.minecraft.settings;
        settings.token = token;
        settings.username = name;
        settings.loggedIn = true;
        settings.save();

        this.minecraft.capeManager?.refreshOwnCape?.();
        this.onAccountChanged();

        return this.getAccount();
    }

    async logout() {
        AuthLib.clearAuthToken();

        if (typeof this.minecraft.setSession === "function") {
            this.minecraft.setSession(null, true);
        }

        const settings = this.minecraft.settings;
        settings.loggedIn = false;
        settings.token = "";
        settings.save();

        this.minecraft.capeManager?.clearOwnCape?.();
        this.onAccountChanged();

        return null;
    }

    /**
     * Called by whoever changed the session (this API, or the in-game Account
     * screen), so the launcher always sees the current account.
     */
    onAccountChanged() {
        const account = this.getAccount();
        const key = this.accountKey(account);

        if (key === this.lastAccountKey) {
            return;
        }

        this.lastAccountKey = key;
        this.refreshMainMenu();
        this.emitEvent("account", account);
    }

    refreshMainMenu() {
        if (typeof this.minecraft?.isInGame === "function" && this.minecraft.isInGame()) {
            return;
        }

        const screen = this.minecraft ? this.minecraft.currentScreen : null;
        if (screen && screen.constructor && screen.constructor.name === "GuiMainMenu") {
            this.minecraft.displayScreen(new GuiMainMenu());
        }
    }

    async autoSignIn() {
        const params = new URLSearchParams(window.location.search);
        const username = String(params.get("username") || "").trim();
        const token = String(params.get("token") || "");
        const password = String(params.get("password") || "");

        try {
            if (username && token) {
                return await this.loginWithToken({ username, token });
            }
            if (username && password) {
                return await this.login({ username, password });
            }
            return null;
        } catch (error) {
            this.lastAuthError = messageOf(error);
            this.emitEvent("authFailed", { error: this.lastAuthError });
            console.warn("[Launcher] Auto sign-in failed:", error);
            return null;
        }
    }

    // --- Mods -----------------------------------------------------------------

    async listMods() {
        if (!this.minecraft || !this.minecraft.modLoader) {
            return [];
        }
        return this.minecraft.modLoader.getInstalledMods();
    }

    async setModEnabled({ id, enabled } = {}) {
        const modId = String(id || "").trim();
        if (!modId) {
            throw new Error("mods.setEnabled requires 'id'.");
        }

        await this.minecraft.modLoader.toggleMod(modId, !!enabled);
        return this.listMods();
    }

    async installModZip({ base64 } = {}) {
        if (!base64) {
            throw new Error("mods.installZip requires 'base64' (the .zip or .jph file contents).");
        }

        const modId = await this.minecraft.modLoader.installModPackage(base64ToBytes(base64));
        return {
            id: modId,
            mods: await this.listMods(),
        };
    }

    async uninstallMod({ id } = {}) {
        const modId = String(id || "").trim();
        if (!modId) {
            throw new Error("mods.uninstall requires 'id'.");
        }

        await this.minecraft.modLoader.uninstallMod(modId);
        return this.listMods();
    }

    /**
     * Rebuilds the installed mod's files into a .zip and returns it as base64,
     * so the launcher can upload the package to a mod site without needing to
     * know how Patchwork stores mods on disk.
     */
    async readModPackage({ id } = {}) {
        const loader = this.minecraft ? this.minecraft.modLoader : null;
        const modId = String(id || "").trim();

        if (!loader) {
            throw new Error("The mod loader is not running.");
        }
        if (!modId) {
            throw new Error("mods.readPackage requires 'id'.");
        }
        if (typeof loader._fsForMod !== "function" || typeof loader._ensureJSZip !== "function") {
            throw new Error("This build cannot export mod packages.");
        }

        const filesystem = await loader._fsForMod(modId);
        const prefix = `mods/${modId}/`;
        const files = await filesystem.listDir(prefix);
        const JSZip = await loader._ensureJSZip();
        const zip = new JSZip();

        for (const path of files) {
            const entry = path.startsWith(prefix) ? path.substring(prefix.length) : path;
            const text = await filesystem.loadFile(path);
            if (typeof text === "string") {
                zip.file(entry, text);
                continue;
            }

            const bytes = typeof filesystem.loadBinaryFile === "function"
                ? await filesystem.loadBinaryFile(path)
                : null;
            if (bytes) {
                zip.file(entry, bytes);
            }
        }

        const base64 = await zip.generateAsync({ type: "base64" });
        return {
            id: modId,
            filename: `${modId}.zip`,
            base64: base64,
        };
    }

    async openModFolder() {
        const bridge = typeof window !== "undefined" ? window.modsBridge : null;

        if (!bridge || typeof bridge.openFolder !== "function") {
            throw new Error("Opening the mods folder requires the desktop launcher.");
        }

        await bridge.openFolder();
        return { opened: true };
    }

    // --- Mod site -------------------------------------------------------------

    /**
     * Stages a package on mods.breakmine.com through its unauthenticated
     * `/tempmod/upload/<id>` route, which keeps the file for five minutes.
     * Publishing it as a catalogue entry still goes through the site's
     * session-authenticated `/upload` form (`mods.openUploadPage`).
     */
    async uploadModPackage({ id, base64, filename } = {}) {
        if (!base64) {
            throw new Error("mods.upload requires 'base64' (the .zip contents).");
        }

        const bytes = base64ToBytes(base64);
        if (bytes.length === 0) {
            throw new Error("The uploaded package is empty.");
        }
        if (bytes.length > MAX_UPLOAD_BYTES) {
            throw new Error(`The uploaded package is larger than ${MAX_UPLOAD_BYTES} bytes.`);
        }

        const uploadId = String(id || `launcher_${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, "");
        if (!uploadId) {
            throw new Error("'id' must contain letters, numbers, '_' or '-'.");
        }

        const form = new FormData();
        form.append("file", new Blob([bytes], { type: "application/zip" }), filename || `${uploadId}.zip`);

        const response = await fetch(`${MODS_SITE}/tempmod/upload/${uploadId}`, {
            method: "POST",
            body: form,
        });
        const message = await response.text();

        if (!response.ok) {
            throw new Error(message || `Upload failed with HTTP ${response.status}.`);
        }

        return {
            id: uploadId,
            url: `${MODS_SITE}/tempmod/download/${uploadId}`,
            message: message,
            expiresInSeconds: TEMP_UPLOAD_TTL_SECONDS,
        };
    }

    async downloadModPackage({ id } = {}) {
        const downloadId = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
        if (!downloadId) {
            throw new Error("mods.download requires 'id'.");
        }

        const response = await fetch(`${MODS_SITE}/tempmod/download/${downloadId}`);
        if (!response.ok) {
            throw new Error(`Package '${downloadId}' is gone or expired (HTTP ${response.status}).`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }

        return { id: downloadId, base64: btoa(binary), size: bytes.length };
    }

    async searchSiteMods({ q, cat } = {}) {
        const url = new URL(`${MODS_SITE}/api/mods`);
        if (q) url.searchParams.set("q", String(q));
        if (cat) url.searchParams.set("cat", String(cat));

        const response = await fetch(url, { headers: { Accept: "application/json" } });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error((data && data.error) || `The mod site returned HTTP ${response.status}.`);
        }

        return data;
    }

    openModUploadPage() {
        return this.openExternal(`${MODS_SITE}/upload`);
    }

    openExternal(url) {
        const windowRef = this.minecraft ? this.minecraft.window : null;

        if (windowRef && typeof windowRef.openUrl === "function") {
            windowRef.openUrl(url, true);
            return { opened: true, url: url };
        }

        if (typeof window !== "undefined" && typeof window.open === "function") {
            window.open(url, "_blank", "noopener");
            return { opened: true, url: url };
        }

        throw new Error("This environment cannot open external links.");
    }

    // --- Server ---------------------------------------------------------------

    getServerPlayers() {
        const handler = this.minecraft?.playerController?.getNetworkHandler?.();
        const playerInfoMap = handler && typeof handler.getPlayerInfoMap === "function"
            ? handler.getPlayerInfoMap()
            : null;
        const players = [];

        if (playerInfoMap && typeof playerInfoMap.forEach === "function") {
            playerInfoMap.forEach((info, uuid) => {
                if (!info || !info.profile) {
                    return;
                }

                players.push({
                    uuid: String(uuid),
                    username: typeof info.profile.getUsername === "function"
                        ? info.profile.getUsername()
                        : String(info.profile.username || ""),
                    displayName: info.displayName ?? null,
                    gameType: info.gameType ?? 0,
                    ping: info.ping ?? 0,
                });
            });
        }

        players.sort((a, b) => a.username.localeCompare(b.username));

        return {
            connected: !!playerInfoMap,
            count: players.length,
            players: players,
        };
    }

    getServerInfo() {
        const networkManager = this.minecraft?.playerController?.getNetworkHandler?.()?.getNetworkManager?.();
        const singleplayer = typeof this.minecraft?.isSingleplayer === "function"
            ? this.minecraft.isSingleplayer()
            : true;

        return {
            singleplayer: singleplayer,
            connected: !!networkManager || singleplayer,
            address: singleplayer ? null : (networkManager?.address ?? null),
            port: networkManager?.port ?? null,
        };
    }

    pingServer({ address, port } = {}) {
        const host = String(address || "").trim();
        if (!host) {
            throw new Error("server.ping requires 'address'.");
        }

        const serverPort = Number(port) > 0 ? Number(port) : 25565;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Ping to ${host}:${serverPort} timed out.`));
            }, PING_TIMEOUT_MS);

            try {
                const pinger = new ServerPinger(this.minecraft);
                pinger.ping(host, serverPort, (status) => {
                    clearTimeout(timer);
                    resolve(status === undefined ? null : status);
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    // --- Discord --------------------------------------------------------------

    /**
     * The mods app's session-based Discord OAuth entry point. The launcher can
     * open it in a browser; linking is finished by Discord + the Flask session,
     * so there is no token exchange for the launcher to perform.
     */
    discordLoginUrl() {
        return `${MODS_SITE}/login/discord`;
    }

    getDiscordInfo() {
        const state = this.minecraft?.gameState?.snapshot?.() || null;
        const account = this.getAccount();
        const inGame = !!state && (state.state === "ingame" || state.state === "paused" || state.state === "gui");
        const bridge = typeof window !== "undefined" ? window.modsBridge : null;

        return {
            loginUrl: this.discordLoginUrl(),
            richPresence: !!(bridge && typeof bridge.reportGameState === "function"),
            details: !inGame
                ? "Main Menu"
                : (state.singleplayer ? "Singleplayer" : "Multiplayer"),
            state: account ? `Playing as ${account.username}` : null,
            paused: inGame ? !!state.paused : false,
        };
    }

    openDiscordLogin() {
        return this.openExternal(this.discordLoginUrl());
    }

    // --- Game state -----------------------------------------------------------

    getGameState() {
        const state = this.minecraft ? this.minecraft.gameState : null;
        if (!state || typeof state.snapshot !== "function") {
            return null;
        }
        return state.snapshot();
    }

    /**
     * Hooked from Minecraft.updateGameState() so the launcher gets a state
     * event only when the summary actually changes.
     */
    onGameStateChanged(state) {
        const summary = {
            state: state.state,
            screen: state.screen,
            world: state.world,
            paused: state.paused,
            singleplayer: state.singleplayer,
        };
        const key = `${summary.state}|${summary.screen}|${summary.world}|${summary.paused}|${summary.singleplayer}`;

        if (key === this.lastStateKey) {
            return;
        }

        this.lastStateKey = key;
        this.emitEvent("gameState", summary);
    }

    // --- Events ---------------------------------------------------------------

    drainEvents() {
        const drained = this.events;
        this.events = [];
        return drained;
    }

    emitEvent(event, data) {
        const message = {
            type: MESSAGE_EVENT,
            event: event,
            data: data === undefined ? null : data,
        };
        const payload = { ...message, time: Date.now() };

        this.events.push(payload);
        if (this.events.length > MAX_QUEUED_EVENTS) {
            this.events.shift();
        }

        this.deliver(payload);
    }

    deliver(message) {
        const payload = { ...message, time: message.time || Date.now() };

        try {
            document.dispatchEvent(new CustomEvent(DOM_EVENT, { detail: payload }));
        } catch (error) {
            // No DOM (tests); nothing else to notify locally.
        }

        const host = typeof window !== "undefined" ? window.breakmineHost : null;
        if (host && typeof host.emit === "function") {
            try {
                host.emit(payload);
                return;
            } catch (error) {
                console.warn("[Launcher] Host event bridge failed:", error);
            }
        }

        for (const target of [window.parent, window.opener]) {
            if (!target || target === window) {
                continue;
            }
            try {
                target.postMessage(payload, "*");
                return;
            } catch (error) {
                // Best effort only; the launcher can poll events.drain().
            }
        }
    }

    // --- Host -> game messages ------------------------------------------------

    async handleMessage(event) {
        const data = event ? event.data : null;
        if (!data || typeof data !== "object" || typeof data.type !== "string") {
            return;
        }

        if (data.type === MESSAGE_CALL) {
            await this.handleCall(data);
        } else if (data.type === MESSAGE_AUTH) {
            await this.handleAuth(data);
        }
    }

    async handleCall(data) {
        const id = data.id === undefined ? null : data.id;
        const method = String(data.method || "");
        const handler = this.handlers.get(method);

        if (!handler) {
            this.deliver({
                type: MESSAGE_RESULT,
                id: id,
                method: method,
                ok: false,
                error: `Unknown launcher method '${method}'.`,
            });
            return;
        }

        try {
            const params = data.params && typeof data.params === "object" ? data.params : {};
            const result = await handler(params);
            this.deliver({
                type: MESSAGE_RESULT,
                id: id,
                method: method,
                ok: true,
                result: result === undefined ? null : result,
            });
        } catch (error) {
            this.deliver({
                type: MESSAGE_RESULT,
                id: id,
                method: method,
                ok: false,
                error: messageOf(error),
            });
        }
    }

    async handleAuth(data) {
        const account = data.account || data.params || {};
        const hasId = data.id !== undefined && data.id !== null;

        try {
            const result = await this.loginWithToken({
                username: account.username,
                token: account.token,
                uuid: account.uuid,
            });
            if (hasId) {
                this.deliver({ type: MESSAGE_RESULT, id: data.id, method: MESSAGE_AUTH, ok: true, result: result });
            }
        } catch (error) {
            this.lastAuthError = messageOf(error);
            this.emitEvent("authFailed", { error: this.lastAuthError });
            if (hasId) {
                this.deliver({ type: MESSAGE_RESULT, id: data.id, method: MESSAGE_AUTH, ok: false, error: this.lastAuthError });
            }
        }
    }
}

export function initLauncherApi(minecraft) {
    const api = new LauncherApi(minecraft);
    api.init().catch((error) => {
        console.warn("[Launcher] Could not start the launcher API:", error);
    });
    return api;
}
