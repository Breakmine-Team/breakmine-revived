import * as AuthLib from "../network/AuthLib.js";
import GameProfile from "../../util/GameProfile.js";
import Session from "../../util/Session.js";
import GuiMainMenu from "../gui/screens/GuiMainMenu.js";
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
            throw new Error("mods.installZip requires 'base64' (the .zip file contents).");
        }

        const modId = await this.minecraft.modLoader.installModFromZip(base64ToBytes(base64));
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
