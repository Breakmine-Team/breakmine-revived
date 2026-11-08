import TagCompound from "../../../nbt/tag/TagCompound.js";
import TagString from "../../../nbt/tag/builtin/StringTag.js";
import TagInt from "../../../nbt/tag/builtin/IntTag.js";

export default class BlockEntity {

    
    static id = "BlockEntity";

    constructor(world, x, y, z) {
        this.world = world;
        this.x = x | 0;
        this.y = y | 0;
        this.z = z | 0;
        this._dirty = false;
        this._closed = false;
    }

    
    getId() {
        return this.constructor.id;
    }

    setPosition(x, y, z) {
        this.x = x | 0;
        this.y = y | 0;
        this.z = z | 0;
        return this;
    }

    
    writeToNBT(tag) {
        tag.put(new TagString("id", this.getId()));
        tag.put(new TagInt("x", this.x));
        tag.put(new TagInt("y", this.y));
        tag.put(new TagInt("z", this.z));
    }

    
    readFromNBT(tag) {
        this.x = tag.getValue("x", this.x) | 0;
        this.y = tag.getValue("y", this.y) | 0;
        this.z = tag.getValue("z", this.z) | 0;
    }

    
    saveToNBT() {
        let tag = new TagCompound("");
        this.writeToNBT(tag);
        return tag;
    }

    
    update() {
    }

    
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

    
    onClose() {
        this._closed = true;
    }

    isClosed() {
        return this._closed;
    }

    
    onInteract(player, itemstack) {
        return false;
    }

    
    static createFromNBT(world, x, y, z, tag) {
        let entity = new this(world, x, y, z);
        entity.readFromNBT(tag);
        return entity;
    }
}
