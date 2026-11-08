import Tag from "./Tag.js";
import NBTIO from "../../NBTIO.js";
import TagRegistry from "../TagRegistry.js";
import StringTag from "./StringTag.js";
import IntTag from "./IntTag.js";
import ByteTag from "./ByteTag.js";
import ListTag from "./ListTag.js";

export default class CompoundTag extends Tag {

    constructor(name, value = new Map()) {
        super(name);

        this.value = value;
    }

    write(buffer) {
        for (let [key, tag] of this.value) {
            NBTIO.writeTag(buffer, tag);
        }
        buffer.writeByte(0);
    }

    read(buffer) {
        let tags = [];
        let tag = null;
        while ((tag = NBTIO.readTag(buffer)) !== null) {
            tags.push(tag);
        }
        for (let tag of tags) {
            this.put(tag);
        }
    }

    put(tag) {
        if (tag) {
            this.value.set(tag.getName(), tag);
        }
    }

    
    has(name) {
        return this.value.has(name);
    }

    
    get(name) {
        return this.value.get(name) || null;
    }

    
    getTag(name) {
        return this.get(name);
    }

    
    getValue(name, defaultValue = null) {
        if (name === undefined) {
            return this.value;
        }
        let tag = this.value.get(name);
        if (typeof tag === "undefined" || tag === null) {
            return defaultValue;
        }
        return tag.getValue();
    }

    setValue(value) {
        this.value = value;
    }

    
    toObject() {
        let out = {};
        for (let [name, tag] of this.value) {
            out[name] = tag.toObject ? tag.toObject() : tag.getValue();
        }
        return out;
    }

    
    static fromObject(obj) {
        let tag = new CompoundTag("");
        if (!obj || typeof obj !== "object") {
            return tag;
        }
        for (let name of Object.keys(obj)) {
            tag.put(CompoundTag.toTag(name, obj[name]));
        }
        return tag;
    }

    static toTag(name, value) {
        if (typeof value === "string") {
            return new StringTag(name, value);
        }
        if (typeof value === "boolean") {
            return new ByteTag(name, value ? 1 : 0);
        }
        if (typeof value === "number") {
            return new IntTag(name, value);
        }
        if (Array.isArray(value)) {
            let list = new ListTag(name, null);
            for (let item of value) {
                list.add(CompoundTag.toTag("", item));
            }
            return list;
        }
        if (typeof value === "object" && value !== null) {
            let child = new CompoundTag(name);
            for (let childName of Object.keys(value)) {
                child.put(CompoundTag.toTag(childName, value[childName]));
            }
            return child;
        }
        return null;
    }
}




TagRegistry.register(10, CompoundTag);