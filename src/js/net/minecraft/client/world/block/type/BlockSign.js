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
            return new BoundingBox(0, 0, 0.4375, 1, 1, 0.5625);
        } else {
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
        if (world.minecraft && world.minecraft.worldRenderer && world.minecraft.worldRenderer.signTextRenderer) {
            const key = `${x},${y},${z}`;
            world.minecraft.worldRenderer.signTextRenderer.removeSign(key);
        }
        
        if (world.blockInventories) {
            const key = `${x},${y},${z}`;
            world.blockInventories.delete(key);
        }
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return (dirIndex === 0 || dirIndex === 2) ? 1 : 0;
    }

    onBlockPlaced(world, x, y, z, face) {
        let data = 0;
        if (world && world.minecraft && world.minecraft.player) {
            let player = world.minecraft.player;
            let dirIndex = Math.floor((player.rotationYaw * 4 / 360) + 0.5) & 3;
            if (dirIndex === 0 || dirIndex === 2) {
                data = 1; 
            }
        }
        world.setBlockDataAt(x, y, z, data);

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
