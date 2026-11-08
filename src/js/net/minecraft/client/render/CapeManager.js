import * as THREE from "../../../../../../libraries/three.module.js";
import * as AuthLib from "../network/AuthLib.js";
import PlayerRenderer from "./entity/entity/PlayerRenderer.js";

// Mirrors the game server's cape:update validation.
const MAX_CAPE_DATA_URL_LENGTH = 512 * 1024;

// `choice` value meaning "wear no cape at all". null means the server default.
const NO_CAPE = '';

/**
 * Owns the capes the server advertises for players, plus the signed-in
 * account's cape catalog and selection.
 *
 * Capes are managed through the API: an admin uploads named capes and assigns
 * them to accounts, and a player picks one from that assigned list. The choice
 * is stored server-side (so /cape/<username> serves it) and mirrored locally so
 * the selection and the own player model update immediately.
 */
export default class CapeManager {

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.capes = new Map();     // lower-case username -> cape data URL
        this.textures = new Map();  // lower-case username -> THREE.Texture
        this.networkManager = null;
        this.ownCapePublished = false;

        // Assigned cape catalog for the signed-in account. `choice` stays
        // undefined until the catalog has loaded, then null (default cape),
        // '' (no cape) or a cape id from the catalog.
        this.catalog = [];
        this.choice = undefined;
        this.selectedTexture = null;
        this.catalogError = null;
        this.catalogPromise = null;
    }

    static getKey(username) {
        return String(username || '').toLowerCase();
    }

    static isSupportedCape(dataUrl) {
        return typeof dataUrl === 'string'
            && dataUrl.startsWith('data:image/png;base64,')
            && dataUrl.length <= MAX_CAPE_DATA_URL_LENGTH;
    }

    /* ------------------------------ catalog --------------------------- */

    getChoice() {
        return this.choice;
    }

    getCatalog() {
        return [...this.catalog];
    }

    getCatalogError() {
        return this.catalogError;
    }

    getSelectedTexture() {
        return this.choice === NO_CAPE ? null : this.selectedTexture;
    }

    /**
     * Fetch the capes assigned to this account and its saved selection.
     * Cached until the picker forces a refresh.
     */
    async loadCatalog(force = false) {
        if (!this.minecraft?.settings?.loggedIn) return this.getCatalog();
        if (!force && this.choice !== undefined) return this.getCatalog();
        if (this.catalogPromise) return this.catalogPromise;

        this.catalogPromise = (async () => {
            try {
                const data = await AuthLib.getCapes();
                const capes = Array.isArray(data?.capes) ? data.capes : [];

                this.catalog = capes
                    .filter((cape) => cape
                        && typeof cape.id === 'string'
                        && typeof cape.name === 'string'
                        && CapeManager.isSupportedCape(cape.texture))
                    .map((cape) => ({ id: cape.id, name: cape.name, texture: cape.texture }));

                const choice = data?.choice;
                if (choice === null || choice === undefined) {
                    this.choice = null;
                } else if (choice === NO_CAPE) {
                    this.choice = NO_CAPE;
                } else {
                    this.choice = this.catalog.some((cape) => cape.id === choice) ? choice : null;
                }

                this.selectedTexture = this.catalog.find((cape) => cape.id === this.choice)?.texture || null;
                this.catalogError = null;

                // Show the saved pick on our own model right away.
                const username = this.getOwnUsername();
                if (username) {
                    if (this.choice === NO_CAPE) this.setCape(username, null);
                    else if (this.selectedTexture) this.setCape(username, this.selectedTexture);
                }
            } catch (error) {
                this.catalogError = error?.message || 'Could not load your capes.';
                if (this.choice === undefined) this.choice = null;
            } finally {
                this.catalogPromise = null;
            }

            return this.getCatalog();
        })();

        return this.catalogPromise;
    }

    /**
     * Wear a cape from the catalog.
     *
     * @param {string|null} capeId cape id, '' for no cape, null for the default
     */
    async selectCape(capeId) {
        let choice;
        let texture = null;

        if (capeId === null || capeId === undefined) {
            choice = null;
        } else if (capeId === NO_CAPE) {
            choice = NO_CAPE;
        } else {
            const cape = this.catalog.find((entry) => entry.id === capeId);
            if (!cape) throw new Error('That cape is not available to you.');
            choice = cape.id;
            texture = cape.texture;
        }

        const previousChoice = this.choice;
        const previousTexture = this.selectedTexture;

        this.choice = choice;
        this.selectedTexture = texture;

        try {
            await AuthLib.selectCape(choice);
            this.catalogError = null;
        } catch (error) {
            this.choice = previousChoice;
            this.selectedTexture = previousTexture;
            this.catalogError = 'Your cape choice could not be saved to your account.';
            throw new Error(this.catalogError);
        }

        const username = this.getOwnUsername();
        if (!username) return;

        if (choice === null) {
            // The server resolves the account's default cape for us.
            this.ownCapePublished = false;
            this.publishOwnCape();
            return;
        }

        const dataUrl = choice === NO_CAPE ? null : texture;
        this.setCape(username, dataUrl);
        this.sendCape(username, dataUrl);
    }

    /* ------------------------------ textures ------------------------- */

    getOwnUsername() {
        const username = this.minecraft?.getSession?.()?.getProfile?.()?.getUsername?.();
        return typeof username === 'string' && username.length > 0 ? username : null;
    }

    getTexture(username) {
        return this.textures.get(CapeManager.getKey(username)) || null;
    }

    reset() {
        for (const texture of this.textures.values()) {
            texture.dispose();
        }
        this.textures.clear();
        this.capes.clear();
        this.networkManager = null;
        this.ownCapePublished = false;
    }

    /**
     * A player's cape arrived (or was cleared) from the server.
     */
    handleState(username, dataUrl) {
        if (!username) return;
        this.setCape(username, dataUrl);
    }

    setCape(username, dataUrl) {
        const key = CapeManager.getKey(username);
        if (!key) return;

        if (dataUrl === null || dataUrl === undefined || dataUrl === '') {
            this.capes.delete(key);

            const texture = this.textures.get(key);
            if (texture) {
                texture.dispose();
                this.textures.delete(key);
            }
            this.refresh(key);
            return;
        }

        if (!CapeManager.isSupportedCape(dataUrl)) return;
        if (this.capes.get(key) === dataUrl) return;

        this.capes.set(key, dataUrl);
        this.loadTexture(key, dataUrl);
    }

    loadTexture(key, dataUrl) {
        const image = new Image();
        image.onload = () => {
            // A newer cape replaced this one while the image was decoding.
            if (this.capes.get(key) !== dataUrl) return;

            const texture = new THREE.Texture(image);
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            texture.userData = {
                capeWidth: image.width,
                capeHeight: image.height
            };

            const previous = this.textures.get(key);
            if (previous) previous.dispose();
            this.textures.set(key, texture);

            this.refresh(key);
        };
        image.onerror = () => {
            console.warn(`[Cape] Could not decode cape for ${key}`);
        };
        image.src = dataUrl;
    }

    /**
     * Rebuild every player renderer showing this username so the new cape
     * appears immediately instead of on the next brightness change.
     */
    refresh(key) {
        for (const renderer of PlayerRenderer.instances) {
            const entity = renderer.lastEntity;
            if (!entity || CapeManager.getKey(entity.username) !== key) continue;

            renderer.group.buildMeta = undefined;
            renderer.rebuild(entity);
        }
    }

    /**
     * A world/server session just started: ask for everyone's capes and make
     * the account's own cape visible to the server.
     */
    onJoin(networkManager) {
        this.networkManager = networkManager || null;
        this.ownCapePublished = false;

        if (!this.networkManager) return;

        this.networkManager.sendJson({ type: 'cape:request' });
        this.publishOwnCape();
    }

    async publishOwnCape() {
        if (this.ownCapePublished || !this.networkManager) return;
        if (!this.minecraft?.settings?.loggedIn) return;

        const username = this.getOwnUsername();
        if (!username) return;

        this.ownCapePublished = true;
        const networkManager = this.networkManager;

        if (this.choice === NO_CAPE) {
            this.setCape(username, null);
            this.sendCape(username, null);
            return;
        }

        try {
            // The API resolves the saved choice for <username>, so an
            // unassigned or deleted cape is never worn from a stale cache;
            // 404 means no cape (either "none" or a missing default).
            const response = await fetch(AuthLib.getCapeUrl(username), { cache: 'no-store' });
            if (networkManager !== this.networkManager) return;

            if (!response.ok) {
                this.setCape(username, null);
                this.sendCape(username, null);
                return;
            }

            const dataUrl = await this.blobToDataUrl(await response.blob());
            if (!CapeManager.isSupportedCape(dataUrl)) return;
            if (networkManager !== this.networkManager) return;

            this.setCape(username, dataUrl);
            this.sendCape(username, dataUrl);
        } catch (error) {
            console.warn('[Cape] Could not publish own cape:', error);
        }
    }

    sendCape(username, dataUrl) {
        if (this.networkManager?.connected) {
            this.networkManager.sendJson({ type: 'cape:update', username, cape: dataUrl });
        }
    }

    /**
     * The account changed (sign-in through the account screen): drop the old
     * account's catalog and publish the new account's cape.
     */
    refreshOwnCape() {
        this.catalog = [];
        this.choice = undefined;
        this.selectedTexture = null;
        this.catalogError = null;
        this.ownCapePublished = false;
        this.publishOwnCape();
    }

    /**
     * Signing out removes the account cape, so stop showing it and clear it on
     * the server for everyone else too.
     */
    clearOwnCape() {
        const username = this.getOwnUsername();
        if (username) {
            this.setCape(username, null);
            this.sendCape(username, null);
        }

        this.catalog = [];
        this.choice = undefined;
        this.selectedTexture = null;
        this.catalogError = null;
        this.ownCapePublished = false;
    }

    blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Could not read cape image'));
            reader.readAsDataURL(blob);
        });
    }

}
