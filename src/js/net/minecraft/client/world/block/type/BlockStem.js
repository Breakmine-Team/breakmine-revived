import BlockCrop from "./BlockCrop.js";
import { BlockRegistry } from "../BlockRegistry.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const ATTACHED_BIT = 8;
const STAGE_MASK = 7;

const HORIZONTAL_DIRECTIONS = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 }
];

/**
 * A pumpkin or melon stem. It grows on farmland like a crop, but at full
 * growth it places its fruit block on an adjacent dirt/farmland block instead
 * of being harvested by hand.
 */
export default class BlockStem extends BlockCrop {

    constructor(id, textureSlotId, options = {}) {
        super(id, textureSlotId, {
            description: options.description ?? "Stem",
            maxStage: STAGE_MASK,
            plantItemKey: options.seedItemKey ?? null,
            produceItemKey: null,
            seedDropMin: 1,
            seedDropMax: 1
        });

        this.stemTexture = options.stemTexture ?? "pumpkin_stem";
        this.attachedTexture = options.attachedTexture ?? "attached_pumpkin_stem";
        this.fruitKey = options.fruitKey ?? null;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
    }

    getStage(world, x, y, z) {
        return (world?.getBlockDataAt(x, y, z) ?? 0) & STAGE_MASK;
    }

    isAttached(world, x, y, z) {
        return (world?.getBlockDataAt(x, y, z) ?? 0) & ATTACHED_BIT;
    }

    getTextureForFace(face, data = 0, x, y, z, world) {
        const state = world && x !== undefined
            ? world.getBlockDataAt(x, y, z)
            : data;
        return state & ATTACHED_BIT ? this.attachedTexture : this.stemTexture;
    }

    getDrop(world, x, y, z) {
        const seed = this.resolveItem(this.plantItemKey);
        return seed ? [[seed.getId(), 1]] : [];
    }

    onMouseButton(world, x, y, z, button) {
        // Stems are broken with the normal dig action, never harvested by
        // right-clicking them.
        return false;
    }

    onBlockAdded(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, 20 + Math.floor(Math.random() * 40));
    }

    onBlockTick(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        // Stems need farmland underneath; losing it breaks the stem.
        if (world.getBlockAt(x, y - 1, z) !== BlockRegistry.FARMLAND.id) {
            this.breakWithDrop(world, x, y, z);
            return;
        }

        if (this.isAttached(world, x, y, z)) {
            // If the fruit was removed without notifying us, release the stem.
            if (!this.hasFruit(world, x, y, z)) {
                const stage = Math.max(0, this.getStage(world, x, y, z) - 1);
                world.setBlockDataAt(x, y, z, stage);
            }
            world.scheduleBlockTick(x, y, z, 100 + Math.floor(Math.random() * 40));
            return;
        }

        const stage = this.getStage(world, x, y, z);
        if (stage >= STAGE_MASK) {
            if (!this.trySpawnFruit(world, x, y, z)) {
                world.scheduleBlockTick(x, y, z, 40 + Math.floor(Math.random() * 40));
            }
            return;
        }

        // Match the other crops: only grow in light. The server world has no
        // light engine, so treat its missing light hook as full daylight.
        const lightLevel = typeof world.getTotalLightAt === "function"
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

    hasFruit(world, x, y, z) {
        const fruit = this.resolveItem(this.fruitKey);
        if (!fruit) {
            return false;
        }

        return HORIZONTAL_DIRECTIONS.some(direction =>
            world.getBlockAt(x + direction.x, y, z + direction.z) === fruit.getId());
    }

    canSpawnFruit(world) {
        const minecraft = world.minecraft;
        // In multiplayer the server owns block changes. Let it place the fruit
        // and broadcast it instead of predicting a position of our own.
        return !minecraft || typeof minecraft.isSingleplayer !== "function"
            || minecraft.isSingleplayer();
    }

    trySpawnFruit(world, x, y, z) {
        const fruit = this.resolveItem(this.fruitKey);
        if (!fruit || !this.canSpawnFruit(world)) {
            return false;
        }

        const directions = HORIZONTAL_DIRECTIONS.slice();
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }

        for (const direction of directions) {
            const fruitX = x + direction.x;
            const fruitZ = z + direction.z;

            if (world.getBlockAt(fruitX, y, fruitZ) !== 0) {
                continue;
            }
            if (!world.isSolidBlockAt(fruitX, y - 1, fruitZ)) {
                continue;
            }

            world.setBlockAt(fruitX, y, fruitZ, fruit.getId(), 0);
            world.setBlockDataAt(x, y, z, ATTACHED_BIT | STAGE_MASK);
            // Keep checking while attached so a fruit removed by anything
            // other than the normal break path still releases the stem.
            world.scheduleBlockTick(x, y, z, 100 + Math.floor(Math.random() * 40));
            return true;
        }

        return false;
    }
}
