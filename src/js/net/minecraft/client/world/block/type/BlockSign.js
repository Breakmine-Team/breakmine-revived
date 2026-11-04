import Block from "../Block.js";
import GuiSign from "../../../gui/screens/GuiSign.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import { BlockRegistry } from "../BlockRegistry.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockSign extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Sign";
        this.noFaceCull = true;
        this.sound = Block.sounds.wood;
                
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    isSolid() {
        return false;
    }

    getAmbientOcclusion() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getRenderType() {
        return BlockRenderType.SIGN;
    }

    getTextureForFace(face) {
        return 'oak_sign';
    }

    getBoundingBox(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const xAxis = data & 1;
        
        if (xAxis) {
            // X-axis rotation: board extends along X axis (0 to 1), thin on Z axis
            return new BoundingBox(0, 0, 0.4375, 1, 1, 0.5625);
        } else {
            // Z-axis rotation: board extends along Z axis (0 to 1), thin on X axis
            return new BoundingBox(0.4375, 0, 0, 0.5625, 1, 1);
        }
    }

    onMouseButton(world, x, y, z, button) {
        if (button === 2) {
            world.minecraft.displayScreen(new GuiSign(world.minecraft.player, { x, y, z }));
            return true;
        }
        return false;
    }

    onBlockRemoved(world, x, y, z) {
        // Remove sign text when block is broken
        if (world.minecraft && world.minecraft.worldRenderer && world.minecraft.worldRenderer.signTextRenderer) {
            const key = `${x},${y},${z}`;
            world.minecraft.worldRenderer.signTextRenderer.removeSign(key);
        }
        
        // Remove sign data from world
        if (world.blockInventories) {
            const key = `${x},${y},${z}`;
            world.blockInventories.delete(key);
        }
    }

    onBlockPlaced(world, x, y, z, face) {
        // Set rotation based on player facing direction
        let data = 0;
        if (world && world.minecraft && world.minecraft.player) {
            let player = world.minecraft.player;
            let dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
            // dirIndex: 0=south, 1=west, 2=north, 3=east
            // X-axis rotation for north/south facing (dirIndex 0 or 2)
            // Z-axis rotation for east/west facing (dirIndex 1 or 3)
            if (dirIndex === 0 || dirIndex === 2) {
                data = 1; // X-axis rotation
            }
        }
        world.setBlockDataAt(x, y, z, data);

        // Initialize empty sign data when placed
        if (world.blockInventories) {
            const key = `${x},${y},${z}`;
            if (!world.blockInventories.has(key)) {
                world.blockInventories.set(key, {
                    text: ""
                });
            }
        }
    }
}
