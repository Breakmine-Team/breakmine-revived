import ItemTool from "./ItemTool.js";

export default class ItemHoe extends ItemTool {
    constructor(id, textureName, name, material) {
        super(id, textureName, name, material, 'hoe');
    }
}
