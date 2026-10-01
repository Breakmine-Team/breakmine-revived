import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";

export default class BlockWire extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Redstone Dust";
        this.hardness = 0;
        this.sound = Block.sounds.stone;
        this.noFaceCull = true;
        this.canCastAmbientOcclusion = false;
        this.boundingBox = new BoundingBox(0.0, 0.0, 0.0, 1.0, 1/16, 1.0);
    }

    getTextureForFace(face, data, x, y, z, world) {
        return 'wire';
    }

    getColor(world, x, y, z, face) {
        let temp = 15;
        const grayscaleIntHex = [
            0x000000,
            0x111111,
            0x222222,
            0x333333,
            0x444444,
            0x555555,
            0x666666,
            0x777777,
            0x888888,
            0x999999,
            0xaaaaaa,
            0xbbbbbb,
            0xcccccc,
            0xdddddd,
            0xeeeeee,
            0xf5f5f5,
            0xffffff
        ];
        return grayscaleIntHex[temp];
    }

    static canWireConnectTo(blockId) {
        return Block.getById(blockId)?.redstoneConnects ?? false; 
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.boundingBox;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getAmbientOcclusion() {
        return false;
    }

    onBlockPlaced(world, x, y, z, face) {
        world.onBlockChanged(x - 1, y, z);
        world.onBlockChanged(x + 1, y, z);
        world.onBlockChanged(x, y, z - 1);
        world.onBlockChanged(x, y, z + 1);
    }

    onBlockTick(world, x, y, z) {
        world.onBlockChanged(x, y, z);
    }
}
