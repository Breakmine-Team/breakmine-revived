import ItemTool from "./ItemTool.js";

export default class ItemAxe extends ItemTool {
    constructor(id, textureName, name, material) {
        super(id, textureName, name, material, 'axe');
    }
}
