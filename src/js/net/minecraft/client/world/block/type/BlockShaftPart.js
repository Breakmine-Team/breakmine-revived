import Block from "../Block.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";



const YAW_TO_AXIS = [
    ShaftRenderer.AXIS.Z,
    ShaftRenderer.AXIS.X,
    ShaftRenderer.AXIS.Z,
    ShaftRenderer.AXIS.X
];

export default class BlockShaftPart extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.multipart = true;
        this.hardness = 1.5;
        this.sound = Block.sounds.stone;

        this.isShaftPart = true;
    }

    getAmbientOcclusion() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    
    getShaftParts() {
        return [{part: ShaftRenderer.PART.SHAFT, texture: this.getShaftTexture()}];
    }

    
    getShaftTexture() {
        return 'stone';
    }

    
    getTextureForFace(face) {
        return this.getShaftTexture();
    }

    
    isCog() {
        return false;
    }

    
    getCogRadius() {
        return 9 / 16;
    }

    
    getDrive(world, x, y, z, tick) {
        return ShaftDrive.resolve(world, x, y, z, tick);
    }

    
    getShaftRpm(world, x, y, z, tick) {
        return this.getDrive(world, x, y, z, tick).rpm;
    }

    
    getShaftDirection(world, x, y, z, tick) {
        return this.getDrive(world, x, y, z, tick).direction;
    }

    getAxis(data) {
        return ShaftRenderer.getAxis(data);
    }

    
    isUprightPart(data) {
        return this.getAxis(data) === ShaftRenderer.AXIS.Y;
    }

    
    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const faceId = BlockShaftPart.getFaceId(face);
        if (faceId === 0 || faceId === 1) {
            return ShaftRenderer.AXIS.Y;
        }

        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return YAW_TO_AXIS[dirIndex];
    }

    
    static getFaceId(face) {
        if (typeof face === "number") {
            return face | 0;
        }
        if (!face) {
            return -1;
        }
        if (face.y < 0) return 0;
        if (face.y > 0) return 1;
        if (face.z < 0) return 2;
        if (face.z > 0) return 3;
        if (face.x < 0) return 4;
        if (face.x > 0) return 5;

        return -1;
    }

    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return ShaftRenderer.buildParts(this.getShaftParts(), this.getAxis(data));
    }

    getRenderRotation(world, x, y, z, data, tick) {
        return ShaftRenderer.getRotation(
            this.getAxis(data),
            this.getShaftRpm(world, x, y, z, tick),
            this.getShaftDirection(world, x, y, z, tick),
            tick
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

        if (world && typeof world.scheduleBlockTick === 'function') {
            world.scheduleBlockTick(x, y, z, 20);
        }
    }

    
    onBlockTick(world, x, y, z) {
        if (!world) {
            return;
        }

        if (typeof world.scheduleBlockTick === 'function') {
            world.scheduleBlockTick(x, y, z, 20);
        }

        if (typeof world.setBlockAt !== 'function') {
            return;
        }

        const candidate = ShaftDrive.findSnapCandidate(world, x, y, z);
        if (candidate === null || candidate !== ShaftDrive.keyOf(x, y, z)) {
            return;
        }

        world.setBlockAt(x, y, z, 0);
        ShaftDrive.refreshAround(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }
}
