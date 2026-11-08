import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";


const P = (pixels) => pixels / 16;


const PIVOT = Object.freeze({x: 0.5, y: 0.5, z: 0.5});

const LOG_TEXTURE = 'spruce_log';

const SHAFT_TEXTURE = 'stone';
const PLANK_TEXTURE = 'spruce_planks';


const TEXTURE = PLANK_TEXTURE;


const SPOKES = [
    [13, -1, -8, 14, 17, 0],
    [2, -1, 16, 3, 17, 24],
    [-8, -1, 2, 0, 17, 3],
    [16, -1, 13, 24, 17, 14]
];


const INNER_PLANKS = [
    {box: [-2, -0.6, 4, 0, 16.6, 12], yaw: 45},
    {box: [-2, -0.6, 4, 0, 16.6, 12], yaw: 0},
    {box: [-2, -0.6, 4, 0, 16.6, 12], yaw: -45},
    {box: [16, -0.6, 4, 18, 16.6, 12], yaw: 45},
    {box: [16, -0.6, 4, 18, 16.6, 12], yaw: 0},
    {box: [16, -0.6, 4, 18, 16.6, 12], yaw: -45},
    {box: [4, -0.6, -2, 12, 16.6, 0], yaw: 0},
    {box: [4, -0.6, 15.9, 12, 16.6, 18], yaw: 0}
];

const CONNECTORS = [
    {box: [6.5, 2, -1, 9.5, 14, 17], yaw: 22.5},
    {box: [6.5, 2, -1, 9.5, 14, 17], yaw: -22.5},
    {box: [-1, 2, 6.5, 17, 14, 9.5], yaw: 22.5},
    {box: [-1, 2, 6.5, 17, 14, 9.5], yaw: -22.5}
];

const YAW_STEPS = Object.freeze([-22.5, 0, 22.5, 45]);

function toBox(box) {
    const [x0, y0, z0, x1, y1, z1] = box;

    return {
        minX: P(x0),
        maxX: P(x1),
        minY: 1 - P(z1),
        maxY: 1 - P(z0),
        minZ: P(y0),
        maxZ: P(y1)
    };
}

function part(box, texture, yaw = 0) {
    const data = {
        texture: texture,
        bbox: toBox(box)
    };

    if (yaw !== 0) {
        data.rotation = {x: 0, y: 0, z: yaw};
        data.pivot = PIVOT;
    }

    return ['texture', texture, data];
}

function getParts() {
    const parts = [
        ...ShaftRenderer.getParts(ShaftRenderer.PART.SHAFT, ShaftRenderer.AXIS.Z, {
            texture: SHAFT_TEXTURE
        })
    ];

    for (const spoke of SPOKES) {
        for (const yaw of YAW_STEPS) {
            parts.push(part(spoke, LOG_TEXTURE, yaw));
        }
    }

    for (const plank of INNER_PLANKS) {
        parts.push(part(plank.box, PLANK_TEXTURE, plank.yaw));
    }

    for (const connector of CONNECTORS) {
        parts.push(part(connector.box, LOG_TEXTURE, connector.yaw));
    }

    return parts;
}

export default class BlockWaterWheel extends BlockShaftPart {

    
    static RPM = 8;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Water Wheel";
        this.shiftDescription = "Outputs 900 SU @ 8 RPM";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        this.noFaceCull = true;

        this.isWaterWheel = true;
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
        return ShaftRenderer.AXIS.Z;
    }

    getAxis(data) {
        return ShaftRenderer.AXIS.Z;
    }

    
    static isWaterBlock(block) {
        if (!block) {
            return false;
        }
        if (block.isWater === true || block.liquidType === 'water') {
            return true;
        }

        const name = `${block.identifier || ''} ${block.name || ''} ${block.description || ''}`;
        return /\bwater\b/i.test(name) && block.isShaftPart !== true;
    }

    
    hasWater(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== 'function') {
            return false;
        }

        for (const step of ShaftDrive.NEIGHBOURS) {
            const typeId = world.getBlockAt(
                x + step.delta[0],
                y + step.delta[1],
                z + step.delta[2]
            );
            if (!typeId) {
                continue;
            }
            if (BlockWaterWheel.isWaterBlock(Block.getById(typeId))) {
                return true;
            }
        }

        return false;
    }

    
    getWaterDrive(world, x, y, z) {
        if (!this.hasWater(world, x, y, z)) {
            return null;
        }

        return {rpm: BlockWaterWheel.RPM, direction: 1};
    }

    getPreferredToolType() {
        return 'axe';
    }
}
