import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

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

    explode(world, x, y, z, visited = new Set()) {
        const key = `${x},${y},${z}`;
        if (visited.has(key)) {
            return;
        }
        visited.add(key);

        // Remove the TNT block itself so it doesn't remain in place
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

                    // If this is another TNT block then trigger it instead of destroying it
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

    onMouseButton(world, x, y, z, button) {
        if (button !== 2) {
            return false;
        }

        this.explode(world, x, y, z);
        return true;
    }

}