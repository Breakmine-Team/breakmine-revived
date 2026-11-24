// crafting/BlockUnbreakableBlockCrafting.js
//
// The class name decides what this recipe produces:
//   BlockUnbreakableBlockCrafting -> UnbreakableBlock -> unbreakable_block
//   => unbreakable_block:unbreakable_block
//
// Four Unbreakable Ingots (shapeless) craft one Unbreakable Block.
export default class BlockUnbreakableBlockCrafting {
    static shapeless = true;
    static amount_output = 1;
    static recipe = [
        'unbreakable_block:unbreakable_ingot',
        'unbreakable_block:unbreakable_ingot',
        'unbreakable_block:unbreakable_ingot',
        'unbreakable_block:unbreakable_ingot'
    ];
}
