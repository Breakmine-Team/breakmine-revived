import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockTNT extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.explosionRadius = 4;
        this.explosionStrength = 4.0;
        this.description = "TNT";
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
        this.hardness = 0.1;
        this.sound = Block.sounds.grass;
    }

    getTextureForFace(face) {
        switch (face) {
            case EnumBlockFace.TOP:
                return 'tnt_top';
            case EnumBlockFace.BOTTOM:
                return 'tnt_bottom';
            default:
                return 'tnt_side';
        }
    }

    isExplosionEnabled(world) {
        if (world && world.allowTNT === false) {
            return false;
        }
        return world?.minecraft?.serverRules?.allowTNT !== false;
    }

    explode(world, x, y, z, visited = new Set()) {
        if (!this.isExplosionEnabled(world)) {
            return;
        }

        const key = `${x},${y},${z}`;
        if (visited.has(key)) {
            return;
        }
        visited.add(key);

        world.setBlockAt(x, y, z, 0);

        const radius = this.explosionRadius;
        const explosionStrength = this.explosionStrength;

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist > radius) {
                        continue;
                    }

                    const power =
                        (1 - dist / radius) *
                        explosionStrength *
                        (0.8 + Math.random() * 0.4);

                    const targetX = x + dx;
                    const targetY = y + dy;
                    const targetZ = z + dz;

                    const typeId = world.getBlockAt(targetX, targetY, targetZ);
                    const block = Block.getById(typeId);

                    if (!block) {
                        continue;
                    }

                    if (typeId === this.id) {
                        this.explode(world, targetX, targetY, targetZ, visited);
                        continue;
                    }

                    const hardness = block.getHardness();
                    if (power >= hardness) {
                        world.setBlockAt(targetX, targetY, targetZ, 0);
                    }
                }
            }
        }
    }

    
    ignite(world, x, y, z) {
        if (!this.isExplosionEnabled(world)) {
            return false;
        }

        this.explode(world, x, y, z);
        return true;
    }

    
    getHeldItemId(world) {
        const stack = world?.minecraft?.player?.inventory?.getItemInSelectedSlot?.();
        return stack && typeof stack.getType === "function" ? (stack.getType() || 0) : 0;
    }

    isIgnitionItem(heldItemId) {
        return heldItemId > 0 && heldItemId === BlockRegistry.FLINT_AND_STEEL?.id;
    }

    
    isBluestonePowered(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== "function") {
            return false;
        }

        const neighbors = [
            [1, 0, 0], [-1, 0, 0],
            [0, 0, 1], [0, 0, -1],
            [0, -1, 0], [0, 1, 0],
        ];

        for (const [dx, dy, dz] of neighbors) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            const block = Block.getById(world.getBlockAt(nx, ny, nz));
            if (!block) {
                continue;
            }

            if (typeof block.getPower === "function") {
                if (block.getPower(world, nx, ny, nz) > 0) {
                    return true;
                }
            } else if (block.isPowerSource) {
                return true;
            }
        }

        return false;
    }

    onBlockAdded(world, x, y, z) {
        if (this.isBluestonePowered(world, x, y, z)) {
            this.ignite(world, x, y, z);
        }
    }

    onNeighborBlockChange(world, x, y, z) {
        if (world && typeof world.scheduleBlockTick === "function") {
            world.scheduleBlockTick(x, y, z, 1);
        }
    }

    onBlockTick(world, x, y, z) {
        if (!world || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }
        if (this.isBluestonePowered(world, x, y, z)) {
            this.ignite(world, x, y, z);
        }
    }

    onMouseButton(world, x, y, z, button, heldItemId) {
        if (button !== 2) {
            return false;
        }

        const item = heldItemId === undefined || heldItemId === null
            ? this.getHeldItemId(world)
            : heldItemId;

        if (!this.isIgnitionItem(item)) {
            return false;
        }

        this.ignite(world, x, y, z);
        return true;
    }

}