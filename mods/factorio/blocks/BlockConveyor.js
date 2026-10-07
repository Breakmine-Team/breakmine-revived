export default class BlockConveyor extends Block {
    static inventoryTab = "Factorio";

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Conveyor";
        this.hardness = 4.0;
    }

    getTextureForFace(face) {
        switch(face) {
            case EnumBlockFace.WEST:
            case EnumBlockFace.EAST:
                return 'factorio:conveyor_side';
            default:
                return 'factorio:conveyor_top';
        }
    }

    doSlideFaceAnimate(face, x, y, z, world, tick) {
        return tick % 16;
    }
}