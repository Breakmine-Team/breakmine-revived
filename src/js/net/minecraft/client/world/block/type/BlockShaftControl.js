import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";

const PIXEL = 1 / 16;

function toBox(box) {
    const [x0, y0, z0, x1, y1, z1] = box;

    return {
        minX: x0 * PIXEL, minY: y0 * PIXEL, minZ: z0 * PIXEL,
        maxX: x1 * PIXEL, maxY: y1 * PIXEL, maxZ: z1 * PIXEL
    };
}

function part(texture, box, uvRotation = null) {
    const data = {
        texture: texture,
        bbox: toBox(box)
    };

    if (uvRotation !== null) {
        data.uvRotation = uvRotation;
    }

    return ['texture', texture, data];
}

export default class BlockShaftControl extends BlockShaftPart {

    static AXLE_TEXTURE = 'stone';

    static ENTRANCE_TEXTURE = 'shaft_enterance';

    static FRAME_BOXES = [
        [0, 0, 0, 16, 1, 16],
        [0, 15, 0, 16, 16, 16],
        [0, 1, 0, 1, 15, 16],
        [15, 1, 0, 16, 15, 16]
    ];

    static BODY = [1, 1, 1, 15, 15, 15];

    static SHAFT_FACES = {
        [ShaftRenderer.AXIS.X]: ['east', 'west'],
        [ShaftRenderer.AXIS.Y]: ['top', 'bottom'],
        [ShaftRenderer.AXIS.Z]: ['north', 'south']
    };

    static orient(box, axis) {
        const [x0, y0, z0, x1, y1, z1] = box;

        if (axis === ShaftRenderer.AXIS.X) {
            return [z0, y0, x0, z1, y1, x1];
        }

        if (axis === ShaftRenderer.AXIS.Y) {
            return [x0, z0, y0, x1, z1, y1];
        }

        return [x0, y0, z0, x1, y1, z1];
    }

    static getBodyPart(texture, axis) {
        const faces = {};

        for (const name of BlockShaftControl.SHAFT_FACES[axis] ?? BlockShaftControl.SHAFT_FACES[ShaftRenderer.AXIS.Y]) {
            faces[name] = BlockShaftControl.ENTRANCE_TEXTURE;
        }

        return ['texture', texture, {
            texture: texture,
            bbox: toBox(BlockShaftControl.BODY),
            faces: faces,
            uvRotation: BlockShaftControl.getFaceRotations(axis)
        }];
    }

    static getHalfShaftParts(axis, negative) {
        return ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, axis, {
            texture: BlockShaftControl.AXLE_TEXTURE,
            negative: negative === true
        });
    }

    static getAxleParts(axis) {
        return [
            ...BlockShaftControl.getHalfShaftParts(axis, true),
            ...BlockShaftControl.getHalfShaftParts(axis, false)
        ];
    }

    static getSideDelta(axis, negative) {
        const sign = negative ? -1 : 1;

        if (axis === ShaftRenderer.AXIS.X) return [sign, 0, 0];
        if (axis === ShaftRenderer.AXIS.Z) return [0, 0, sign];
        return [0, sign, 0];
    }

    static FACE_ROTATIONS = {
        [ShaftRenderer.AXIS.X]: {north: 1, south: 1, top: 1, bottom: 1},
        [ShaftRenderer.AXIS.Z]: {east: 1, west: 1}
    };

    static getFaceRotations(axis) {
        return BlockShaftControl.FACE_ROTATIONS[axis] ?? null;
    }

    static getCasingParts(texture, axis) {
        const uvRotation = BlockShaftControl.getFaceRotations(axis);
        const parts = BlockShaftControl.FRAME_BOXES.map((box) =>
            part(texture, BlockShaftControl.orient(box, axis), uvRotation));

        parts.push(BlockShaftControl.getBodyPart(texture, axis));

        return parts;
    }

    static getParts(texture, axis) {
        return [...BlockShaftControl.getCasingParts(texture, axis), ...BlockShaftControl.getAxleParts(axis)];
    }

    constructor(id, textureSlotId, description, shiftDescription) {
        super(id, textureSlotId);

        this.description = description;
        this.shiftDescription = shiftDescription;
        this.hardness = 2.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        this.noFaceCull = true;

        this.isBluestoneConsumer = true;
    }

    getPoweredTexture() {
        return 'stone';
    }

    getUnpoweredTexture() {
        return this.getPoweredTexture();
    }

    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return this.getUnpoweredTexture();
    }

    getPoweredState(world, x, y, z) {
        return !!world && typeof x === 'number' && this.isPowered(world, x, y, z);
    }

    getTextureForFace(face, data, x, y, z, world) {
        return this.getPoweredState(world, x, y, z)
            ? this.getPoweredTexture()
            : this.getUnpoweredTexture();
    }

    getAxisAt(world, x, y, z) {
        const data = world && typeof world.getBlockDataAt === 'function'
            ? world.getBlockDataAt(x, y, z)
            : 0;

        return this.getAxis(data);
    }

    getBodyTexture(world, x, y, z) {
        return this.getPoweredState(world, x, y, z)
            ? this.getPoweredTexture()
            : this.getUnpoweredTexture();
    }

    getCasingParts(world, x, y, z) {
        return BlockShaftControl.getCasingParts(this.getBodyTexture(world, x, y, z), this.getAxisAt(world, x, y, z));
    }

    getAxleParts(world, x, y, z) {
        return BlockShaftControl.getAxleParts(this.getAxisAt(world, x, y, z));
    }

    getMultipart(world, x, y, z) {
        return [...this.getCasingParts(world, x, y, z), ...this.getAxleParts(world, x, y, z)];
    }

    getStaticMultipart(world, x, y, z) {
        return this.getCasingParts(world, x, y, z);
    }

    getRotatingMultipart(world, x, y, z) {
        return this.getAxleParts(world, x, y, z);
    }

    getRotatingGroups(world, x, y, z) {
        const axis = this.getAxisAt(world, x, y, z);

        return [
            {parts: BlockShaftControl.getHalfShaftParts(axis, true), axis: axis, sign: -1},
            {parts: BlockShaftControl.getHalfShaftParts(axis, false), axis: axis, sign: 1}
        ];
    }

    getSideDrive(world, x, y, z, tick, negative) {
        if (world && typeof world.getBlockAt === 'function') {
            const axis = this.getAxisAt(world, x, y, z);
            const [dx, dy, dz] = BlockShaftControl.getSideDelta(axis, negative);

            const neighbour = Block.getById(world.getBlockAt(x + dx, y + dy, z + dz));
            if (neighbour && typeof neighbour.getDrive === 'function') {
                return neighbour.getDrive(world, x + dx, y + dy, z + dz, tick);
            }
        }

        return this.getDrive(world, x, y, z, tick);
    }

    getGroupRotation(index, world, x, y, z, tick) {
        const axis = this.getAxisAt(world, x, y, z);
        const drive = this.getSideDrive(world, x, y, z, tick, (index | 0) === 0);

        return ShaftRenderer.getRotationForAxis(
            axis,
            ShaftRenderer.angleFor(drive.rpm, drive.direction, tick)
        );
    }

    isPowered(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== 'function') {
            return false;
        }

        for (const step of ShaftDrive.NEIGHBOURS) {
            const nx = x + step.delta[0];
            const ny = y + step.delta[1];
            const nz = z + step.delta[2];

            const typeId = world.getBlockAt(nx, ny, nz);
            if (typeId === undefined || typeId === null || typeId === -1) {
                continue;
            }

            const block = Block.getById(typeId);
            if (!block) {
                continue;
            }

            if (typeof block.getPower === 'function') {
                if (block.getPower(world, nx, ny, nz) > 0) {
                    return true;
                }
            } else if (block.isPowerSource === true) {
                return true;
            }
        }

        return false;
    }

    onNeighborBlockChange(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }

    onBlockTick() {
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}
