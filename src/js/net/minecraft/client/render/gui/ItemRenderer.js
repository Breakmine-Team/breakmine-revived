import * as THREE from "../../../../../../../libraries/three.module.js";
import BlockRenderType from "../../../util/BlockRenderType.js";
import EnumBlockFace from "../../../util/EnumBlockFace.js";

export default class ItemRenderer {

    constructor(minecraft, window) {
        this.minecraft = minecraft;
        this.window = window;

        this.items = [];
        this.itemSprites = new Map();
        this.dirtyGroups = new Set();
        this.zIndex = 0;

        // Both item layers are window-sized and are composited over the world
        // every frame. This tracks what they currently show so they are only
        // redrawn when their contents (or the size / atlas) really change -
        // the HUD asks for the same sprites every frame.
        this.revision = 0;
        this.drawnRevision = -1;
        this.drawnGuiScale = -1;
        this.drawnCanvasWidth = -1;
        this.drawnCanvasHeight = -1;
        this.drawnItemsWidth = -1;
        this.drawnItemsHeight = -1;
        this.drawnAtlasImage = null;
    }

    initialize() {
        this.camera = new THREE.OrthographicCamera(0, 0, 0, 0, -15, 15);
        this.camera.rotation.order = 'ZYX';
        this.camera.up = new THREE.Vector3(0, 1, 0);

        this.scene = new THREE.Scene();
        this.scene.matrixAutoUpdate = false;

        this.webRenderer = new THREE.WebGLRenderer({
            canvas: this.window.canvasItems,
            antialias: true
        });

        this.webRenderer.setSize(this.window.width, this.window.height);
        this.webRenderer.shadowMap.enabled = true;
        this.webRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.webRenderer.autoClear = false;
        this.webRenderer.sortObjects = false;
        this.webRenderer.setClearColor(0x000000, 0);
        this.webRenderer.clear();

        this.canvas2d = document.createElement('canvas');
        this.ctx2d = this.canvas2d.getContext('2d');
        this.ctx2d.imageSmoothingEnabled = false;

        this.tintCanvas = document.createElement('canvas');
        this.tintCanvas.width = 16;
        this.tintCanvas.height = 16;
        this.tintCtx = this.tintCanvas.getContext('2d');
        this.tintCtx.imageSmoothingEnabled = false;
    }

    render(partialTicks) {
        let atlas = this.minecraft.worldRenderer?.textureAtlas;
        let image = (atlas && atlas.isLoaded()) ? atlas.canvas : null;
        let fallbackImage = this.minecraft.worldRenderer?.textureTerrain?.image;
        let guiScale = Math.min(this.window.scaleFactor, 4);

        // Redraw only when something that ends up on these canvases changed.
        // Clearing and re-rendering them every frame meant a full-size webgl
        // clear plus a static scene re-render, a full-size 2D clear and the
        // same sprite draws - all of it thrown away again one frame later.
        let needsRedraw = this.revision !== this.drawnRevision
            || guiScale !== this.drawnGuiScale
            || this.canvas2d.width !== this.drawnCanvasWidth
            || this.canvas2d.height !== this.drawnCanvasHeight
            || this.window.canvasItems.width !== this.drawnItemsWidth
            || this.window.canvasItems.height !== this.drawnItemsHeight
            || image !== this.drawnAtlasImage;

        if (!needsRedraw) {
            return;
        }

        this.drawnRevision = this.revision;
        this.drawnGuiScale = guiScale;
        this.drawnCanvasWidth = this.canvas2d.width;
        this.drawnCanvasHeight = this.canvas2d.height;
        this.drawnItemsWidth = this.window.canvasItems.width;
        this.drawnItemsHeight = this.window.canvasItems.height;
        this.drawnAtlasImage = image;

        // autoClear is off, so every redraw starts with an explicit wipe; a
        // redraw may follow items that moved or disappeared.
        this.webRenderer.clear();

        if (this.scene.children.length > 0) {
            this.camera.left = -this.window.width / 2;
            this.camera.right = this.window.width / 2;
            this.camera.top = this.window.height / 2;
            this.camera.bottom = -this.window.height / 2;
            this.camera.setViewOffset(this.window.width, this.window.height, this.window.width / 2, this.window.height / 2, this.window.width, this.window.height);
            this.camera.updateProjectionMatrix();

            this.webRenderer.render(this.scene, this.camera);
        }

        this.ctx2d.clearRect(0, 0, this.canvas2d.width, this.canvas2d.height);
        if (!image && !fallbackImage) {
            return;
        }

        this.ctx2d.save();
        this.ctx2d.scale(guiScale, guiScale);

        let sorted = Array.from(this.itemSprites.values()).sort((a, b) => a.zIndex - b.zIndex);
        for (const entry of sorted) {
            this._drawSprite(entry, image || fallbackImage);
        }

        this.ctx2d.restore();
    }

    /** True when the 3D item layer holds anything to composite. */
    hasBlockItems() {
        return this.scene.children.length > 0;
    }

    /** True when the 2D sprite layer holds anything to composite. */
    hasSprites() {
        return this.itemSprites.size > 0;
    }

    prepareRender(groupId) {
        if (this.dirtyGroups.has(groupId)) {
            this.dirtyGroups.delete(groupId);
            this.destroy(groupId);
        }
    }

    renderItemInGui(groupId, renderId, block, x, y, brightness = 1) {
        if (block.getRenderType() === BlockRenderType.BLOCK) {
            this._renderBlockInGui(groupId, renderId, block, x, y, brightness);
        } else {
            this._renderSpriteInGui(groupId, renderId, block, x, y, brightness);
        }
    }

    _renderBlockInGui(groupId, renderId, block, x, y, brightness) {
        let pairId = groupId + ':' + renderId;
        let meta = this.items[pairId];
        if (typeof meta === "undefined") {
            let meta = {};

            let group = new THREE.Group();
            this.minecraft.worldRenderer.blockRenderer.renderGuiBlock(group, block, x, y, 10, brightness);
            group.position.z = this.zIndex;
            group.updateMatrix();
            this.scene.add(group);

            meta.renderId = renderId;
            meta.groupId = groupId;
            meta.group = group;
            meta.brightness = brightness;
            meta.typeId = block.getId();
            meta.x = x;
            meta.y = y;
            meta.zIndex = this.zIndex;
            meta.dirty = false;
            this.items[pairId] = meta;
            this.revision++;
        } else {
            if (meta.dirty || meta.typeId !== block.getId() || meta.x !== x || meta.y !== y || meta.brightness !== brightness || meta.zIndex !== this.zIndex) {
                this.scene.remove(meta.group);
                delete this.items[pairId];
                this._renderBlockInGui(groupId, renderId, block, x, y, brightness);
            }
        }
    }

    _renderSpriteInGui(groupId, renderId, block, x, y, brightness) {
        let pairId = groupId + ':' + renderId;
        let textureName = block.getTextureForFace(EnumBlockFace.NORTH);
        let existing = this.itemSprites.get(pairId);

        // The HUD asks for the same sprites every frame. Only touch the layer
        // when an entry actually changes, so the redraw check in render()
        // stays meaningful (and a static hotbar stops reallocating an entry
        // per slot per frame).
        if (existing && existing.block.getId() === block.getId()
            && existing.x === x && existing.y === y
            && existing.brightness === brightness && existing.zIndex === this.zIndex
            && existing.textureName === textureName) {
            return;
        }

        this.itemSprites.set(pairId, {
            groupId,
            renderId,
            block,
            x,
            y,
            brightness,
            zIndex: this.zIndex,
            textureName
        });
        this.revision++;
    }

    _drawSprite(entry, image) {
        let { block, x, y, brightness, textureName } = entry;

        let sx, sy, sw, sh;
        let atlas = this.minecraft.worldRenderer?.textureAtlas;

        if (atlas && atlas.isLoaded() && atlas.canvas === image) {
            let coords = atlas.getTextureCoords(textureName);
            sx = coords.x;
            sy = coords.y;
            sw = 16;
            sh = 16;
        } else {
            let textureIndex = block.getTextureForFace(EnumBlockFace.NORTH);
            let texPerRow = 16;
            let spriteSize = 16;
            sx = (textureIndex % texPerRow) * spriteSize;
            sy = Math.floor(textureIndex / texPerRow) * spriteSize;
            sw = spriteSize;
            sh = spriteSize;
        }

        let color = block.getColor(null, 0, 0, 0, EnumBlockFace.NORTH);
        let isTinted = color !== 0xffffff;

        this.ctx2d.save();
        this.ctx2d.globalAlpha = Math.min(1, Math.max(0, brightness));

        if (isTinted) {
            let red = color >> 16 & 255;
            let green = color >> 8 & 255;
            let blue = color & 255;

            let tctx = this.tintCtx;
            tctx.globalCompositeOperation = 'source-over';
            tctx.globalAlpha = 1;
            tctx.clearRect(0, 0, 16, 16);
            tctx.drawImage(image, sx, sy, sw, sh, 0, 0, 16, 16);
            tctx.globalCompositeOperation = 'multiply';
            tctx.fillStyle = `rgb(${red},${green},${blue})`;
            tctx.fillRect(0, 0, 16, 16);
            tctx.globalCompositeOperation = 'destination-in';
            tctx.drawImage(image, sx, sy, sw, sh, 0, 0, 16, 16);

            this.ctx2d.drawImage(this.tintCanvas, x - 8, y - 8);
        } else {
            this.ctx2d.drawImage(image, sx, sy, sw, sh, x - 8, y - 8, 16, 16);
        }
        this.ctx2d.restore();
    }

    rebuildAllItems() {
        for (let i in this.items) {
            this.items[i].dirty = true;
        }
        this.itemSprites.clear();
        this.revision++;
    }

    reset() {
        for (let i in this.items) {
            this.scene.remove(this.items[i].group);
        }
        this.items = [];
        this.itemSprites.clear();
        this.webRenderer.clear();
        // The sprite layer has to be wiped here as well: render() only redraws
        // it when its contents change, and it is still composited every frame.
        this.ctx2d.clearRect(0, 0, this.canvas2d.width, this.canvas2d.height);
        this.revision++;
    }

    scheduleDirty(groupId) {
        this.dirtyGroups.add(groupId);
    }

    destroy(groupId, renderId = null) {
        let changed = false;

        for (let i in this.items) {
            if (this.items[i].groupId === groupId && (renderId === null || this.items[i].renderId === renderId)) {
                this.scene.remove(this.items[i].group);
                delete this.items[i];
                changed = true;
            }
        }
        for (const [key, entry] of this.itemSprites) {
            if (entry.groupId === groupId && (renderId === null || entry.renderId === renderId)) {
                this.itemSprites.delete(key);
                changed = true;
            }
        }

        if (changed) {
            this.revision++;
        }
    }
}
