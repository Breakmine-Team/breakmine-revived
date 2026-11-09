import { BlockRegistry } from "./world/block/BlockRegistry.js";





export default class CctvManager {

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.camera = null;      
        this.viewing = false;
        this.networkManager = null;
        this.statusText = null;  
    }

    onJoin(networkManager) {
        this.networkManager = networkManager || null;
        this.viewing = false;
        this.updateStatusText();
        this.syncMovementLock();

        if (this.networkManager) {
            this.networkManager.sendJson({ type: 'cctv:request' });
        }
    }

    onLeave() {
        this.networkManager = null;
        this.viewing = false;
        this.updateStatusText();
        this.syncMovementLock();
    }

    pair(pos) {
        this.camera = {
            x: Math.floor(pos.x),
            y: Math.floor(pos.y),
            z: Math.floor(pos.z)
        };
        this.viewing = false;
        this.updateStatusText();
        this.syncMovementLock();
        this.send({ type: 'cctv:pair', ...this.camera });
        this.notify("Paired with CCTV camera.");
    }

    handleState(camera) {
        if (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.z)) {
            this.camera = { x: Math.floor(camera.x), y: Math.floor(camera.y), z: Math.floor(camera.z) };
        } else {
            this.camera = null;
        }

        if (!this.camera) {
            this.viewing = false;
        }

        this.updateStatusText();
        this.syncMovementLock();
    }

    getCamera() {
        return this.camera;
    }

    isViewing() {
        return this.viewing && this.camera !== null;
    }

    toggleView() {
        if (!this.camera) return false;

        this.viewing = !this.viewing;
        this.updateStatusText();
        this.syncMovementLock();
        return true;
    }

    onTick() {
        if (this.viewing && this.isCameraGone()) {
            this.viewing = false;
        }

        this.updateStatusText();
        this.syncMovementLock();
    }

    isCameraGone() {
        const world = this.minecraft?.world;
        if (!world || !this.camera) return true;

        const provider = world.getChunkProvider?.();
        if (typeof provider?.chunkExists === "function"
            && !provider.chunkExists(this.camera.x >> 4, this.camera.z >> 4)) {
            return false;
        }

        return world.getBlockAt(this.camera.x, this.camera.y, this.camera.z) !== BlockRegistry.CCTV_CAMERA?.id;
    }

    syncMovementLock() {
        if (!this.minecraft) return;

        if (this.isViewing()) {
            this.minecraft.prohibitMovement?.("cctv");
        } else {
            this.minecraft.allowMovement?.("cctv");
        }
    }

    updateStatusText() {
        const overlay = this.minecraft?.ingameOverlay;
        if (!overlay) return;

        const text = this.isViewing()
            ? `CCTV Camera  ${this.camera.x}, ${this.camera.y}, ${this.camera.z}`
            : "";

        if (text === this.statusText) return;
        this.statusText = text;

        if (text) {
            overlay.setStatusText(text);
        } else {
            overlay.clearStatusText();
        }
    }

    getViewPosition() {
        if (!this.isViewing()) return null;

        const world = this.minecraft?.world;
        const camera = this.camera;
        if (!world || world.getBlockAt(camera.x, camera.y, camera.z) !== BlockRegistry.CCTV_CAMERA?.id) {
            return null;
        }

        const data = world.getBlockDataAt?.(camera.x, camera.y, camera.z) || 0;
        const direction = (data >> 1) & 3;

        let fx = 0, fz = 1;
        if (direction === 1) { fx = -1; fz = 0; }
        else if (direction === 2) { fx = 0; fz = -1; }
        else if (direction === 3) { fx = 1; fz = 0; }

        return {
            x: camera.x + 0.5 + fx * 0.6,
            y: camera.y + 0.5,
            z: camera.z + 0.5 + fz * 0.6
        };
    }

    notify(message) {
        this.minecraft?.addMessageToChat?.(message);
    }

    send(payload) {
        if (this.networkManager?.connected) {
            this.networkManager.sendJson(payload);
        }
    }
}
