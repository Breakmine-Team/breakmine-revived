export default class EnumCreativeInventoryTab {

    static BUILDING_BLOCKS = new EnumCreativeInventoryTab("Building Blocks", 1, 2);
    static DECORATION = new EnumCreativeInventoryTab("Decoration", 2, 49);
    static MACHINES = new EnumCreativeInventoryTab("Utilities", 3, 34);
    static FOODSTUFFS = new EnumCreativeInventoryTab("Foodstuffs", 4, 84);
    static TOOLS = new EnumCreativeInventoryTab("Tools", 5, 91);
    static COMBAT = new EnumCreativeInventoryTab("Combat", 6, 102);
    static MATERIALS = new EnumCreativeInventoryTab("Materials / Misc", 7, 87);
    static MODS = new EnumCreativeInventoryTab("Modded Items", 8, 17);
    static NOTLISTED = new EnumCreativeInventoryTab("Not Listed", 999);

    constructor(name, id, icon = 1) {
        this.name = name;
        this.id = id;
        this.icon = icon;
    }

}