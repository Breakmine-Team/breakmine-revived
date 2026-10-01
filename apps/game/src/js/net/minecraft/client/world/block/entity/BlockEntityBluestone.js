import BlockEntity from "../BlockEntity.js";
import TagInt from "../../../../nbt/tag/builtin/IntTag.js";

/**
 * BlockEntityBluestone — persistent state for any Bluestone (redstone-like)
 * block. The block's data nibble stays the live runtime state (the renderer
 * and all existing Bluestone logic read it), while this entity mirrors that
 * value into NBT so it round-trips through the save system.
 *
 * The world keeps entity <-> data nibble in sync automatically:
 *   - World.setBlockDataAt() forwards the new value to readFromBlockData()
 *   - World.setBlockAt() seeds a freshly created entity from the nibble
 *   - Chunk.deserialize() restores the nibble from NBT via applyToChunk()
 */
export default class BlockEntityBluestone extends BlockEntity {

    static id = "bluestone";

    constructor(world, x, y, z) {
        super(world, x, y, z);
        this.data = 0;
    }

    /**
     * Mirror a new block-data nibble value into this entity. Called by
     * World.setBlockDataAt() whenever a bluestone block's data changes.
     */
    readFromBlockData(data) {
        this.data = data | 0;
        return this;
    }

    /**
     * Current nibble value stored by this entity.
     */
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

    /**
     * Write this entity's state back into a chunk's data nibble. Used when
     * loading from save (before the chunk is registered with the provider,
     * so it must go through the chunk directly rather than the world).
     */
    applyToChunk(chunk) {
        if (!chunk) return;
        chunk.setBlockDataAt(this.x & 15, this.y, this.z & 15, this.data);
    }
}
