import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import BearingDrive from "../BearingDrive.js";

export default class BlockMechanicalBearing extends BlockShaftPart {

    static P = (pixels) => pixels / 16;

    static BODY_TEXTURE = 'spruce_planks';
    static HEAD_TEXTURE = 'spruce_planks';
    static FRAME_TEXTURE = 'stone';
    static SHAFT_TEXTURE = 'stone';

    static TEXTURE = BlockMechanicalBearing.BODY_TEXTURE;

    static BODY = [0, 1, 0, 16, 14, 16];
    static HEAD = [0, 14, 0, 16, 16, 16];

    static FRAME = [
        [15, 0, 0, 16, 1, 16],
        [0, 0, 0, 1, 1, 16],
        [1, 0, 0, 15, 1, 1],
        [1, 0, 15, 15, 1, 16]
    ];

    static toBox(box) {
        const [x0, y0, z0, x1, y1, z1] = box;

        return {
            minX: BlockMechanicalBearing.P(x0), minY: BlockMechanicalBearing.P(y0), minZ: BlockMechanicalBearing.P(z0),
            maxX: BlockMechanicalBearing.P(x1), maxY: BlockMechanicalBearing.P(y1), maxZ: BlockMechanicalBearing.P(z1)
        };
    }

    static part(box, texture) {
        return ['texture', texture, {
            texture: texture,
            bbox: BlockMechanicalBearing.toBox(box)
        }];
    }

    static getCasingParts() {
        const parts = [BlockMechanicalBearing.part(BlockMechanicalBearing.BODY, BlockMechanicalBearing.BODY_TEXTURE)];

        for (const strip of BlockMechanicalBearing.FRAME) {
            parts.push(BlockMechanicalBearing.part(strip, BlockMechanicalBearing.FRAME_TEXTURE));
        }

        return parts;
    }

    static getHeadParts() {
        return [
            BlockMechanicalBearing.part(BlockMechanicalBearing.HEAD, BlockMechanicalBearing.HEAD_TEXTURE),
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, ShaftRenderer.AXIS.Y, {
                texture: BlockMechanicalBearing.SHAFT_TEXTURE,
                negative: true
            })
        ];
    }

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Mechanical Bearing";
        this.shiftDescription = "Consumes 500 SU";
        this.hardness = 2.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        this.isMechanicalBearing = true;
    }

    
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return BlockMechanicalBearing.TEXTURE;
    }

    getTextureForFace(face) {
        return BlockMechanicalBearing.TEXTURE;
    }

    
    getPlacementMetadata() {
        return ShaftRenderer.AXIS.Y;
    }

    getAxis(data) {
        return ShaftRenderer.AXIS.Y;
    }

    getMultipart(world, x, y, z) {
        BearingDrive.register(world, x, y, z);

        return [...BlockMechanicalBearing.getCasingParts(), ...BlockMechanicalBearing.getHeadParts()];
    }

    
    getStaticMultipart(world, x, y, z) {
        BearingDrive.register(world, x, y, z);

        return BlockMechanicalBearing.getCasingParts();
    }

    getRotatingMultipart(world, x, y, z) {
        return BlockMechanicalBearing.getHeadParts();
    }

    
    getRenderRotation(world, x, y, z, data, tick) {
        const field = world ? world.offGridField : null;
        const group = world ? BearingDrive.getGroup(world, x, y, z) : null;

        if (field && group !== null && group.field === field) {
            return {x: 0, y: field.rotation.y, z: 0};
        }

        return super.getRenderRotation(world, x, y, z, data, tick);
    }

    onBlockAdded(world, x, y, z) {
        super.onBlockAdded(world, x, y, z);
        BearingDrive.register(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        BearingDrive.unregister(world, x, y, z);
        BearingDrive.release(world, x, y, z);
        super.onBlockRemoved(world, x, y, z);
    }

    getPreferredToolType() {
        return 'axe';
    }
}