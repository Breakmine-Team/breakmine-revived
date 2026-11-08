import BlockEntity from "../BlockEntity.js";
import TagInt from "../../../../nbt/tag/builtin/IntTag.js";

export default class BlockEntityBluestone extends BlockEntity {

    static id = "bluestone";

    constructor(world, x, y, z) {
        super(world, x, y, z);
        this.data = 0;
    }

    
    readFromBlockData(data) {
        this.data = data | 0;
        return this;
    }

    
    getBlockData() {
        return this.data;
    }

    writeToNBT(tag) {
        super.writeToNBT(tag);
        tag.put(new TagInt("data", this.data));
    }

    readFromNBT(tag) {
        super.readFromNBT(tag);
        this.data = tag.getValue("data", this.data) | 0;
    }

    
    applyToChunk(chunk) {
        if (!chunk) return;
        chunk.setBlockDataAt(this.x & 15, this.y, this.z & 15, this.data);
    }
}
