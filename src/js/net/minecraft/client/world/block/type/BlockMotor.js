import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";

export default class BlockMotor extends Block {

    static TEXTURE = 'purple_concrete';
    static TRIM_TEXTURE = 'light_gray_concrete';
    static ROD_TEXTURE = 'stone';

    static MOTOR_BOXES = [
        {box: [1, 0, 2, 15, 1, 10], texture: BlockMotor.TRIM_TEXTURE},   
        {box: [4, 1, 2, 12, 4, 10]},                          
        {box: [3, 3, 0, 13, 13, 2], texture: BlockMotor.TRIM_TEXTURE},   
        {box: [3, 3, 10, 13, 13, 11], texture: BlockMotor.TRIM_TEXTURE}, 
        {box: [3, 3, 13, 13, 13, 14], texture: BlockMotor.TRIM_TEXTURE}, 
        {box: [5, 5, 11, 11, 11, 13]},                        
        {box: [4, 4, 2, 12, 12, 10]}                          
    ];

    static PIXEL = 1 / 16;

    static ORIENTATIONS = {
        0: {x: 1, y: 0},   
        1: {x: -1, y: 0},  
        2: {x: 0, y: 2},   
        3: {x: 0, y: 0},   
        4: {x: 0, y: 3},   
        5: {x: 0, y: 1}    
    };

    static OUTPUT_NORMALS = [
        [0, -1, 0],
        [0, 1, 0],
        [0, 0, -1],
        [0, 0, 1],
        [-1, 0, 0],
        [1, 0, 0]
    ];

    static YAW_TO_FACE = [2, 5, 3, 4];

    static RPM = 16;

    static turn(point, orientation) {
        let [x, y, z] = point;

        if (orientation.x !== 0) {
            const radians = orientation.x * Math.PI / 2;
            const cos = Math.round(Math.cos(radians));
            const sin = Math.round(Math.sin(radians));
            const dy = y - 0.5;
            const dz = z - 0.5;
            y = 0.5 + dy * cos - dz * sin;
            z = 0.5 + dy * sin + dz * cos;
        }

        if (orientation.y !== 0) {
            const radians = orientation.y * Math.PI / 2;
            const cos = Math.round(Math.cos(radians));
            const sin = Math.round(Math.sin(radians));
            const dx = x - 0.5;
            const dz = z - 0.5;
            x = 0.5 + dx * cos + dz * sin;
            z = 0.5 - dx * sin + dz * cos;
        }

        return [x, y, z];
    }

    static orientBox(box, orientation) {
        const [x0, y0, z0, x1, y1, z1] = box;

        if (orientation.x === 0 && orientation.y === 0) {
            return {
                minX: x0 * BlockMotor.PIXEL, minY: y0 * BlockMotor.PIXEL, minZ: z0 * BlockMotor.PIXEL,
                maxX: x1 * BlockMotor.PIXEL, maxY: y1 * BlockMotor.PIXEL, maxZ: z1 * BlockMotor.PIXEL
            };
        }

        const corners = [
            [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
            [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]
        ].map(([x, y, z]) => BlockMotor.turn([x * BlockMotor.PIXEL, y * BlockMotor.PIXEL, z * BlockMotor.PIXEL], orientation));

        const xs = corners.map((corner) => corner[0]);
        const ys = corners.map((corner) => corner[1]);
        const zs = corners.map((corner) => corner[2]);

        return {
            minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs),
            maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs)
        };
    }

    static getParts(facing) {
        const orientation = BlockMotor.ORIENTATIONS[(facing | 0) & 7] || BlockMotor.ORIENTATIONS[3];

        return BlockMotor.MOTOR_BOXES.map((entry) => {
            const texture = entry.texture || BlockMotor.TEXTURE;

            return ['texture', texture, {
                texture: texture,
                bbox: BlockMotor.orientBox(entry.box, orientation)
            }];
        });
    }

    static getRodParts(facing) {
        const face = (facing | 0) & 7;

        return ShaftRenderer.getParts(
            ShaftRenderer.PART.HALF_SHAFT,
            ShaftRenderer.getAxisFromFace(face),
            {
                texture: BlockMotor.ROD_TEXTURE,
                negative: face === 0 || face === 2 || face === 4
            }
        );
    }

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Motor";
        this.shiftDescription = "Outputs 10,000 SU @ 16 RPM";
        this.hardness = 2.0;
        this.sound = Block.sounds.stone;
        this.multipart = true;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        this.isShaftMotor = true;
    }

    getAmbientOcclusion() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    
    getFacing(data) {
        const facing = (data | 0) & 7;
        return facing <= 5 ? facing : 3;
    }

    
    getOutputNormal(data) {
        return BlockMotor.OUTPUT_NORMALS[this.getFacing(data)];
    }

    
    getOutputAxis(data) {
        return ShaftRenderer.getAxisFromFace(this.getFacing(data));
    }

    
    getOutputDirection(data) {
        return 1;
    }

    getOutputRpm(data) {
        return BlockMotor.RPM;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return BlockMotor.YAW_TO_FACE[dirIndex];
    }

    
    getTextureForFace(face) {
        return BlockMotor.TEXTURE;
    }

    
    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return [
            ...BlockMotor.getParts(this.getFacing(data)),
            ...BlockMotor.getRodParts(this.getFacing(data))
        ];
    }

    
    getStaticMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return BlockMotor.getParts(this.getFacing(data));
    }

    
    getRotatingMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return BlockMotor.getRodParts(this.getFacing(data));
    }

    
    getRenderRotation(world, x, y, z, data, tick) {
        if (!world) {
            return 0;
        }

        return ShaftRenderer.getRotationForAxis(
            this.getOutputAxis(data),
            ShaftRenderer.angleFor(BlockMotor.RPM, 1, tick)
        );
    }

    onBlockPlaced(world, x, y, z, face) {
        const player = world && world.minecraft && world.minecraft.player;
        if (!player || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        world.setBlockDataAt(x, y, z, this.getPlacementMetadata(world, x, y, z, face, player.rotationYaw));
    }

    onBlockAdded(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}