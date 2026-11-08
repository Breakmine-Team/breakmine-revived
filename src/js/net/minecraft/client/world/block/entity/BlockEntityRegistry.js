import BlockEntity from "../BlockEntity.js";

export default class BlockEntityRegistry {

    
    static registry = new Map();

    
    static register(blockEntityClass) {
        if (!blockEntityClass || !blockEntityClass.id) {
            throw new Error("BlockEntityRegistry.register: class missing static id");
        }
        BlockEntityRegistry.registry.set(blockEntityClass.id, blockEntityClass);
    }

    static unregister(id) {
        return BlockEntityRegistry.registry.delete(id);
    }

    static get(id) {
        return BlockEntityRegistry.registry.get(id) || null;
    }

    static has(id) {
        return BlockEntityRegistry.registry.has(id);
    }

    static ids() {
        return Array.from(BlockEntityRegistry.registry.keys());
    }

    
    static createFromNBT(world, tag) {
        if (!tag) return null;

        let idTag = tag.getTag("id");
        let id = idTag ? idTag.getValue() : null;

        if (!id) {
            console.warn("[BlockEntityRegistry] NBT compound has no 'id' field");
            return null;
        }

        let cls = BlockEntityRegistry.get(id);
        if (!cls) {
            console.warn(`[BlockEntityRegistry] Unknown block entity id: ${id}`);
            return null;
        }

        let x = tag.getValue("x", 0) | 0;
        let y = tag.getValue("y", 0) | 0;
        let z = tag.getValue("z", 0) | 0;

        return cls.createFromNBT(world, x, y, z, tag);
    }

    
    static createNew(id, world, x, y, z) {
        let cls = BlockEntityRegistry.get(id);
        if (!cls) return null;
        return new cls(world, x, y, z);
    }
}

BlockEntityRegistry.Register = function (blockEntityClass) {
    BlockEntityRegistry.register(blockEntityClass);
    return blockEntityClass;
};
