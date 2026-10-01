import TagCompound from "../../../nbt/tag/TagCompound.js";
import TagString from "../../../nbt/tag/builtin/StringTag.js";
import TagInt from "../../../nbt/tag/builtin/IntTag.js";

/**
 * BlockEntity — per-block persistent state stored as NBT.
 *
 * Equivalent to Minecraft's TileEntity. A block opts in by overriding
 * `Block.hasBlockEntity()` to return true and `Block.createBlockEntity()`
 * to return an instance of a BlockEntity subclass. The World then:
 *
 *   - creates the entity when the block is placed
 *   - removes it when the block is destroyed or replaced
 *   - ticks it via update() (when the world ticks block entities)
 *   - serializes/deserializes it through Chunk.serialize() / deserialize()
 *
 * Subclasses MUST define a unique static `id` (string) used for save/load
 * round-tripping, and SHOULD register themselves with BlockEntityRegistry
 * at module load time.
 */
export default class BlockEntity {

    /** Unique string identifier — override in subclasses. */
    static id = "BlockEntity";

    constructor(world, x, y, z) {
        this.world = world;
        this.x = x | 0;
        this.y = y | 0;
        this.z = z | 0;
        this._dirty = false;
        this._closed = false;
    }

    /**
     * Returns the registry id (string) for this entity.
     */
    getId() {
        return this.constructor.id;
    }

    setPosition(x, y, z) {
        this.x = x | 0;
        this.y = y | 0;
        this.z = z | 0;
        return this;
    }

    /**
     * Persist this entity's state into the supplied TagCompound.
     *
     * Default implementation writes `id`, `x`, `y`, `z`. Subclasses should
     * call `super.writeToNBT(tag)` first, then write their own fields.
     */
    writeToNBT(tag) {
        tag.put(new TagString("id", this.getId()));
        tag.put(new TagInt("x", this.x));
        tag.put(new TagInt("y", this.y));
        tag.put(new TagInt("z", this.z));
    }

    /**
     * Restore this entity's state from the supplied TagCompound.
     *
     * Default implementation reads `x`, `y`, `z` (id is consumed by the
     * registry to pick the right subclass). Subclasses should call
     * `super.readFromNBT(tag)` first, then read their own fields.
     */
    readFromNBT(tag) {
        this.x = tag.getValue("x", this.x) | 0;
        this.y = tag.getValue("y", this.y) | 0;
        this.z = tag.getValue("z", this.z) | 0;
    }

    /**
     * Convenience: serialize to a fresh TagCompound.
     */
    saveToNBT() {
        let tag = new TagCompound("");
        this.writeToNBT(tag);
        return tag;
    }

    /**
     * Per-tick update. Override in subclasses that need ticking.
     * Called by World.tickBlockEntities() once per game tick.
     */
    update() {
        // override
    }

    /**
     * Mark this entity as having unsaved changes. The World listens and marks
     * the owning chunk as modified so the save system picks it up.
     */
    markDirty() {
        this._dirty = true;
        if (this.world && typeof this.world.onBlockEntityChanged === "function") {
            this.world.onBlockEntityChanged(this);
        }
        return this;
    }

    isDirty() {
        return this._dirty;
    }

    clearDirty() {
        this._dirty = false;
        return this;
    }

    /**
     * Called when the entity is removed from the world (block destroyed,
     * chunk unloaded, world closed). Override to release resources.
     */
    onClose() {
        this._closed = true;
    }

    isClosed() {
        return this._closed;
    }

    /**
     * Called by the block's onUse handler (via World.useBlockEntity) when a
     * player right-clicks the block. Override to implement UI / interactions.
     * Return true to consume the interaction.
     */
    onInteract(player, itemstack) {
        return false;
    }

    /**
     * Helper used by the registry to construct + hydrate an entity from NBT
     * without exposing constructor details to callers.
     */
    static createFromNBT(world, x, y, z, tag) {
        let entity = new this(world, x, y, z);
        entity.readFromNBT(tag);
        return entity;
    }
}
