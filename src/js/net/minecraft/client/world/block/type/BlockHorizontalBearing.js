import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockMechanicalBearing from "./BlockMechanicalBearing.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import BearingDrive from "../BearingDrive.js";


const P = (pixels) => pixels / 16;


const BODY = [0, 1, 0, 16, 14, 16];
const HEAD = [0, 14, 0, 16, 16, 16];
const FRAME = [
    [15, 0, 0, 16, 1, 16],
    [0, 0, 0, 1, 1, 16],
    [1, 0, 0, 15, 1, 1],
    [1, 0, 15, 15, 1, 16]
];


const FACINGS = [
    {normal: {x: 0, y: 0, z: -1}, axis: "z", axisIndex: 2, sign: 1, rotate: (x, y, z) => [x, z, 16 - y]},
    {normal: {x: 1, y: 0, z: 0}, axis: "x", axisIndex: 1, sign: 1, rotate: (x, y, z) => [y, 16 - x, z]},
    {normal: {x: 0, y: 0, z: 1}, axis: "z", axisIndex: 2, sign: -1, rotate: (x, y, z) => [x, 16 - z, y]},
    {normal: {x: -1, y: 0, z: 0}, axis: "x", axisIndex: 1, sign: -1, rotate: (x, y, z) => [16 - y, x, z]}
];

const YAW_TO_FACING = [0, 1, 2, 3];

function orientBox(box, facing) {
    const [x0, y0, z0, x1, y1, z1] = box;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const cx of [x0, x1]) {
        for (const cy of [y0, y1]) {
            for (const cz of [z0, z1]) {
                const [x, y, z] = facing.rotate(cx, cy, cz);
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (z < minZ) minZ = z;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                if (z > maxZ) maxZ = z;
            }
        }
    }

    return {
        minX: P(minX), minY: P(minY), minZ: P(minZ),
        maxX: P(maxX), maxY: P(maxY), maxZ: P(maxZ)
    };
}

function part(box, texture, facing) {
    return ['texture', texture, {
        texture: texture,
        bbox: orientBox(box, facing)
    }];
}

function getCasingParts(facing) {
    const parts = [part(BODY, BlockMechanicalBearing.BODY_TEXTURE, facing)];

    for (const strip of FRAME) {
        parts.push(part(strip, BlockMechanicalBearing.FRAME_TEXTURE, facing));
    }

    return parts;
}

function getHeadParts(facing) {
    const axis = facing.axis === "x" ? ShaftRenderer.AXIS.X : ShaftRenderer.AXIS.Z;

    return [
        part(HEAD, BlockMechanicalBearing.HEAD_TEXTURE, facing),
        ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, axis, {
            texture: BlockMechanicalBearing.SHAFT_TEXTURE,
            negative: facing.sign < 0
        })
    ];
}

export default class BlockHorizontalBearing extends BlockMechanicalBearing {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Horizontal Bearing";
        this.shiftDescription = "Consumes 500 SU";
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        this.isHorizontalBearing = true;
    }

    getFacing(data) {
        return FACINGS[(data | 0) & 3];
    }

    
    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return YAW_TO_FACING[dirIndex];
    }

    getAxis(data) {
        return this.getFacing(data).axis === "x"
            ? ShaftRenderer.AXIS.X
            : ShaftRenderer.AXIS.Z;
    }

    
    getBearingAttachment(data) {
        const facing = this.getFacing(data);
        return {
            normal: {x: facing.normal.x, y: facing.normal.y, z: facing.normal.z},
            axis: facing.axis,
            axisIndex: facing.axisIndex,
            sign: facing.sign
        };
    }

    getMultipart(world, x, y, z) {
        BearingDrive.register(world, x, y, z);

        const facing = this.getFacing(world && typeof world.getBlockDataAt === "function"
            ? world.getBlockDataAt(x, y, z)
            : 0);

        return [...getCasingParts(facing), ...getHeadParts(facing)];
    }

    
    getStaticMultipart(world, x, y, z) {
        BearingDrive.register(world, x, y, z);

        const facing = this.getFacing(world && typeof world.getBlockDataAt === "function"
            ? world.getBlockDataAt(x, y, z)
            : 0);

        return getCasingParts(facing);
    }

    getRotatingMultipart(world, x, y, z) {
        const facing = this.getFacing(world && typeof world.getBlockDataAt === "function"
            ? world.getBlockDataAt(x, y, z)
            : 0);

        return getHeadParts(facing);
    }

    
    getRenderRotation(world, x, y, z, data, tick) {
        const group = world ? BearingDrive.getGroup(world, x, y, z) : null;

        if (group !== null && group.field) {
            const axis = this.getAxis(data);
            const name = axis === ShaftRenderer.AXIS.X ? "x" : "z";
            return ShaftRenderer.getRotationForAxis(axis, group.field.rotation[name]);
        }

        return super.getRenderRotation(world, x, y, z, data, tick);
    }
}
