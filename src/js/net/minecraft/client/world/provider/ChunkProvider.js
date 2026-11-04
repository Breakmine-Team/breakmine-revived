import Chunk from "../Chunk.js";

export default class ChunkProvider {

    constructor(world) {
        this.world = world;
        this.chunks = new Map();
    }

    chunkExists(x, z) {
        let index = x + (z << 16);
        let chunk = this.chunks.get(index);
        return typeof chunk !== 'undefined';
    }

    getChunkAt(x, z) {
        let index = x + (z << 16);
        let chunk = this.chunks.get(index);
        if (typeof chunk === 'undefined') {
            chunk = this.loadChunk(x, z);
        }
        return chunk;
    }

    generateChunk(x, z) {
        let chunk = new Chunk(this.world, x, z);
        chunk.generateSkylightMap();
        chunk.generateBlockLightMap();
        return chunk;
    }

    populateChunk(chunk) {

    }

    loadChunk(x, z) {
        let index = x + (z << 16);

        // Remove existing chunk at these coordinates before creating a new one
        let existing = this.chunks.get(index);
        if (typeof existing !== 'undefined') {
            this.unloadChunk(x, z);
        }

        let chunk = this.generateChunk(x, z)

        // Register and mark as loaded
        chunk.loaded = true;
        this.chunks.set(index, chunk);

        this.populateChunk(chunk);

        // Register in three.js
        this.world.group.add(chunk.group);

        return chunk;
    }

    unloadChunk(x, z) {
        let index = x + (z << 16);
        let chunk = this.chunks.get(index);
        if (typeof chunk !== 'undefined') {
            this.world.group.remove(chunk.group);
            for (const section of chunk.sections) {
                if (section.group) {
                    while (section.group.children.length > 0) {
                        const child = section.group.children[0];
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => mat.dispose());
                            } else {
                                child.material.dispose();
                            }
                        }
                        section.group.remove(child);
                    }
                }
            }
        }
        this.chunks.delete(index);
    }

    clearChunks() {
        // Remove all chunks from the three.js scene and dispose of their resources
        for (const [index, chunk] of this.chunks) {
            this.world.group.remove(chunk.group);

            // Dispose of all section meshes to free GPU memory
            for (const section of chunk.sections) {
                if (section.group) {
                    // Remove all children (meshes) from the section group
                    while (section.group.children.length > 0) {
                        const child = section.group.children[0];
                        if (child.geometry) {
                            child.geometry.dispose();
                        }
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => mat.dispose());
                            } else {
                                child.material.dispose();
                            }
                        }
                        section.group.remove(child);
                    }
                }
            }
        }
        // Clear the chunks map
        this.chunks.clear();
    }

    getChunks() {
        return this.chunks;
    }

}