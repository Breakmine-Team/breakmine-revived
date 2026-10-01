import ChunkProvider from "./ChunkProvider.js";
import Chunk from "../Chunk.js";

export default class ChunkProviderClient extends ChunkProvider {

    constructor(world) {
        super(world);

        this.emptyChunk = new Chunk(world, 0, 0);
        this.emptyChunk.generateSkylightMap();
        this.emptyChunk.generateBlockLightMap();
    }

    getChunkAt(x, z) {
        let index = x + (z << 16);
        let chunk = this.chunks.get(index);
        return typeof chunk === 'undefined' ? this.emptyChunk : chunk;
    }

    loadChunk(x, z) {
        let index = x + (z << 16);

        // Fully remove any existing chunk at these coordinates
        let existing = this.chunks.get(index);
        if (typeof existing !== 'undefined') {
            this.world.group.remove(existing.group);
            for (const section of existing.sections) {
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
            this.chunks.delete(index);
        }

        let chunk = new Chunk(this.world, x, z);
        chunk.generateSkylightMap();
        chunk.generateBlockLightMap();
        chunk.loaded = true;
        this.chunks.set(index, chunk);
        this.world.group.add(chunk.group);

        return chunk;
    }

}