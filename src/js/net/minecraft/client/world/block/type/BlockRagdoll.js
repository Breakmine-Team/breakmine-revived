import Block from "../Block.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import RagdollEntity from "../../../entity/RagdollEntity.js";

export default class BlockRagdoll extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 0.4;
        this.sound = Block.sounds.cloth;
        this.inventoryTab = EnumCreativeInventoryTab.MISC;
    }

    // Item render type: the GUI and the hand show the flat ragdoll sprite
    // instead of turning the icon into a cube.
    getRenderType() {
        return BlockRenderType.ITEM;
    }

    getTextureForFace(face) {
        return this.textureName;
    }

    // Placing the ragdoll drops it: the cell is cleared so the body can fall
    // and no block is left behind.
    spawnRagdoll(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== "function" || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        // The placement ghost renders through a preview world; holding the item
        // must not drop a ragdoll until the block is really placed.
        if (world.isPreview === true) {
            return;
        }

        world.setBlockAt(x, y, z, 0);

        if (!world.minecraft || typeof world.addEntity !== "function") {
            return;
        }

        // The body is placed lying on the block that was clicked, centred on it.
        const ragdoll = new RagdollEntity(world.minecraft, world, x + 0.5, y, z + 0.5);
        world.addEntity(ragdoll);
    }

    onBlockPlaced(world, x, y, z, face) {
        this.spawnRagdoll(world, x, y, z);
    }

    // The server never calls onBlockPlaced, so clearing the cell here keeps the
    // block out of the server world as well. Clients see air and simulate the
    // ragdoll locally.
    onBlockAdded(world, x, y, z) {
        this.spawnRagdoll(world, x, y, z);
    }
}
