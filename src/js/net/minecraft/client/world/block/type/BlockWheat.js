import Block from "../Block.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";
import ItemEntity from "../../../entity/ItemEntity.js";

export default class BlockWheat extends Block {

    static MAX_STAGE = 7;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Wheat Crops";
        this.hardness = 0.0;

        // Sound
        this.sound = Block.sounds.grass;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
    }

    getRenderType() {
        return BlockRenderType.DECORATION;
    }

    getTextureForFace(face, data = 0) {
        const stage = Math.min(BlockWheat.MAX_STAGE, data & BlockWheat.MAX_STAGE);
        return `wheat_stage${stage}`;
    }

    getDrop(world, x, y, z) {
        const stage = world ? world.getBlockDataAt(x, y, z) & BlockWheat.MAX_STAGE : 0;
        if (stage >= BlockWheat.MAX_STAGE) {
            return [
                [BlockRegistry.ITEM_WHEAT.getId(), 1],
                [BlockRegistry.ITEM_WHEAT_SEEDS.getId(), 1 + Math.floor(Math.random() * 3)]
            ];
        }
        return [[BlockRegistry.ITEM_WHEAT_SEEDS.getId(), 1]];
    }

    canPlaceAt(world, x, y, z) {
        return y > 0 && world.getBlockAt(x, y - 1, z) === BlockRegistry.FARMLAND.id;
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

    getParticleTextureFace() {
        return EnumBlockFace.TOP;
    }

    onBlockAdded(world, x, y, z) {
        const stage = world.getBlockDataAt(x, y, z) & BlockWheat.MAX_STAGE;
        if (stage < BlockWheat.MAX_STAGE) {
            world.scheduleBlockTick(x, y, z, 20 + Math.floor(Math.random() * 40));
        }
    }

    onBlockTick(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        const stage = world.getBlockDataAt(x, y, z) & BlockWheat.MAX_STAGE;
        if (stage >= BlockWheat.MAX_STAGE) {
            return;
        }

        // Crops need farmland underneath; losing it breaks the crop.
        const soilId = world.getBlockAt(x, y - 1, z);
        if (soilId !== BlockRegistry.FARMLAND.id) {
            this.breakWithDrop(world, x, y, z);
            return;
        }

        // Too dark to grow. The server world has no light engine, and its
        // crops sit above ground, so only enforce this where light exists.
        const lightLevel = typeof world.getTotalLightAt === 'function'
            ? world.getTotalLightAt(x, y, z)
            : 15;

        if (lightLevel >= 9) {
            const moist = world.getBlockDataAt(x, y - 1, z) > 0;
            const growthChance = moist ? 0.35 : 0.12;

            if (Math.random() < growthChance) {
                world.setBlockDataAt(x, y, z, stage + 1);
            }
        }

        world.scheduleBlockTick(x, y, z, 20 + Math.floor(Math.random() * 40));
    }

    onMouseButton(world, x, y, z, button) {
        if (button !== 2) {
            return false;
        }

        const stage = world.getBlockDataAt(x, y, z) & BlockWheat.MAX_STAGE;
        if (stage < BlockWheat.MAX_STAGE) {
            return false;
        }

        const drops = Block.normalizeDrops(this.getDrop(world, x, y, z));
        world.setBlockAt(x, y, z, 0, 0);

        const minecraft = world.minecraft;
        if (typeof world.dropItem === 'function') {
            // Authoritative server: spawn the items and broadcast them.
            for (const [itemId, count] of drops) {
                for (let i = 0; i < count; i++) {
                    world.dropItem(itemId, x, y, z);
                }
            }
        } else if (minecraft?.worldRenderer
            && (typeof minecraft.isSingleplayer !== 'function' || minecraft.isSingleplayer())
            && minecraft.player && !minecraft.player.creative) {
            for (const [itemId, count] of drops) {
                minecraft.player.inventory.addItem(itemId, count);
            }
        }

        if (minecraft?.player) {
            minecraft.player.swingArm();
        }
        if (minecraft?.soundManager) {
            minecraft.soundManager.playSound('random.pop', x + 0.5, y + 0.5, z + 0.5, 1.0, 1.0);
        }

        return true;
    }

    breakWithDrop(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        const drops = Block.normalizeDrops(this.getDrop(world, x, y, z));
        world.setBlockAt(x, y, z, 0, 0);

        if (typeof world.dropItem === 'function') {
            for (const [itemId, count] of drops) {
                for (let i = 0; i < count; i++) {
                    world.dropItem(itemId, x, y, z);
                }
            }
        } else if (world.minecraft?.worldRenderer
            && typeof world.addEntity === 'function'
            && (typeof world.minecraft.isSingleplayer !== 'function' || world.minecraft.isSingleplayer())) {
            // Predict the drop in a purely local world; in multiplayer the
            // server runs the same support check and broadcasts its items.
            for (const [itemId, count] of drops) {
                for (let i = 0; i < count; i++) {
                    world.addEntity(new ItemEntity(world.minecraft, world, itemId, x, y, z));
                }
            }
        }
    }
}
