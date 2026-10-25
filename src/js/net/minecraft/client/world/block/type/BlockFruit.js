import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";

const HORIZONTAL_DIRECTIONS = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 }
];

export default class BlockFruit extends Block {

    constructor(id, textureSlotId, options = {}) {
        super(id, textureSlotId);

        this.description = options.description ?? "Fruit";
        this.sideTexture = options.sideTexture ?? "missing";
        this.topTexture = options.topTexture ?? this.sideTexture;
        this.stemKey = options.stemKey ?? null;

        this.dropItemKey = options.dropItemKey ?? null;
        this.dropMin = options.dropMin ?? 1;
        this.dropMax = options.dropMax ?? this.dropMin;

        this.hardness = options.hardness ?? 1.0;
        this.sound = options.sound ?? Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getPreferredToolType() {
        return "axe";
    }

    getTextureForFace(face) {
        return face === EnumBlockFace.TOP || face === EnumBlockFace.BOTTOM
            ? this.topTexture
            : this.sideTexture;
    }

    getDrop(world, x, y, z) {
        if (!this.dropItemKey) {
            return [this.id, 1];
        }

        const item = BlockRegistry[this.dropItemKey];
        if (!item) {
            return [this.id, 1];
        }

        const count = this.dropMin + Math.floor(Math.random() * (this.dropMax - this.dropMin + 1));
        return [item.getId(), count];
    }

    /**
     * When the fruit is removed, release the stem that grew it so it can
     * flower again. The stem is always directly beside the fruit.
     */
    onBlockRemoved(world, x, y, z) {
        const stem = this.stemKey ? BlockRegistry[this.stemKey] : null;
        if (!stem) {
            return;
        }

        for (const direction of HORIZONTAL_DIRECTIONS) {
            const stemX = x + direction.x;
            const stemZ = z + direction.z;
            if (world.getBlockAt(stemX, y, stemZ) !== stem.getId()) {
                continue;
            }

            const data = world.getBlockDataAt(stemX, y, stemZ);
            if ((data & 8) === 0) {
                continue;
            }

            const stage = data & 7;
            world.setBlockDataAt(stemX, y, stemZ, Math.max(0, stage - 1));
            world.scheduleBlockTick(stemX, y, stemZ, 20 + Math.floor(Math.random() * 40));
        }
    }
}
