export default class BlockGlassTube extends Block {
    static inventoryTab = "Factorio";

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Glass Tube\n§7Slower speed";
        this.hardness = 1.0;
    }

    getTextureForFace(face) {
        return 'factorio:glass_tube_slow';
    }
}