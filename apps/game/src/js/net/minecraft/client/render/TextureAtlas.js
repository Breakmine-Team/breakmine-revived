import * as THREE from "../../../../../../libraries/three.module.js";
import { base64Assets } from "../../../../../resources.js";
import { atlasBlockTextures, atlasItemTextures } from "../../../../assetManifest.js";

export default class TextureAtlas {

    constructor(minecraft, texturePath = "terrain/pack/minecraft/textures/blocks/") {
        this.minecraft = minecraft;
        this.texturePath = texturePath;
        this.textureSize = 16;
        this.atlasSize = 1024;
        this.texturesPerRow = this.atlasSize / this.textureSize;
        
        this.textureMap = new Map();
        this.reverseTextureMap = new Map();
        this.textureNameToSlotId = new Map();
        this.canvas = null;
        this.texture = null;
        this.loaded = false;
        this._nextModIndex = 0;
        
        this.initializeTextureNameToSlotId();
    }

    initializeTextureNameToSlotId() {
        const mapping = {
            'stone': 0, 'dirt': 1, 'grass_top': 2, 'grass_side': 3,
            'cobblestone': 4, 'planks_oak': 5, 'bedrock': 6, 'sand': 7,
            'gravel': 8, 'log_oak': 9, 'log_oak_top': 10, 'leaves_oak_opaque': 11,
            'glass': 12, 'water_still': 13, 'torch_on': 14, 'apple': 15
        };

        for (const [name, slotId] of Object.entries(mapping)) {
            this.textureNameToSlotId.set(name, slotId);
        }
    }

    registerTexture(name, slotId) {
        this.textureNameToSlotId.set(name, slotId);
    }

    resizeAtlas(newSize = 512) {
        if (this.loaded) {
            console.warn('[TextureAtlas] Cannot resize atlas after textures are loaded.');
            return;
        }
        if (newSize % this.textureSize !== 0) {
            console.warn(`[TextureAtlas] Atlas size ${newSize} is not a multiple of texture size ${this.textureSize}`);
            return;
        }
        this.atlasSize = newSize;
        this.texturesPerRow = this.atlasSize / this.textureSize;
        console.log(`[TextureAtlas] Resized to ${newSize}x${newSize} (${this.texturesPerRow}x${this.texturesPerRow} slots)`);
    }

    async loadTextures() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.atlasSize;
        this.canvas.height = this.atlasSize;
        const ctx = this.canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        const textureFiles = await this.getTextureFiles();
        
        let index = 0;
        for (const textureFile of textureFiles) {
            if (index >= this.texturesPerRow * this.texturesPerRow) {
                console.warn("Texture atlas full, skipping remaining textures");
                break;
            }

            try {
                const textureName = this.getTextureName(textureFile);
                const image = await this.loadImage(textureFile);
                
                const x = (index % this.texturesPerRow) * this.textureSize;
                const y = Math.floor(index / this.texturesPerRow) * this.textureSize;
                
                ctx.drawImage(image, x, y, this.textureSize, this.textureSize);
                
                this.textureMap.set(textureName, { x, y, index });
                if (textureName === "oak_planks") {
                    this.textureMap.set("planks_oak", { x, y, index });
                    this.reverseTextureMap.set(index, "planks_oak");
                }
                this.reverseTextureMap.set(index, textureName);
                
                index++;
            } catch (error) {
                console.error(`Failed to load texture: ${textureFile}`, error);
            }
        }

        this._nextModIndex = index;

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.magFilter = THREE.NearestFilter;
        this.texture.minFilter = THREE.NearestFilter;
        this.texture.wrapS = THREE.RepeatWrapping;
        this.texture.wrapT = THREE.RepeatWrapping;
        this.texture.generateMipmaps = false;
        
        this.loaded = true;
        console.log(`Texture atlas loaded with ${index} textures`);
        
        return this.texture;
    }

    registerModTexture(namespacedKey, image) {
        if (!this.canvas) {
            console.warn('[TextureAtlas] Cannot register mod texture — atlas not yet built.');
            return { x: 0, y: 0, index: 0 };
        }

        const maxSlots = this.texturesPerRow * this.texturesPerRow;
        if (this._nextModIndex >= maxSlots) {
            console.error(`[TextureAtlas] Atlas full (${maxSlots} slots). Cannot register mod texture '${namespacedKey}'.`);
            return { x: 0, y: 0, index: 0 };
        }

        const index = this._nextModIndex++;
        const x = (index % this.texturesPerRow) * this.textureSize;
        const y = Math.floor(index / this.texturesPerRow) * this.textureSize;

        const ctx = this.canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, 0, 0, this.textureSize, this.textureSize, x, y, this.textureSize, this.textureSize);

        const coords = { x, y, index };
        this.textureMap.set(namespacedKey, coords);
        this.reverseTextureMap.set(index, namespacedKey);

        if (this.texture) {
            this.texture.needsUpdate = true;
        }

        console.log(`[TextureAtlas] Registered mod texture '${namespacedKey}' at slot ${index} (${x}, ${y})`);
        return coords;
    }

    async getTextureFiles() {
        const blockTextures = atlasBlockTextures;
        const itemTextures = atlasItemTextures;

        if (this.texturePath.startsWith('texture_packs/')) {
            return [
                ...blockTextures.map(name => 'blocks/' + name),
                ...itemTextures.map(name => 'items/' + name)
            ];
        }

        return [
            ...blockTextures.map(name => 'terrain/pack/minecraft/textures/blocks/' + name),
            ...itemTextures.map(name => 'terrain/pack/minecraft/textures/items/' + name)
        ];
    }

    loadImage(path) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';

            const setupLoadHandlers = (imgSource) => {
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error(`Failed to load image: ${path}`));
                image.src = imgSource;
            };

            if (typeof path === 'string' && path.startsWith('data:image/')) {
                setupLoadHandlers(path);
                return;
            }

            if (this.minecraft.resources && this.minecraft.resources[path]) {
                const resource = this.minecraft.resources[path];
                const src = typeof resource === 'string' ? resource : (resource.src || resource.default);
                setupLoadHandlers(src);
                return;
            }

            if (this.texturePath.startsWith('texture_packs/')) {
                const packId = this.texturePath.split('/')[1];
                let relativePath = path;
                if (path.includes('/')) {
                    relativePath = path.replace(/^terrain\/pack\/minecraft\/textures\/blocks\//, '').replace(/^terrain\/pack\/minecraft\/textures\/items\//, '');
                }
                const fsPath = `texture_packs/${packId}/${relativePath}.b64`;

                if (this.minecraft.filesystem) {
                    this.minecraft.filesystem.loadBinaryFile(fsPath)
                        .then(data => {
                            if (data) {
                                let imageSrc;
                                if (typeof data === 'string' && data.startsWith('data:image/')) {
                                    imageSrc = data;
                                } else if (typeof data === 'string') {
                                    imageSrc = `data:image/png;base64,${data.trim()}`;
                                } else {
                                    const blob = new Blob([data], { type: 'image/png' });
                                    imageSrc = URL.createObjectURL(blob);
                                }

                                image.onload = () => {
                                    if (imageSrc.startsWith('blob:')) URL.revokeObjectURL(imageSrc);
                                    resolve(image);
                                };
                                image.onerror = () => {
                                    if (imageSrc.startsWith('blob:')) URL.revokeObjectURL(imageSrc);
                                    reject(new Error(`Failed to load image from texture pack: ${path}`));
                                };
                                image.src = imageSrc;
                            } else {
                                this.loadDefaultTexture(path, image, resolve, reject);
                            }
                        })
                        .catch(error => {
                            console.warn(`Failed to load from texture pack: ${error.message}, falling back to default`);
                            this.loadDefaultTexture(path, image, resolve, reject);
                        });
                    return;
                }
            }

            this.loadDefaultTexture(path, image, resolve, reject);
        });
    }

    loadDefaultTexture(path, image, resolve, reject) {
        let defaultPath = path;
        
        if (!path.includes('/')) {
            defaultPath = 'terrain/pack/minecraft/textures/blocks/' + path;
        } else if (path.startsWith('blocks/')) {
            defaultPath = 'terrain/pack/minecraft/textures/' + path;
        } else if (path.startsWith('items/')) {
            defaultPath = 'terrain/pack/minecraft/textures/' + path;
        } else {
            defaultPath = path.replace(/^texture_packs\/[^\/]+\//, 'terrain/pack/minecraft/textures/blocks/');
        }

        // 1. Try Base64 map first (for singlefile/standalone bundle execution)
        const base64Data = typeof base64Assets !== 'undefined' ? base64Assets[defaultPath] : null;

        if (base64Data) {
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Failed to decode Base64 texture: ${defaultPath}`));
            image.src = base64Data;
            return;
        }

        // 2. Fall back to standard relative URL loading (for dev server / non-bundled environments)
        const assetUrl = `src/resources/${defaultPath}`;
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load image URL: ${assetUrl}`));
        image.src = assetUrl;
    }

    getTextureName(path) {
        const parts = path.split('/');
        const filename = parts[parts.length - 1];
        return filename.replace('.png', '');
    }

    getTextureCoords(textureName) {
        const coords = this.textureMap.get(textureName);
        if (coords) return coords;

        console.warn(`Texture not found: ${textureName}`);
        return { x: 0, y: 0, index: 0 };
    }

    getTextureIndex(textureName) {
        const coords = this.textureMap.get(textureName);
        return coords ? coords.index : 0;
    }

    getTextureNameByIndex(index) {
        return this.reverseTextureMap.get(index) || null;
    }

    parseModTextureKey(name) {
        if (!name || !name.includes(':')) return null;
        const colonIndex = name.indexOf(':');
        return {
            modId: name.substring(0, colonIndex),
            textureName: name.substring(colonIndex + 1)
        };
    }

    getTexture() {
        return this.texture;
    }

    isLoaded() {
        return this.loaded;
    }

    getUVs(textureName) {
        const coords = this.getTextureCoords(textureName);
        const u = coords.x / this.atlasSize;
        const v = coords.y / this.atlasSize;
        const size = this.textureSize / this.atlasSize;
        
        return {
            minU: u,
            maxU: u + size,
            minV: v,
            maxV: v + size
        };
    }
}