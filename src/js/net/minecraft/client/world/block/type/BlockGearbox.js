import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";

export default class BlockGearbox extends BlockShaftPart {

    static BOXES = [
        [1, 2, 1, 15, 14, 15],    
        [0, 14, 0, 16, 16, 16],   
        [0, 0, 0, 16, 2, 16]      
    ];

    static TEXTURE = 'spruce_planks';

    static SHAFT_ENTRANCE_TEXTURE = 'shaft_enterance';

    static SIDE_FACES = {
        north: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        south: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        east: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        west: BlockGearbox.SHAFT_ENTRANCE_TEXTURE
    };

    static UPRIGHT_X_FACES = {
        east: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        west: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        top: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        bottom: BlockGearbox.SHAFT_ENTRANCE_TEXTURE
    };

    static UPRIGHT_Z_FACES = {
        north: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        south: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        top: BlockGearbox.SHAFT_ENTRANCE_TEXTURE,
        bottom: BlockGearbox.SHAFT_ENTRANCE_TEXTURE
    };

    static BODY_INDEX = 0;

    static PIXEL = 1 / 16;
    static CENTRE = 0.5;

    static YAW_TO_FACE = [2, 5, 3, 4];

    static AXLE_TEXTURE = 'stone';

    static getEntranceFaces(vertical, facing) {
        if (vertical !== true) {
            return BlockGearbox.SIDE_FACES;
        }

        return (facing === 4 || facing === 5) ? BlockGearbox.UPRIGHT_Z_FACES : BlockGearbox.UPRIGHT_X_FACES;
    }

    static getYawQuarters(facing) {
        return (facing === 4 || facing === 5) ? 1 : 0;
    }

    static turn(point, quarterX, quarterY) {
        let [x, y, z] = point;

        if (quarterX !== 0) {
            const radians = quarterX * Math.PI / 2;
            const cos = Math.round(Math.cos(radians));
            const sin = Math.round(Math.sin(radians));
            const dy = y - BlockGearbox.CENTRE;
            const dz = z - BlockGearbox.CENTRE;
            y = BlockGearbox.CENTRE + dy * cos - dz * sin;
            z = BlockGearbox.CENTRE + dy * sin + dz * cos;
        }

        if (quarterY !== 0) {
            const radians = quarterY * Math.PI / 2;
            const cos = Math.round(Math.cos(radians));
            const sin = Math.round(Math.sin(radians));
            const dx = x - BlockGearbox.CENTRE;
            const dz = z - BlockGearbox.CENTRE;
            x = BlockGearbox.CENTRE + dx * cos + dz * sin;
            z = BlockGearbox.CENTRE - dx * sin + dz * cos;
        }

        return [x, y, z];
    }

    static orientBox(box, quarterX, quarterY) {
        const [x0, y0, z0, x1, y1, z1] = box;

        if (quarterX === 0 && quarterY === 0) {
            return {
                minX: x0 * BlockGearbox.PIXEL, minY: y0 * BlockGearbox.PIXEL, minZ: z0 * BlockGearbox.PIXEL,
                maxX: x1 * BlockGearbox.PIXEL, maxY: y1 * BlockGearbox.PIXEL, maxZ: z1 * BlockGearbox.PIXEL
            };
        }

        const points = [
            [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
            [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]
        ].map(([x, y, z]) => BlockGearbox.turn([x * BlockGearbox.PIXEL, y * BlockGearbox.PIXEL, z * BlockGearbox.PIXEL], quarterX, quarterY));

        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        const zs = points.map((point) => point[2]);

        return {
            minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs),
            maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs)
        };
    }

    static getCasingParts(vertical, facing) {
        const quarterX = vertical ? 1 : 0;
        const quarterY = vertical ? BlockGearbox.getYawQuarters(facing) : 0;

        return BlockGearbox.BOXES.map((box, index) => ['texture', BlockGearbox.TEXTURE, {
            texture: BlockGearbox.TEXTURE,
            bbox: BlockGearbox.orientBox(box, quarterX, quarterY),
            faces: index === BlockGearbox.BODY_INDEX ? BlockGearbox.getEntranceFaces(vertical, facing) : null
        }]);
    }

    constructor(id, textureSlotId, vertical = false) {
        super(id, textureSlotId);
        this.vertical = vertical === true;
        this.description = this.vertical ? "Vertical Gearbox" : "Gearbox";
        this.shiftDescription = "Tranfers rotation on 2 axes";
        this.hardness = 2.0;

        this.noFaceCull = true;

        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        this.isGearbox = true;
    }

    
    getFacing(data) {
        const facing = (data | 0) & 7;
        return facing >= 2 && facing <= 5 ? facing : 3;
    }

    
    getFacingAxis(data) {
        return ShaftRenderer.getAxisFromFace(this.getFacing(data));
    }

    
    getAxis(data) {
        const facingAxis = this.getFacingAxis(data);
        if (this.vertical !== true) {
            return facingAxis;
        }

        return facingAxis === ShaftRenderer.AXIS.Z ? ShaftRenderer.AXIS.X : ShaftRenderer.AXIS.Z;
    }

    
    getCrossAxis(data) {
        return this.getAxis(data) === ShaftRenderer.AXIS.Z
            ? ShaftRenderer.AXIS.X
            : ShaftRenderer.AXIS.Z;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return BlockGearbox.YAW_TO_FACE[dirIndex];
    }

    
    getTextureForFace(face) {
        return BlockGearbox.TEXTURE;
    }

    
    getShaftParts() {
        return [];
    }

    
    getAxleParts(axis) {
        return [
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, axis, {texture: BlockGearbox.AXLE_TEXTURE, negative: true}),
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, axis, {texture: BlockGearbox.AXLE_TEXTURE})
        ];
    }

    
    getVerticalAxleParts() {
        return [
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, ShaftRenderer.AXIS.Y, {texture: BlockGearbox.AXLE_TEXTURE, negative: true}),
            ...ShaftRenderer.getParts(ShaftRenderer.PART.HALF_SHAFT, ShaftRenderer.AXIS.Y, {texture: BlockGearbox.AXLE_TEXTURE})
        ];
    }

    
    getMovingParts(data) {
        if (this.vertical === true) {
            return [...this.getAxleParts(this.getAxis(data)), ...this.getVerticalAxleParts()];
        }

        return [
            ...this.getAxleParts(this.getAxis(data)),
            ...this.getAxleParts(this.getCrossAxis(data))
        ];
    }

    getCasingParts(data) {
        return BlockGearbox.getCasingParts(this.vertical, this.getFacing(data));
    }

    
    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;

        return [...this.getCasingParts(data), ...this.getMovingParts(data)];
    }

    
    getStaticMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return this.getCasingParts(data);
    }

    
    getRotatingMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return this.getMovingParts(data);
    }

    
    getRotatingGroups(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const axis = this.getAxis(data);

        if (this.vertical === true) {
            return [
                {parts: this.getAxleParts(axis), axis: axis, sign: 1},
                {parts: this.getVerticalAxleParts(), axis: ShaftRenderer.AXIS.Y, sign: -1}
            ];
        }

        const crossAxis = this.getCrossAxis(data);
        return [
            {parts: this.getAxleParts(axis), axis: axis, sign: 1},
            {parts: this.getAxleParts(crossAxis), axis: crossAxis, sign: -1}
        ];
    }

    
    getGroupRotation(index, world, x, y, z, tick) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const groups = this.getRotatingGroups(world, x, y, z);
        const group = groups[Math.min(Math.max(index | 0, 0), groups.length - 1)];
        const drive = this.getDrive(world, x, y, z, tick);

        return ShaftRenderer.getRotationForAxis(
            group.axis,
            ShaftRenderer.angleFor(drive.rpm, drive.direction * group.sign, tick)
        );
    }

    getPreferredToolType() {
        return 'axe';
    }
}