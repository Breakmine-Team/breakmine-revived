import World from "./World.js";
import ChunkProviderClient from "./provider/ChunkProviderClient.js";

export default class WorldClient extends World {

    constructor(minecraft) {
        super(minecraft);

        this.setChunkProvider(new ChunkProviderClient(this))
    }
}