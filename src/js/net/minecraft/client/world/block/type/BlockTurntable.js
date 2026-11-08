import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import BoundingBox from "../../../../util/BoundingBox.js";


const P = (pixels) => pixels / 16;

const AXLE_TEXTURE = 'spruce_log';
const CASE_TEXTURE = 'spruce_planks';
const TOP_TEXTURE = 'stone';


const TEXTURE = CASE_TEXTURE;


const AXLE = [6, 0, 6, 10, 7, 10];
const CASE_LOWER = [1, 3.9, 1, 15, 5.9, 15];
const CASE_UPPER = [1, 5.9, 1, 15, 7.9, 15];

function toBox(box) {
    const [x0, y0, z0, x1, y1, z1] = box;

    return {
        minX: P(x0), minY: P(y0), minZ: P(z0),
        maxX: P(x1), maxY: P(y1), maxZ: P(z1)
    };
}

function part(box, texture) {
    return ['texture', texture, {
        texture: texture,
        bbox: toBox(box)
    }];
}

function getParts() {
    return [
        part(AXLE, AXLE_TEXTURE),
        part(CASE_LOWER, CASE_TEXTURE),
        part(CASE_UPPER, TOP_TEXTURE)
    ];
}

export default class BlockTurntable extends BlockShaftPart {

    
    static DEGREES_PER_RPM = 0.3;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Turntable";
        this.shiftDescription = "Consumes 200 SU";
        this.hardness = 1.5;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        this.isTurntable = true;
    }

    
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return TEXTURE;
    }

    getTextureForFace(face) {
        return TEXTURE;
    }

    getMultipart(world, x, y, z) {
        return getParts();
    }

    
    getPlacementMetadata() {
        return ShaftRenderer.AXIS.Y;
    }

    getAxis(data) {
        return ShaftRenderer.AXIS.Y;
    }

    
    getTurntableSpin(world, x, y, z) {
        const tick = (world && world.ticks) || 0;

        const rpm = this.getShaftRpm(world, x, y, z, tick);
        const direction = this.getShaftDirection(world, x, y, z, tick) < 0 ? -1 : 1;

        if (!Number.isFinite(rpm) || rpm === 0) {
            return 0;
        }

        return direction * rpm * BlockTurntable.DEGREES_PER_RPM;
    }

    
    getSpinDirection(world, x, y, z) {
        return this.getShaftDirection(world, x, y, z, (world && world.ticks) || 0) < 0 ? -1 : 1;
    }

    
    getBoundingBox(world, x, y, z) {
        return new BoundingBox(0.0, 0.0, 0.0, 1.0, 0.5, 1.0);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    getPreferredToolType() {
        return 'axe';
    }
}
