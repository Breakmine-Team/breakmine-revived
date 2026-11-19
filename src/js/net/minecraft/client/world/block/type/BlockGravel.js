import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";
import { startFall as startFallingBlock } from "../../../../util/BlockMove.js";

export default class BlockGravel extends Block {

    static FALL_DURATION_MS = 120;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Gravel";
        this.hardness = 0.6;

        this.sound = Block.sounds.gravel;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }
    
    getPreferredToolType() {
        return 'shovel';
    }

    getTextureForFace(face) {
        return 'gravel';
    }
    
    getDrop(world, x, y, z) {
        const rnd = Math.random();
        if (rnd > 0.5) {
            return [BlockRegistry.FLINT.getId(), 1];
        }
    }

    // Drops to the first solid block below. Local worlds animate it, servers
    // apply it and every client animates the announced move.
    startFall(world, x, y, z) {
        return startFallingBlock(world, x, y, z, 80);
    }

    onBlockPlaced(world, x, y, z, face) {
        world.scheduleBlockTick(x, y, z, 5);
    }

    onBlockTick(world, x, y, z) {
        if (this.startFall(world, x, y, z)) return;

        if (y <= 0) return;
        if (world.isSolidBlockAt(x, y - 1, z)) return;

        // Worlds without block movement (off-grid fields) fall one cell at a time.
        let typeId = world.getBlockAt(x, y, z);
        let blockData = world.getBlockDataAt(x, y, z);

        world.setBlockAt(x, y, z, 0, 0);
        world.setBlockAt(x, y - 1, z, typeId, blockData);

        if (y - 1 > 0 && !world.isSolidBlockAt(x, y - 2, z)) {
            world.scheduleBlockTick(x, y - 1, z, 5);
        }
    }
}
