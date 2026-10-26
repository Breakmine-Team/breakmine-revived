import BlockLiquid from "./BlockLiquid.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockWater extends BlockLiquid {

    constructor(id, textureSlotId) {
        super(id, textureSlotId, 'water');
        this.description = "Water";
        this.hardness = -1.0;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
    }

    getTextureForFace(face) {
        return 'water_still';
    }

    // The water texture is greyscale, so the blue comes entirely from this
    // multiplier (vanilla's default water colour).
    getColor(world, x, y, z, face) {
        return 0x3F76E4;
    }

    getOppositeLiquidId() {
        return BlockRegistry.LAVA.getId();
    }

    getSolidificationId() {
        return BlockRegistry.COBBLE_STONE.getId();
    }

    getObsidianSolidificationId() {
        return BlockRegistry.OBSIDIAN.getId();
    }

    getCryingObsidianSolidificationId() {
        return BlockRegistry.CRYING_OBSIDIAN.getId();
    }

    checkContact(world, x, y, z) {
        const oppositeId = this.getOppositeLiquidId();
        const cobbleId = this.getSolidificationId();
        if (oppositeId < 0 || cobbleId < 0) {
            return false;
        }

        const maybeSolidify = (px, py, pz) => {
            if (world.getBlockAt(px, py, pz) !== oppositeId) {
                return false;
            }

            const adjacentLiquid = Block.getById(oppositeId);
            if (!adjacentLiquid) {
                return false;
            }

            const adjacentLevel = (adjacentLiquid.getBlockDataAt ? adjacentLiquid.getBlockDataAt(px, py, pz) & 7 : 0);
            const isSourceLava = adjacentLiquid.isLava() && adjacentLevel === 0;

            let solidId = cobbleId;
            if (isSourceLava) {
                solidId = this.getObsidianSolidificationId();
            }

            world.setBlockAt(px, py, pz, solidId);
            return true;
        };

        if (maybeSolidify(x, y - 1, z)) {
            return true;
        }

        const directions = [
            { x: 1, z: 0 },
            { x: -1, z: 0 },
            { x: 0, z: 1 },
            { x: 0, z: -1 }
        ];
        for (const dir of directions) {
            if (maybeSolidify(x + dir.x, y, z + dir.z)) {
                return true;
            }
        }

        return false;
    }
}
