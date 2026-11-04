import ByteTag from "./builtin/ByteTag.js";
import ShortTag from "./builtin/ShortTag.js";
import IntTag from "./builtin/IntTag.js";
import LongTag from "./builtin/LongTag.js";
import FloatTag from "./builtin/FloatTag.js";
import DoubleTag from "./builtin/DoubleTag.js";
import StringTag from "./builtin/StringTag.js";
import ByteArrayTag from "./builtin/ByteArrayTag.js";
import ListTag from "./builtin/ListTag.js";
import IntArrayTag from "./builtin/IntArrayTag.js";

export default class TagRegistry {

    static idToTag = new Map();
    static tagToId = new Map();

    static {
        // NOTE: CompoundTag (id 10) is intentionally NOT registered here.
        // It imports NBTIO, which imports this registry, so referencing it
        // from this static block would create an uninitialized-binding (TDZ)
        // cycle when CompoundTag is the first module loaded. CompoundTag
        // self-registers at the bottom of its own module instead.
        TagRegistry.register(1, ByteTag);
        TagRegistry.register(2, ShortTag);
        TagRegistry.register(3, IntTag);
        TagRegistry.register(4, LongTag);
        TagRegistry.register(5, FloatTag);
        TagRegistry.register(6, DoubleTag);
        TagRegistry.register(7, ByteArrayTag);
        TagRegistry.register(8, StringTag);
        TagRegistry.register(9, ListTag);
        TagRegistry.register(11, IntArrayTag);
    }

    static register(id, tag) {
        TagRegistry.idToTag.set(id, tag);
        TagRegistry.tagToId.set(tag, id);
    }

    static getIdFor(clazz) {
        // Accept both a class (e.g. ListTag.write) and an instance
        // (e.g. NBTIO.writeTag) so the binary writer gets the right id.
        if (clazz && typeof clazz !== "function") {
            clazz = clazz.constructor;
        }
        let id = TagRegistry.tagToId.get(clazz);
        if (typeof id === "undefined") {
            return -1;
        }
        return id;
    }

    static getClassFor(id) {
        let clazz = TagRegistry.idToTag.get(id);
        if (typeof clazz === "undefined") {
            return null;
        }
        return clazz;
    }

    static createInstance(id, tagName) {
        let clazz = TagRegistry.idToTag.get(id);
        if (clazz === null || typeof clazz === "undefined") {
            return null;
        }
        return new clazz(tagName);
    }

}