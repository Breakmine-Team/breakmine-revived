import Block from "../Block.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BallEntity from "../../../entity/BallEntity.js";

export default class BlockBall extends Block {

    static ITEM_COLOR = 0x4a7dff;

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 0.5;
        this.sound = Block.sounds.cloth;
        this.inventoryTab = EnumCreativeInventoryTab.MISC;

        // The item is drawn from a round icon everywhere it appears as an item,
        // and it is always blue there. The ball itself still picks a random
        // concrete colour from BallEntity when it is released.
        this.color = BlockBall.ITEM_COLOR;
    }

    // Item render type: the GUI and the hand show the flat ball sprite instead
    // of turning the icon into a cube.
    getRenderType() {
        return BlockRenderType.ITEM;
    }

    getTextureForFace(face) {
        return this.textureName;
    }

    getColor(world, x, y, z, face) {
        return this.color;
    }

    // Placing the ball block releases the ball: the cell is cleared so the
    // entity can move and no block is left behind.
    spawnBall(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== "function" || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        // The placement ghost renders through a preview world; holding the ball
        // must not release one until the block is really placed.
        if (world.isPreview === true) {
            return;
        }

        world.setBlockAt(x, y, z, 0);

        if (!world.minecraft || typeof world.addEntity !== "function") {
            return;
        }

        // Drop it somewhere random inside the cell instead of dead centre, so
        // two balls placed in the same spot do not stack up exactly.
        const spread = 0.5 - BallEntity.RADIUS;
        const offsetX = (Math.random() * 2.0 - 1.0) * spread;
        const offsetZ = (Math.random() * 2.0 - 1.0) * spread;

        const ball = new BallEntity(world.minecraft, world, x + 0.5 + offsetX, y + 0.05, z + 0.5 + offsetZ);
        ball.motionY = BallEntity.SPAWN_POP;
        world.addEntity(ball);
    }

    onBlockPlaced(world, x, y, z, face) {
        this.spawnBall(world, x, y, z);
    }

    // The server never calls onBlockPlaced, so clearing the cell here keeps the
    // block out of the server world as well. Clients see air and simulate the
    // ball locally.
    onBlockAdded(world, x, y, z) {
        this.spawnBall(world, x, y, z);
    }
}
