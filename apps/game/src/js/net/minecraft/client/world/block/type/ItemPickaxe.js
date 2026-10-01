import ItemTool from "./ItemTool.js";

export default class ItemPickaxe extends ItemTool {
    constructor(id, textureName, name, material) {
        super(id, textureName, name, material, 'pickaxe');
    }
}
