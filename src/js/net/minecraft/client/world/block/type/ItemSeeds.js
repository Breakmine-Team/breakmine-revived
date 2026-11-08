import ItemEdible from "../ItemEdible.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BlockPosition from "../../../../util/BlockPosition.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class ItemSeeds extends ItemEdible {

    constructor(id, textureName, description, cropKey = "WHEAT_CROP", healAmount = 0) {
        super(id, 0);
        this.tex = textureName;
        this.description = description;
        this.cropKey = cropKey;
        this.healAmount = healAmount;
        this.inventoryTab = healAmount > 0
            ? EnumCreativeInventoryTab.FOODSTUFFS
            : EnumCreativeInventoryTab.MATERIALS;
    }

    getTextureForFace(face) {
        return this.tex;
    }

    getDescription() {
        return this.healAmount > 0 ? super.getDescription() : this.description;
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        if (this.tryPlant(world, x, y, z, itemstack, hitFace)) {
            return true;
        }

        if (this.healAmount > 0) {
            super.onUse(world, x, y, z, itemstack);
        }
        return false;
    }

    tryPlant(world, x, y, z, itemstack, hitFace) {
        if (!world || x === undefined || y === undefined || z === undefined || !itemstack || !hitFace) {
            return false;
        }

        if (hitFace !== EnumBlockFace.TOP || y < 1) {
            return false;
        }
        if (world.getBlockAt(x, y - 1, z) !== BlockRegistry.FARMLAND.id ||
            world.getBlockAt(x, y, z) !== 0) {
            return false;
        }

        const crop = BlockRegistry[this.cropKey];
        if (!crop) {
            return false;
        }

        world.setBlockAt(x, y, z, crop.getId(), 0);

        const minecraft = world.minecraft;
        if (minecraft?.player) {
            if (!minecraft.player.creative) {
                itemstack.shrink(1);
            }
            minecraft.player.swingArm();
        }

        this.notifyServerPlanting(world, x, y - 1, z);
        return true;
    }

    notifyServerPlanting(world, x, y, z) {
        if (world.isFieldLocalWorld) return;
        const minecraft = world.minecraft;
        if (!minecraft || !minecraft.playerController ||
            typeof minecraft.playerController.sendBlockPlacementPacket !== 'function') {
            return;
        }

        minecraft.playerController.sendBlockPlacementPacket(
            new BlockPosition(x, y, z),
            255,
            { id: this.id }
        );
    }

    onUseOnBlockServer(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== BlockRegistry.FARMLAND.id ||
            world.getBlockAt(x, y + 1, z) !== 0) {
            return;
        }

        const crop = BlockRegistry[this.cropKey];
        if (!crop) {
            return;
        }

        world.setBlockAt(x, y + 1, z, crop.getId(), 0);
        crop.onBlockAdded(world, x, y + 1, z);
    }
}
