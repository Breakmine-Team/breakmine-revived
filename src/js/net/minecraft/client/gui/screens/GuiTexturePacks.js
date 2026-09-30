import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiTexturePackSlotContainer from "../widgets/GuiTexturePackSlotContainer.js";
import FileSystem from "../../fs/Filesystem.js";
import * as THREE from "../../../../../../../libraries/three.module.js";
import { loadJSZip } from "../../JSZipLoader.js";

function parseToml(str) {
    const result = {};
    let currentSection = null;
    
    const lines = str.split(/\r?\n/);
    for (let line of lines) {
        line = line.trim();
        
        if (!line || line.startsWith('#')) continue;
        
        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1];
            if (!result[currentSection]) result[currentSection] = {};
            continue;
        }
        
        const kvMatch = line.match(/^([^=]+?)\s*=\s*(.*)$/);
        if (kvMatch) {
            let key = kvMatch[1].trim();
            let value = kvMatch[2].trim();
            
            if ((value.startsWith('"') && value.endsWith('"')) || 
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            
            if (currentSection) {
                result[currentSection][key] = value;
            } else {
                result[key] = value;
            }
        }
    }
    
    return result;
}

export default class GuiTexturePacks extends GuiScreen {

    constructor(previousScreen) {
        super();

        this.previousScreen = previousScreen;
        this.texturePackSlotContainer = null;
        this.selectedPack = -1;
        this.texturePacks = [];
        this.filesystem = new FileSystem('TexturePackDB', 'texture_packs');
        this.isInitialized = false;
    }

    setSelectedPack(index) {
        this.selectedPack = index;
        const bool = (index >= 0 && index < this.texturePacks.length);
        this.buttonSelect.enabled = bool;
        // Disable delete for default pack
        const isDefault = this.texturePacks[index]?.id === 'default';
        this.buttonDelete.enabled = bool && !isDefault;
    }

    async init() {
        super.init();

        // Initialize container with empty list first
        this.texturePackSlotContainer = new GuiTexturePackSlotContainer(this, this.texturePacks);
        this.isInitialized = true;

        // Load existing texture packs
        await this.loadTexturePacks();

        // Update container with loaded packs
        this.texturePackSlotContainer = new GuiTexturePackSlotContainer(this, this.texturePacks);

        this.buttonSelect = new GuiButton(this.minecraft, "Select Pack", this.width / 2 - 155, this.height - 28, 150, 20, async () => {
            if (this.selectedPack !== -1) {
                const pack = this.texturePacks[this.selectedPack];
                await this.applyTexturePack(pack);
                this.minecraft.displayScreen(this.previousScreen);
            }
        });

        this.buttonUpload = new GuiButton(this.minecraft, "Upload .zip", this.width / 2 + 5, this.height - 52, 150, 20, () => {
            this.uploadTexturePack();
        });

        this.buttonDelete = new GuiButton(this.minecraft, "Delete", this.width / 2 - 155, this.height - 52, 150, 20, async () => {
            if (this.selectedPack !== -1) {
                const pack = this.texturePacks[this.selectedPack];
                await this.deleteTexturePack(pack.id);
                await this.loadTexturePacks();
                this.texturePackSlotContainer = new GuiTexturePackSlotContainer(this, this.texturePacks);
                this.selectedPack = -1;
                this.buttonSelect.enabled = false;
                this.buttonDelete.enabled = false;
            }
        });

        this.buttonList.push(new GuiButton(this.minecraft, "Back", this.width / 2 + 5, this.height - 28, 150, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
        
        this.buttonList.push(this.buttonSelect);
        this.buttonList.push(this.buttonUpload);
        this.buttonList.push(this.buttonDelete);
        
        this.buttonSelect.enabled = false;
        this.buttonDelete.enabled = false;
    }

    async loadTexturePacks() {
        this.texturePacks = [];
        
        // Add default preset pack
        this.texturePacks.push({
            id: 'default',
            name: 'Simplistic',
            description: 'The default look of Breakmine',
            version: '1.0',
            author: 'SpinningCubes'
        });
        
        const packFiles = await this.filesystem.listDir('texture_packs/');
        
        // Get all subdirectories in texture_packs/
        for (const fileName of packFiles) {
            if (fileName.endsWith('/meta.json') || fileName.endsWith('/meta.toml')) {
                const metadata = await this.filesystem.loadFile(fileName);
                if (!metadata) continue;
                let packData = null;
                try {
                    packData = fileName.endsWith('.json') ? JSON.parse(metadata) : toml.parse(metadata);
                } catch (e) {
                    console.error('Failed to parse texture pack metadata:', e);
                    continue;
                }
                const packId = packData.id || fileName.split('/').slice(-2, -1)[0];
                this.texturePacks.push({
                    id: packId,
                    name: packData.name || 'Unknown Pack',
                    description: packData.description || 'No description',
                    version: packData.version || 'Unknown',
                    author: packData.author || 'Unknown'
                });
            }
        }
    }

    uploadTexturePack() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.processZipFile(file);
            }
        };
        input.click();
    }

    async processZipFile(file) {
        const JSZip = await loadJSZip();

        try {
            const zip = await JSZip.loadAsync(file);
            
            // Look for pack.mcmeta or pack.json
            let metadata = null;
            let packId = 'pack_' + Date.now();
            
            for (const [path, zipEntry] of Object.entries(zip.files)) {
                if (path.endsWith('pack.mcmeta') || path.endsWith('pack.json')) {
                    const content = await zipEntry.async('string');
                    metadata = JSON.parse(content);
                    break;
                }
            }
            
            // If no metadata found, create default
            if (!metadata) {
                metadata = {
                    pack: {
                        pack_format: 15,
                        description: file.name.replace('.zip', '')
                    }
                };
            }
            
            const packData = {
                id: packId,
                name: metadata.pack?.description || file.name.replace('.zip', ''),
                description: metadata.pack?.description || 'Custom texture pack',
                version: metadata.pack?.pack_format || 'Unknown',
                author: 'Unknown'
            };
            
            const metadataFilePath = `texture_packs/${packId}/meta.json`;
            await this.filesystem.saveFile(JSON.stringify(packData), metadataFilePath);
            
            // Extract and save textures
            for (const [path, zipEntry] of Object.entries(zip.files)) {
                if (!zipEntry.dir) {
                    const content = await zipEntry.async('base64');
                    
                    // Handle simplified structure: /blocks and /items at root
                    if (path.startsWith('blocks/') || path.startsWith('items/')) {
                        const relativePath = path;
                        await this.filesystem.saveBinaryFile(content, `texture_packs/${packId}/${relativePath}.b64`);
                    }
                    // Also support standard Minecraft structure for compatibility
                    else if (path.startsWith('assets/minecraft/textures/')) {
                        const relativePath = path.replace('assets/minecraft/textures/', '');
                        await this.filesystem.saveBinaryFile(content, `texture_packs/${packId}/${relativePath}.b64`);
                    }
                    // Support old textures/ prefix
                    else if (path.startsWith('textures/')) {
                        const relativePath = path.replace('textures/', '');
                        await this.filesystem.saveBinaryFile(content, `texture_packs/${packId}/${relativePath}.b64`);
                    }
                }
            }
            
            // Reload the list
            await this.loadTexturePacks();
            this.texturePackSlotContainer = new GuiTexturePackSlotContainer(this, this.texturePacks);
            
        } catch (error) {
            console.error('Failed to process zip file:', error);
            alert('Failed to load texture pack: ' + error.message);
        }
    }

    async applyTexturePack(pack) {
        // Store the selected pack ID in settings
        if (pack.id === 'default') {
            this.minecraft.settings.selectedTexturePack = null;
        } else {
            this.minecraft.settings.selectedTexturePack = pack.id;
        }
        this.minecraft.settings.save();
        
        // Reload the texture atlas with the new pack
        if (this.minecraft.worldRenderer && this.minecraft.worldRenderer.textureAtlas) {
            if (pack.id === 'default') {
                this.minecraft.worldRenderer.textureAtlas.texturePath = "terrain/pack/minecraft/textures/blocks/";
            } else {
                this.minecraft.worldRenderer.textureAtlas.texturePath = `texture_packs/${pack.id}/`;
            }
            await this.minecraft.worldRenderer.textureAtlas.loadTextures();
            
            // Rebind renderers to new texture
            if (this.minecraft.worldRenderer.blockRenderer) {
                this.minecraft.worldRenderer.blockRenderer.tessellator.bindTexture(this.minecraft.worldRenderer.textureAtlas.getTexture());
            }
            
            // Update translucent batcher material
            if (this.minecraft.worldRenderer.translucentBatcher) {
                this.minecraft.worldRenderer.translucentBatcher.mesh.material.map = this.minecraft.worldRenderer.textureAtlas.getTexture();
                this.minecraft.worldRenderer.translucentBatcher.mesh.material.needsUpdate = true;
            }
            
            // Update block break material
            if (this.minecraft.worldRenderer.blockBreakMaterial) {
                this.minecraft.worldRenderer.blockBreakMaterial.map = this.minecraft.worldRenderer.textureAtlas.getTexture().clone();
                this.minecraft.worldRenderer.blockBreakMaterial.map.offset.set(0, 0);
                this.minecraft.worldRenderer.blockBreakMaterial.map.repeat.set(1, 1);
                this.minecraft.worldRenderer.blockBreakMaterial.map.wrapS = THREE.RepeatWrapping;
                this.minecraft.worldRenderer.blockBreakMaterial.map.wrapT = THREE.RepeatWrapping;
            }
            
            // Rebuild all chunks to apply new textures
            if (this.minecraft.world) {
                const chunks = this.minecraft.world.getChunkProvider().getChunks();
                for (const [key, chunk] of chunks) {
                    chunk.setNeedsRebuild();
                }
            }
        }
    }

    async deleteTexturePack(packId) {
        // Delete metadata
        await this.filesystem.deleteFile(`texture_packs/${packId}/meta.json`);
        
        // Delete all texture files for this pack
        const packFiles = await this.filesystem.listDir(`texture_packs/${packId}/`);
        for (const file of packFiles) {
            await this.filesystem.deleteFile(`texture_packs/${packId}/${file}`);
        }
        
        // If this was the selected pack, clear it
        if (this.minecraft.settings.selectedTexturePack === packId) {
            this.minecraft.settings.selectedTexturePack = null;
            this.minecraft.settings.save();
            
            // Reload default textures
            if (this.minecraft.worldRenderer && this.minecraft.worldRenderer.textureAtlas) {
                this.minecraft.worldRenderer.textureAtlas.texturePath = "terrain/pack/minecraft/textures/blocks/";
                await this.minecraft.worldRenderer.textureAtlas.loadTextures();
                
                // Rebind renderers to new texture
                if (this.minecraft.worldRenderer.blockRenderer) {
                    this.minecraft.worldRenderer.blockRenderer.tessellator.bindTexture(this.minecraft.worldRenderer.textureAtlas.getTexture());
                }
                
                // Update translucent batcher material
                if (this.minecraft.worldRenderer.translucentBatcher) {
                    this.minecraft.worldRenderer.translucentBatcher.mesh.material.map = this.minecraft.worldRenderer.textureAtlas.getTexture();
                    this.minecraft.worldRenderer.translucentBatcher.mesh.material.needsUpdate = true;
                }
                
                // Update block break material
                if (this.minecraft.worldRenderer.blockBreakMaterial) {
                    this.minecraft.worldRenderer.blockBreakMaterial.map = this.minecraft.worldRenderer.textureAtlas.getTexture().clone();
                    this.minecraft.worldRenderer.blockBreakMaterial.map.offset.set(0, 0);
                    this.minecraft.worldRenderer.blockBreakMaterial.map.repeat.set(1, 1);
                    this.minecraft.worldRenderer.blockBreakMaterial.map.wrapS = THREE.RepeatWrapping;
                    this.minecraft.worldRenderer.blockBreakMaterial.map.wrapT = THREE.RepeatWrapping;
                }
                
                // Rebuild all chunks to apply new textures
                if (this.minecraft.world) {
                    const chunks = this.minecraft.world.getChunkProvider().getChunks();
                    for (const [key, chunk] of chunks) {
                        chunk.setNeedsRebuild();
                    }
                }
            }
        }
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        if (this.texturePackSlotContainer) {
            this.texturePackSlotContainer.drawScreen(stack, mouseX, mouseY, partialTicks);
        }
        this.drawCenteredString(stack, "Texture Packs", this.width / 2, 20);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.texturePackSlotContainer) {
            this.texturePackSlotContainer.mouseClicked(mouseX, mouseY, mouseButton);
        }
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    // Forward drag/release so the scrollbar thumb can be dragged.
    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.texturePackSlotContainer) {
            this.texturePackSlotContainer.mouseDragged(mouseX, mouseY, mouseButton);
        }
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        if (this.texturePackSlotContainer) {
            this.texturePackSlotContainer.mouseReleased(mouseX, mouseY, mouseButton);
        }
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

    mouseScrolled(mouseX, mouseY, amount) {
        if (this.texturePackSlotContainer) {
            this.texturePackSlotContainer.mouseScrolled(mouseX, mouseY, amount);
        }
        super.mouseScrolled(mouseX, mouseY, amount);
    }

    onScroll(mouseX, mouseY, amount) {
        if (this.texturePackSlotContainer) {
            this.texturePackSlotContainer.mouseScrolled(mouseX, mouseY, amount);
        }
    }

    onClose() {

    }
}
