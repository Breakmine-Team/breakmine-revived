import BlockEntity from "../BlockEntity.js";

/**
 * BlockEntityRegistry — maps string ids to BlockEntity subclasses so that
 * save files can be decoded without knowing the concrete class up front.
 *
 * Usage:
 *   import BlockEntityRegistry from ".../BlockEntityRegistry.js";
 *   import BlockEntityNameable from ".../BlockEntityNameable.js";
 *   BlockEntityRegistry.register(BlockEntityNameable);
 *
 *   // later, when loading:
 *   let entity = BlockEntityRegistry.createFromNBT(world, tag);
 */
export default class BlockEntityRegistry {

    /** id (string) -> BlockEntity subclass */
    static registry = new Map();

    /**
     * Register a BlockEntity subclass. The class must have a unique static
     * `id` property. Safe to call multiple times for the same class.
     */
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

    /**
     * Construct + hydrate a BlockEntity from a TagCompound.
     * Returns null when the id is unknown (with a console warning).
     */
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

        // Position from NBT (fallback to provided coords)
        let x = tag.getValue("x", 0) | 0;
        let y = tag.getValue("y", 0) | 0;
        let z = tag.getValue("z", 0) | 0;

        return cls.createFromNBT(world, x, y, z, tag);
    }

    /**
     * Construct a fresh (empty) BlockEntity of the given type at a position.
     */
    static createNew(id, world, x, y, z) {
        let cls = BlockEntityRegistry.get(id);
        if (!cls) return null;
        return new cls(world, x, y, z);
    }
}

/**
 * Helper decorator-style registration. Usage:
 *
 *   @BlockEntityRegistry.Register
 *   class BlockEntityNameable extends BlockEntity {
 *       static id = "nameable";
 *       ...
 *   }
 *
 * This works because class decorators run after the class is fully defined.
 */
BlockEntityRegistry.Register = function (blockEntityClass) {
    BlockEntityRegistry.register(blockEntityClass);
    return blockEntityClass;
};
