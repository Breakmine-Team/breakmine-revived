import ItemTool from "./ItemTool.js";

export default class ItemShovel extends ItemTool {
    constructor(id, textureName, name, material) {
        super(id, textureName, name, material, 'shovel');
    }
}
