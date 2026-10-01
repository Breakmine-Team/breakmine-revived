const STORAGE_KEY = "breakmine_cape_plus";
const RECENTS_STORAGE_KEY = "breakmine_cape_plus_recents";
const MAX_RECENT_CAPES = 3;
const CAPE_WIDTH = 64;
const CLASSIC_CAPE_HEIGHT = 32;
const MODERN_CAPE_HEIGHT = 64;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

class CapeIconButton extends GuiButton {
    render(stack, mouseX, mouseY, partialTicks) {
        super.render(stack, mouseX, mouseY, partialTicks);
        const icon = this.minecraft?.resources?.["gui/cape_plus/cape_icon"];
        if (icon) {
            stack.save();
            stack.imageSmoothingEnabled = false;
            stack.drawImage(icon, this.x + 2, this.y + 2, 16, 16);
            stack.restore();
            return;
        }

        const mouseOver = this.isMouseOver(mouseX, mouseY) || this.focused;
        const color = !this.enabled ? "#777777" : (mouseOver ? "#fff06a" : "#e8e8e8");
        const shadow = !this.enabled ? "#424242" : "#5c5c5c";
        const cx = Math.floor(this.x + this.width / 2);
        const top = this.y + 4;

        this.drawRect(stack, cx - 3, top, cx + 3, top + 2, shadow);
        this.drawRect(stack, cx - 4, top + 2, cx + 4, top + 9, shadow);
        this.drawRect(stack, cx - 3, top + 9, cx, top + 11, shadow);
        this.drawRect(stack, cx, top + 9, cx + 3, top + 11, shadow);
        this.drawRect(stack, cx - 2, top + 1, cx + 2, top + 3, color);
        this.drawRect(stack, cx - 3, top + 3, cx + 3, top + 9, color);
        this.drawRect(stack, cx - 2, top + 9, cx, top + 10, color);
        this.drawRect(stack, cx, top + 9, cx + 2, top + 10, color);

    }
}

export default class CapeService {
    constructor(minecraft, GuiCapeUpload) {
        this.minecraft = minecraft;
        this.GuiCapeUpload = GuiCapeUpload;
        this.textures = new Map();
        this.renderers = new Set();
        this.localCape = this._readLocalCape();
        this.recentCapes = this._readRecentCapes();
    }

    getLocalUsername() {
        return this.minecraft?.getSession?.()?.getProfile?.()?.getUsername?.() || null;
    }

    getVersion(entity) {
        const record = this._getRecord(entity);
        return record ? record.version : 0;
    }

    getGuiButtons(screenId, screen) {
        if (screenId !== "main-menu") return [];

        const quitX = screen.width / 2 + 2;
        const quitY = screen.height / 4 + 36 + 96 + 12;
        const iconX = Math.min(quitX + 102, screen.width - 22);
        return [new CapeIconButton(this.minecraft, "", iconX, quitY, 20, 20, () => {
            this.minecraft.displayScreen(new this.GuiCapeUpload(this, screen));
        }).setTooltip("Capes")];
    }

    _readLocalCape() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const value = JSON.parse(raw);
            if (!value || typeof value.dataUrl !== "string") return null;
            return {
                dataUrl: value.dataUrl,
                textureHeight: value.textureHeight === MODERN_CAPE_HEIGHT
                    ? MODERN_CAPE_HEIGHT
                    : CLASSIC_CAPE_HEIGHT,
                version: Number(value.version) || Date.now()
            };
        } catch (_) {
            return null;
        }
    }

    _saveLocalCape() {
        if (!this.localCape) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.localCape));
    }

    _readRecentCapes() {
        try {
            const values = JSON.parse(localStorage.getItem(RECENTS_STORAGE_KEY) || "[]");
            if (!Array.isArray(values)) return [];
            const seen = new Set();
            return values.filter(value => {
                if (!value || typeof value.dataUrl !== "string" || seen.has(value.dataUrl)) return false;
                seen.add(value.dataUrl);
                return true;
            }).slice(0, MAX_RECENT_CAPES).map(value => ({
                dataUrl: value.dataUrl,
                textureHeight: value.textureHeight === MODERN_CAPE_HEIGHT
                    ? MODERN_CAPE_HEIGHT
                    : CLASSIC_CAPE_HEIGHT,
                version: Number(value.version) || Date.now()
            }));
        } catch (_) {
            return [];
        }
    }

    _saveRecentCapes() {
        try {
            localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(this.recentCapes));
        } catch (_) {
            this.recentCapes = this.recentCapes.slice(0, 1);
            try {
                localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(this.recentCapes));
            } catch (_) {}
        }
    }

    _rememberCape(record) {
        this.recentCapes = [record, ...this.recentCapes]
            .filter((cape, index, values) => values.findIndex(value => value.dataUrl === cape.dataUrl) === index)
            .slice(0, MAX_RECENT_CAPES)
            .map(cape => ({ ...cape }));
        this._saveRecentCapes();
    }

    getRecentCapes() {
        return this.recentCapes.map(cape => ({ ...cape }));
    }

    selectRecentCape(index) {
        const selected = this.recentCapes[index];
        if (!selected) throw new Error("That recent cape is no longer available.");
        this.localCape = { ...selected, version: Date.now() };
        this._saveLocalCape();
        this._rememberCape(this.localCape);
        this._invalidateLocalRenderers();
        return this.localCape;
    }

    useDefaultCape(variant = "default") {
        const resourceKey = variant === "cape_2" ? "gui/cape_plus/cape_2" : "gui/cape_plus/default_cape";
        const image = this.minecraft?.resources?.[resourceKey] || this.minecraft?.resources?.["gui/cape_plus/default_cape"];
        
        if (!image) throw new Error("Default cape texture is still loading.");
        const textureHeight = image.naturalHeight === MODERN_CAPE_HEIGHT
            ? MODERN_CAPE_HEIGHT
            : CLASSIC_CAPE_HEIGHT;
        this.localCape = {
            dataUrl: this._createCapeCanvas(image, textureHeight).toDataURL("image/png"),
            textureHeight,
            version: Date.now()
        };
        this._saveLocalCape();
        this._invalidateLocalRenderers();
        return this.localCape;
    }

    _getRecord(entity) {
        const username = entity?.username || this.getLocalUsername();
        if (!username) return null;

        if (username.toLowerCase() === this.getLocalUsername()?.toLowerCase() && this.localCape) {
            return this.localCape;
        }
        return null;
    }

    async setCapeFromFile(file) {
        if (!file || file.type !== "image/png") {
            throw new Error("Please choose a PNG image.");
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            throw new Error("The image is too large (maximum 2 MiB).");
        }

        const normalized = await this._normalizeImage(file);
        this.localCape = { ...normalized, version: Date.now() };
        this._saveLocalCape();
        this._rememberCape(this.localCape);
        this._invalidateLocalRenderers();
        return this.localCape;
    }

    clearCape() {
        this.localCape = null;
        this._saveLocalCape();
        this._invalidateLocalRenderers();
    }

    _normalizeImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                try {
                    if (image.naturalWidth !== CAPE_WIDTH ||
                        (image.naturalHeight !== CLASSIC_CAPE_HEIGHT && image.naturalHeight !== MODERN_CAPE_HEIGHT)) {
                        throw new Error("Cape PNG must be 64×32 (classic) or 64×64 (modern).");
                    }
                    const canvas = this._createCapeCanvas(image, image.naturalHeight);
                    URL.revokeObjectURL(url);
                    resolve({
                        dataUrl: canvas.toDataURL("image/png"),
                        textureHeight: image.naturalHeight
                    });
                } catch (error) {
                    URL.revokeObjectURL(url);
                    reject(error);
                }
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("The PNG could not be decoded."));
            };
            image.src = url;
        });
    }

    _createCapeCanvas(image, textureHeight = image.naturalHeight) {
        const canvas = document.createElement("canvas");
        canvas.width = CAPE_WIDTH;
        canvas.height = textureHeight;
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, CAPE_WIDTH, textureHeight);
        context.drawImage(image, 0, 0);
        return canvas;
    }

    createPlayerPreview(width = 112, height = 150) {
        const canvas = document.createElement("canvas");
        const pixelScale = 2;
        canvas.width = width * pixelScale;
        canvas.height = height * pixelScale;

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(1);
        renderer.setSize(canvas.width, canvas.height, false);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(19, width / height, 1, 250);
        camera.position.set(0, 0, 125);
        camera.lookAt(0, 0, 0);

        const group = new THREE.Object3D();
        group.position.set(0, 8, 0);
        group.scale.set(-1, -1, 1);
        scene.add(group);

        const preview = {
            width, height, canvas, renderer, scene, camera, group, parts: [],
            head: null, body: null, rightArm: null, leftArm: null,
            rightLeg: null, leftLeg: null,
            playerTexture: null, ownsPlayerTexture: false,
            cape: null, capeKey: null, capeHeight: 0,
            startedAt: performance.now(),
            lastFrameAt: performance.now(),
            yaw: Math.PI,
            disposed: false
        };

        const player = this.minecraft?.player;
        const liveTexture = player?.renderer?.getTextureForEntity?.(player) || null;
        if (liveTexture) {
            this._setPreviewSkin(preview, liveTexture, false);
        } else {
            const fallback = this.minecraft?.resources?.["gui/cape_plus/default_skin"]
                || this.minecraft?.resources?.["char.png"];
            if (fallback) this._setPreviewSkin(preview, new THREE.CanvasTexture(fallback), true);
        }

        if (this.minecraft?.settings?.loggedIn) {
            const username = this.getLocalUsername();
            if (username) this._loadPreviewSkin(preview, username);
        }

        return preview;
    }

    _setPreviewSkin(preview, texture, ownsTexture) {
        for (const part of preview.parts) {
            preview.group.remove(part.bone);
            part.bone.traverse(child => {
                child.geometry?.dispose?.();
                child.material?.dispose?.();
            });
        }
        if (preview.ownsPlayerTexture) preview.playerTexture?.dispose?.();

        preview.playerTexture = texture;
        preview.ownsPlayerTexture = ownsTexture;
        preview.parts = [];

        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        const skinHeight = texture.image?.naturalHeight || texture.image?.height || 32;
        const textureHeight = skinHeight >= 64 ? 64 : 32;
        const tessellator = new Tessellator();
        tessellator.bindTexture(texture);
        tessellator.setColor(1, 1, 1, 1);
        const addPart = (name, u, v, point, box, inflate = 0, mirror = false) => {
            const part = new ModelRenderer(name, 64, textureHeight)
                .setTextureOffset(u, v)
                .setRotationPoint(...point)
                .addBox(...box, inflate, mirror);
            part.rebuild(tessellator, preview.group);
            preview.parts.push(part);
            return part;
        };

        preview.head = addPart("preview_head", 0, 0, [0, 0, 0], [-4, -8, -4, 8, 8, 8]);
        addPart("preview_hat", 32, 0, [0, 0, 0], [-4, -8, -4, 8, 8, 8], 0.5);
        preview.body = addPart("preview_body", 16, 16, [0, 0, 0], [-4, 0, -2, 8, 12, 4]);
        preview.rightArm = addPart("preview_right_arm", 40, 16, [-5, 2, 0], [-3, -2, -2, 4, 12, 4]);
        preview.leftArm = addPart("preview_left_arm", textureHeight === 64 ? 32 : 40, textureHeight === 64 ? 48 : 16, [5, 2, 0], [-1, -2, -2, 4, 12, 4], 0, true);
        preview.rightLeg = addPart("preview_right_leg", 0, 16, [-2, 12, 0], [-2, 0, -2, 4, 12, 4]);
        preview.leftLeg = addPart("preview_left_leg", textureHeight === 64 ? 16 : 0, textureHeight === 64 ? 48 : 16, [2, 12, 0], [-2, 0, -2, 4, 12, 4], 0, textureHeight !== 64);

        if (textureHeight === 64) {
            addPart("preview_jacket", 16, 32, [0, 0, 0], [-4, 0, -2, 8, 12, 4], 0.25);
            addPart("preview_right_sleeve", 40, 32, [-5, 2, 0], [-3, -2, -2, 4, 12, 4], 0.25);
            addPart("preview_left_sleeve", 48, 48, [5, 2, 0], [-1, -2, -2, 4, 12, 4], 0.25);
            addPart("preview_right_pants", 0, 32, [-2, 12, 0], [-2, 0, -2, 4, 12, 4], 0.25);
            addPart("preview_left_pants", 0, 48, [2, 12, 0], [-2, 0, -2, 4, 12, 4], 0.25);
        }

        for (const part of preview.parts) {
            part.bone.traverse(child => {
                if (!child.isMesh) return;
                child.material.transparent = true;
                child.material.alphaTest = 0.1;
                child.material.needsUpdate = true;
            });
        }
    }

    _loadPreviewSkin(preview, username) {
        const configuredApi = this.minecraft?.settings?.apiUrl || "api.breakmine.com";
        const apiBase = /^https?:\/\//i.test(configuredApi)
            ? configuredApi
            : `https://${configuredApi}`;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            if (preview.disposed) return;
            this._setPreviewSkin(preview, new THREE.CanvasTexture(image), true);
        };
        image.src = `${apiBase.replace(/\/$/, "")}/skin/${encodeURIComponent(username)}?t=${Date.now()}`;
    }

    _syncPreviewCape(preview) {
        const record = this.localCape;
        if (!record) {
            if (preview.cape) preview.cape.bone.visible = false;
            return;
        }
        const texture = this._getTexture(record);
        if (!texture) {
            if (preview.cape) preview.cape.bone.visible = false;
            return;
        }

        const textureHeight = record.textureHeight || CLASSIC_CAPE_HEIGHT;
        if (!preview.cape || preview.capeHeight !== textureHeight) {
            if (preview.cape) preview.group.remove(preview.cape.bone);
            const cape = new ModelRenderer("preview_cape", CAPE_WIDTH, textureHeight)
                .setTextureOffset(0, 0)
                .setRotationPoint(0, 0, 2)
                .addBox(-5, 0, -1, 10, 16, 1);
            const tessellator = new Tessellator();
            tessellator.bindTexture(texture);
            tessellator.setColor(1, 1, 1, 1);
            cape.rebuild(tessellator, preview.group);
            cape.bone.traverse(child => {
                if (!child.isMesh) return;
                child.material.transparent = true;
                child.material.alphaTest = 0.1;
                child.material.depthWrite = true;
            });
            preview.cape = cape;
            preview.capeHeight = textureHeight;
            preview.capeKey = record.dataUrl;
        } else if (preview.capeKey !== record.dataUrl) {
            preview.cape.bone.traverse(child => {
                if (!child.isMesh) return;
                child.material.map = texture;
                child.material.needsUpdate = true;
            });
            preview.capeKey = record.dataUrl;
        }
        preview.cape.bone.visible = true;
    }

    rotatePlayerPreview(preview, deltaX) {
        if (!preview) return;
        preview.yaw += deltaX * 0.018;
    }

    renderPlayerPreview(preview, mouseX = 0, mouseY = 0, hovered = false, animationMode = "idle") {
        if (!preview?.renderer) return;
        this._syncPreviewCape(preview);

        const now = performance.now();
        const seconds = (now - preview.startedAt) / 1000;
        const deltaSeconds = Math.min(0.05, Math.max(0, (now - preview.lastFrameAt) / 1000));
        preview.lastFrameAt = now;

        const animation = animationMode === "sprint"
            ? { speed: 9.0, strength: 0.9, capeBase: 28, capeWave: 10 }
            : animationMode === "walk"
                ? { speed: 5.0, strength: 0.45, capeBase: 16, capeWave: 6 }
                : { speed: 1.5, strength: 0.035, capeBase: 9, capeWave: 2 };
        const walk = seconds * animation.speed;
        const strength = animation.strength;
        preview.rightArm.rotateAngleX = Math.cos(walk + Math.PI) * strength;
        preview.leftArm.rotateAngleX = Math.cos(walk) * strength;
        preview.rightLeg.rotateAngleX = Math.cos(walk) * strength;
        preview.leftLeg.rotateAngleX = Math.cos(walk + Math.PI) * strength;
        preview.rightArm.rotateAngleZ = 0.04;
        preview.leftArm.rotateAngleZ = -0.04;
        preview.head.rotateAngleY = 0;
        preview.head.rotateAngleX = 0;

        for (const part of preview.parts) part.render();
        if (!hovered) preview.yaw += deltaSeconds * 0.28;
        preview.group.rotation.y = preview.yaw;

        if (preview.cape?.bone.visible) {
            const capeX = (animation.capeBase + Math.sin(seconds * animation.speed) * animation.capeWave) * Math.PI / 180;
            const capeZ = Math.sin(seconds * animation.speed * 0.7) * 2 * Math.PI / 180;
            const yAxis = new THREE.Vector3(0, 1, 0);
            const xAxis = new THREE.Vector3(1, 0, 0);
            const zAxis = new THREE.Vector3(0, 0, 1);
            const pose = new THREE.Quaternion()
                .setFromAxisAngle(yAxis, Math.PI)
                .multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, -Math.PI))
                .multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, capeX))
                .multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, capeZ))
                .multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, Math.PI - capeZ));
            const euler = new THREE.Euler().setFromQuaternion(pose, "ZYX");
            preview.cape.setRotationAngle(euler.x, euler.y, euler.z);
            preview.cape.render();
        }

        preview.group.updateMatrixWorld(true);
        preview.renderer.render(preview.scene, preview.camera);
    }

    disposePlayerPreview(preview) {
        if (!preview) return;
        preview.disposed = true;
        for (const part of preview.parts || []) {
            part.bone.traverse(child => {
                child.geometry?.dispose?.();
                child.material?.dispose?.();
            });
        }
        preview.cape?.bone?.traverse(child => {
            child.geometry?.dispose?.();
            child.material?.dispose?.();
        });
        if (preview.ownsPlayerTexture) preview.playerTexture?.dispose?.();
        preview.renderer?.dispose?.();
    }

    _invalidateLocalRenderers() {
        const localUsername = this.getLocalUsername();
        if (localUsername) this._invalidateUsernameRenderers(localUsername.toLowerCase());
    }

    _invalidateUsernameRenderers(username) {
        for (const renderer of this.renderers) {
            const entity = renderer.lastEntity;
            if (!entity || entity.username?.toLowerCase() !== username) continue;
            renderer.group.buildMeta = undefined;
            renderer.rebuild(entity);
        }
    }

    _getTexture(record) {
        if (!record?.dataUrl) return null;
        const key = record.dataUrl;
        const cached = this.textures.get(key);
        if (cached) return cached.texture || null;

        const pending = { texture: null };
        this.textures.set(key, pending);
        const image = new Image();
        image.onload = () => {
            const texture = new THREE.CanvasTexture(this._createCapeCanvas(image));
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            pending.texture = texture;
            for (const renderer of this.renderers) {
                if (renderer.lastEntity && this._getRecord(renderer.lastEntity)?.dataUrl === key) {
                    renderer.group.buildMeta = undefined;
                    renderer.rebuild(renderer.lastEntity);
                }
            }
        };
        image.onerror = () => this.textures.delete(key);
        image.src = key;
        return null;
    }

    onRendererRebuilt(renderer, entity) {
        this.renderers.add(renderer);
        const record = this._getRecord(entity);
        const bodyBone = renderer.model?.body?.bone;
        if (!bodyBone) return;
        const texture = this._getTexture(record);
        if (!texture) return;

        const cape = new ModelRenderer("cape_plus", CAPE_WIDTH, record.textureHeight || CLASSIC_CAPE_HEIGHT)
            .setTextureOffset(0, 0)
            .setRotationPoint(0, 0, 2)
            .addBox(-5, 0, -1, 10, 16, 1);
        const tessellator = new Tessellator();
        tessellator.bindTexture(texture);
        tessellator.setColor(1, 1, 1, 1);
        cape.rebuild(tessellator, bodyBone);

        cape.bone.name = "cape_plus_26_3";
        cape.bone.traverse(child => {
            if (!child.isMesh) return;
            child.material.transparent = true;
            child.material.alphaTest = 0.1;
            child.material.depthWrite = true;
            child.material.needsUpdate = true;
        });
        renderer.capeModel = cape;
        renderer.capeTextureKey = record.dataUrl;
    }

    render(renderer, entity, partialTicks) {
        const record = this._getRecord(entity);
        if (!renderer.capeModel || !record) {
            if (renderer.capeModel) renderer.capeModel.bone.visible = false;
            return;
        }

        const texture = this._getTexture(record);
        if (!texture) {
            renderer.capeModel.bone.visible = false;
            return;
        }

        renderer.capeModel.bone.visible = true;
        if (renderer.capeTextureKey !== record.dataUrl) {
            renderer.capeModel.bone.traverse(child => {
                if (child.isMesh) {
                    child.material.map = texture;
                    child.material.needsUpdate = true;
                }
            });
            renderer.capeTextureKey = record.dataUrl;
        }

        const state = this._getPhysicsState(entity, partialTicks);
        const interpolatedX = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        const interpolatedY = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        const interpolatedZ = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;
        const bodyYaw = (entity.prevRenderYawOffset +
            (entity.renderYawOffset - entity.prevRenderYawOffset) * partialTicks) * Math.PI / 180;

        const sinYaw = Math.sin(bodyYaw);
        const cosYaw = -Math.cos(bodyYaw);
        let capeFlap = (state.y - interpolatedY) * 10;
        capeFlap = Math.max(-6, Math.min(32, capeFlap));

        let capeLean = ((state.x - interpolatedX) * sinYaw +
            (state.z - interpolatedZ) * cosYaw) * 100;
        capeLean = Math.max(0, Math.min(150, capeLean));

        let capeLean2 = ((state.x - interpolatedX) * cosYaw -
            (state.z - interpolatedZ) * sinYaw) * 100;
        capeLean2 = Math.max(-20, Math.min(20, capeLean2));

        const walk = entity.limbSwingProgress - entity.limbSwingStrength * (1 - partialTicks);
        const bob = (entity.prevCameraYaw || 0) + ((entity.cameraYaw || 0) - (entity.prevCameraYaw || 0)) * partialTicks;
        capeFlap += Math.sin(walk * 6) * 32 * bob;

        const capeX = (6 + capeLean / 2 + capeFlap) * Math.PI / 180;
        const capeZ = (capeLean2 / 2) * Math.PI / 180;
        this._applyCapePose(renderer, capeX, capeZ);
    }

    _applyCapePose(renderer, capeX, capeZ) {
        const cape = renderer.capeModel;
        if (!cape) return;

        const yAxis = new THREE.Vector3(0, 1, 0);
        const xAxis = new THREE.Vector3(1, 0, 0);
        const zAxis = new THREE.Vector3(0, 0, 1);
        const pose = new THREE.Quaternion()
            .setFromAxisAngle(yAxis, Math.PI)
            .multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, -Math.PI))
            .multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, capeX))
            .multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, capeZ))
            .multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, Math.PI - capeZ));
        const euler = new THREE.Euler().setFromQuaternion(pose, "ZYX");
        cape.setRotationAngle(euler.x, euler.y, euler.z);
        cape.render();
    }

    _getPhysicsState(entity, partialTicks) {
        const tick = Number.isFinite(entity.ticksExisted) ? entity.ticksExisted : Math.floor(performance.now() / 50);
        if (!entity.__capePlusPhysics) {
            entity.__capePlusPhysics = {
                x: entity.x,
                y: entity.y,
                z: entity.z,
                prevX: entity.x,
                prevY: entity.y,
                prevZ: entity.z,
                tick
            };
        }

        const state = entity.__capePlusPhysics;
        if (state.tick !== tick) {
            const steps = Math.min(20, Math.max(1, tick - state.tick));
            state.tick = tick;
            for (let i = 0; i < steps; i++) {
                state.prevX = state.x;
                state.prevY = state.y;
                state.prevZ = state.z;

                const dx = entity.x - state.x;
                const dy = entity.y - state.y;
                const dz = entity.z - state.z;
                if (dx * dx + dy * dy + dz * dz > 64) {
                    state.x = state.prevX = entity.x;
                    state.y = state.prevY = entity.y;
                    state.z = state.prevZ = entity.z;
                    break;
                }
                state.x += dx * 0.25;
                state.y += dy * 0.25;
                state.z += dz * 0.25;
            }
        }

        return {
            x: state.prevX + (state.x - state.prevX) * partialTicks,
            y: state.prevY + (state.y - state.prevY) * partialTicks,
            z: state.prevZ + (state.z - state.prevZ) * partialTicks
        };
    }
}