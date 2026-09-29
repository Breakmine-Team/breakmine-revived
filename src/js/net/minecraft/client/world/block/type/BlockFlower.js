import Block from "../Block.js";
import ItemEntity from "../../../entity/ItemEntity.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";

export default class BlockFlower extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 0.0;
        this.sound = Block.sounds.grass;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getRenderType() {
        return BlockRenderType.DECORATION;
    }

    getTextureForFace(face) {
        return this.textureName;
    }

    getDrop(world, x, y, z) {
        return [this.id, 1];
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    getOpacity() {
        return 0.0;
    }

    onBlockPlaced(world, x, y, z, face) {
        world.scheduleBlockTick(x, y, z, 1);
    }

    onBlockTick(world, x, y, z) {
        if (!world.isSolidBlockAt(x, y - 1, z)) {
            this.breakWithDrop(world, x, y, z);
        }
    }

    breakWithDrop(world, x, y, z) {
        world.setBlockAt(x, y, z, 0);
        // Only the client can render a dropped item. The server's world stub
        // has a `minecraft` object too (so block code can reach
        // soundManager/player without null checks), but it has no world
        // renderer, so constructing an ItemEntity there threw
        // "Cannot read properties of undefined (reading 'entityRenderManager')"
        // on every flower that lost its support -- and because the throw
        // escaped through the tick, the block was already gone while the
        // server kept re-reporting the failure. Break the block, and let the
        // client drop the item.
        if (world.minecraft && world.minecraft.worldRenderer && typeof world.addEntity === 'function') {
            world.addEntity(new ItemEntity(world.minecraft, world, this.id, x, y, z));
        }
    }
}
