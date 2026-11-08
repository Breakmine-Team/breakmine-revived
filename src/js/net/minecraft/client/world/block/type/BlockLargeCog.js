import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";

export default class BlockLargeCog extends BlockShaftPart {

    static BARS = [
        {u: [-7, 23], v: [6.5, 9.5], w: [6.5, 9.5], angle: 0},
        {u: [-7, 23], v: [6.5, 9.5], w: [6.5, 9.5], angle: 22.5},
        {u: [-7, 23], v: [6.5, 9.5], w: [6.5, 9.5], angle: -22.5},
        {u: [-7, 23], v: [6.5, 9.5], w: [6.5, 9.5], angle: 45},

        {u: [6.5, 9.5], v: [-7, 23], w: [6.5, 9.5], angle: 0},
        {u: [6.5, 9.5], v: [-7, 23], w: [6.5, 9.5], angle: 22.5},
        {u: [6.5, 9.5], v: [-7, 23], w: [6.5, 9.5], angle: -22.5},
        {u: [6.5, 9.5], v: [-7, 23], w: [6.5, 9.5], angle: 45}
    ];

    static PLATES = [
        {u: [-2, 18], v: [-2, 18], w: [7, 9], angle: 0},
        {u: [-2, 18], v: [-2, 18], w: [7, 9], angle: 45},

        {u: [1, 15], v: [1, 15], w: [5.5, 10.5], angle: 0}
    ];

    static BAR_TEXTURE = 'spruce_planks';
    static PLATE_TEXTURE = 'spruce_planks';
    static HUB_TEXTURE = 'spruce_planks';
    static SHAFT_TEXTURE = 'stone';

    static TEXTURE = BlockLargeCog.BAR_TEXTURE;

    static PIVOT = Object.freeze({x: 0.5, y: 0.5, z: 0.5});

    static part(box, texture, axis) {
        const data = {
            texture: texture,
            bbox: ShaftRenderer.toBox(box, axis)
        };

        if (box.angle) {
            data.rotation = ShaftRenderer.getRotationForAxis(axis, box.angle);
            data.pivot = BlockLargeCog.PIVOT;
        }

        return ['texture', texture, data];
    }

    static getParts(axis) {
        const parts = ShaftRenderer.getParts(ShaftRenderer.PART.SHAFT, axis, {
            texture: BlockLargeCog.SHAFT_TEXTURE
        });

        for (const bar of BlockLargeCog.BARS) {
            parts.push(BlockLargeCog.part(bar, BlockLargeCog.BAR_TEXTURE, axis));
        }

        for (const plate of BlockLargeCog.PLATES) {
            const texture = plate.u[0] === 1 ? BlockLargeCog.HUB_TEXTURE : BlockLargeCog.PLATE_TEXTURE;
            parts.push(BlockLargeCog.part(plate, texture, axis));
        }

        return parts;
    }

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Large Cog";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        this.noFaceCull = true;

        this.isLargeCog = true;
    }

    
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return BlockLargeCog.TEXTURE;
    }

    
    getTextureForFace(face) {
        return BlockLargeCog.TEXTURE;
    }

    getMultipart(world, x, y, z) {
        const data = world && typeof world.getBlockDataAt === 'function'
            ? world.getBlockDataAt(x, y, z)
            : 0;

        return BlockLargeCog.getParts(this.getAxis(data));
    }

    isCog() {
        return true;
    }

    
    getCogRadius() {
        return 15 / 16;
    }

    getPreferredToolType() {
        return 'axe';
    }
}