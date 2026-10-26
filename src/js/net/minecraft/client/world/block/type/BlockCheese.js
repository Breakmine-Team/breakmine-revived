import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockCheese extends Block {
    static SLICE_COUNT = 4;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Cheese";
        this.textureName = "cheese";
        this.hardness = 0.5;
        this.sound = Block.sounds.cloth;
        this.inventoryTab = EnumCreativeInventoryTab.FOODSTUFFS;
    }

    getBoundingBox(world, x, y, z) {
        const eatenSlices = world ? world.getBlockDataAt(x, y, z) || 0 : 0;
        const inset = eatenSlices / (BlockCheese.SLICE_COUNT * 2);
        return new BoundingBox(inset, inset, inset, 1 - inset, 1 - inset, 1 - inset);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    getOpacity(world, x, y, z, block) {
        return !world || (world.getBlockDataAt(x, y, z) || 0) === 0 ? 1 : 0;
    }

    onMouseButton(world, x, y, z, button) {
        if (button !== 2) {
            return false;
        }

        const eatenSlices = world.getBlockDataAt(x, y, z) || 0;
        if (eatenSlices >= BlockCheese.SLICE_COUNT - 1) {
            world.setBlockAt(x, y, z, 0);
        } else {
            world.setBlockDataAt(x, y, z, eatenSlices + 1);
            if (world.minecraft?.worldRenderer) {
                world.onBlockChanged(x, y, z);
            }
        }

        const player = world.minecraft?.player;
        if (player) {
            player.health = Math.min(20, player.health + 8);
            player.sendHealthUpdate();
            player.swingArm();
            world.minecraft.soundManager.playSound(
                "random.eat",
                player.x,
                player.y,
                player.z,
                10,
                1.0
            );
        }
        return true;
    }

    getTextureForFace(face) {
        return this.textureName;
    }

    isTranslucent() {
        return true;
    }

    shouldRenderFace(world, x, y, z, face) {
        return true;
    }

}