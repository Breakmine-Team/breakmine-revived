import * as AuthLib from "./network/AuthLib.js";

const STORAGE_KEY = "breakmine_friends";
const MAX_FRIENDS = 100;

export default class FriendsManager {

    constructor(minecraft = null) {
        this.minecraft = minecraft;
        this.friends = [];

        this.load();
    }

    load() {
        let raw = null;
        try {
            raw = localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            raw = null;
        }

        if (!raw) {
            this.friends = [];
            return;
        }

        try {
            const parsed = JSON.parse(raw);
            const entries = Array.isArray(parsed) ? parsed : [];

            this.friends = entries.map(entry => {
                const username = typeof entry === "string" ? entry : entry && entry.username;
                if (!username) return null;

                const addedAt = entry && Number(entry.addedAt);
                return {
                    username: String(username),
                    addedAt: Number.isFinite(addedAt) ? addedAt : 0,
                };
            }).filter(entry => entry !== null);
        } catch (error) {
            this.friends = [];
        }
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.friends));
        } catch (error) {
            console.warn("[Friends] Could not save friend list:", error);
        }
    }

    list() {
        return this.friends
            .slice()
            .sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
    }

    getOwnUsername() {
        const settings = this.minecraft && this.minecraft.settings;
        return settings && settings.username ? String(settings.username) : "";
    }

    has(username) {
        const needle = String(username || "").toLowerCase();
        if (!needle) return false;
        return this.friends.some(friend => friend.username.toLowerCase() === needle);
    }

    async add(input) {
        const username = String(input || "").trim();

        if (!username) {
            throw new Error("Enter a username");
        }

        if (!/^[A-Za-z0-9_]{1,20}$/.test(username)) {
            throw new Error("Usernames use 1-20 letters, numbers or underscores");
        }

        if (this.getOwnUsername().toLowerCase() === username.toLowerCase()) {
            throw new Error("You cannot add yourself");
        }

        if (this.has(username)) {
            throw new Error(`${username} is already a friend`);
        }

        if (this.friends.length >= MAX_FRIENDS) {
            throw new Error(`Friend list is full (${MAX_FRIENDS})`);
        }

        if (!(await AuthLib.userExists(username))) {
            throw new Error(`No account named ${username}`);
        }

        let name = username;
        try {
            const info = await AuthLib.getUserInfo(username);
            if (info && typeof info.username === "string" && info.username.length > 0) {
                name = info.username;
            }
        } catch (error) {
            // The account exists, so keep the name the player typed.
        }

        if (this.has(name)) {
            throw new Error(`${name} is already a friend`);
        }

        this.friends.push({ username: name, addedAt: Date.now() });
        this.save();

        return name;
    }

    remove(username) {
        const needle = String(username || "").toLowerCase();
        const before = this.friends.length;

        this.friends = this.friends.filter(friend => friend.username.toLowerCase() !== needle);

        if (this.friends.length !== before) {
            this.save();
            return true;
        }

        return false;
    }

    isInCurrentWorld(username) {
        const needle = String(username || "").toLowerCase();
        if (!needle) return false;

        const minecraft = this.minecraft;
        const controller = minecraft && minecraft.playerController;
        if (!controller || typeof controller.getNetworkHandler !== "function") {
            return false;
        }

        const handler = controller.getNetworkHandler();
        const playerInfoMap = handler && typeof handler.getPlayerInfoMap === "function"
            ? handler.getPlayerInfoMap()
            : null;

        if (!playerInfoMap || typeof playerInfoMap.forEach !== "function") {
            return false;
        }

        let found = false;
        playerInfoMap.forEach(info => {
            const profile = info && info.profile;
            const name = profile && typeof profile.getUsername === "function"
                ? profile.getUsername()
                : (info && info.username);

            if (name && String(name).toLowerCase() === needle) {
                found = true;
            }
        });

        return found;
    }
}
