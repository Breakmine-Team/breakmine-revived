import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockFarmland extends Block {

    static MAX_MOISTURE = 7;
    static HYDRATION_RADIUS = 4;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Farmland";
        this.hardness = 0.6;

        // Sound
        this.sound = Block.sounds.grass;
        this.boundingBox = new BoundingBox(0, 0, 0, 1, (1 / 16) * 15, 1);

        this.path = true;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getPreferredToolType() {
        return 'shovel';
    }

    getAmbientOcclusion() {
        return false;
    }

    getParticleTextureFace() {
        return EnumBlockFace.NORTH;
    }

    getTextureForFace(face, data = 0) {
        if (face === EnumBlockFace.TOP) {
            return (data & BlockFarmland.MAX_MOISTURE) > 0 ? 'farmland_moist' : 'farmland';
        }
        return 'dirt';
    }

    getDrop(world, x, y, z) {
        return [BlockRegistry.DIRT.getId(), 1];
    }

    onBlockAdded(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, 1);
    }

    onBlockTick(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        const moisture = world.getBlockDataAt(x, y, z) & BlockFarmland.MAX_MOISTURE;
        let nextMoisture = moisture;

        if (this.hasWaterNearby(world, x, y, z)) {
            nextMoisture = BlockFarmland.MAX_MOISTURE;
        } else if (moisture > 0) {
            nextMoisture = moisture - 1;
        }

        if (nextMoisture !== moisture) {
            world.setBlockDataAt(x, y, z, nextMoisture);
        }

        world.scheduleBlockTick(x, y, z, 100);
    }

    hasWaterNearby(world, x, y, z) {
        const radius = BlockFarmland.HYDRATION_RADIUS;
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (world.getBlockAt(x + dx, y, z + dz) === BlockRegistry.WATER.id) {
                    return true;
                }
                if (world.getBlockAt(x + dx, y + 1, z + dz) === BlockRegistry.WATER.id) {
                    return true;
                }
            }
        }
        return false;
    }
}
