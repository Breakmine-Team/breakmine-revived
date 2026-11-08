export default class EnumCreativeInventoryTab {

    static BUILDING_BLOCKS = new EnumCreativeInventoryTab("Building Blocks", 1, 2);
    static DECORATION = new EnumCreativeInventoryTab("Decoration", 2, 49);
    static MACHINES = new EnumCreativeInventoryTab("Utilities", 3, 34);
    static FOODSTUFFS = new EnumCreativeInventoryTab("Foodstuffs", 4, 84);
    static TOOLS = new EnumCreativeInventoryTab("Tools", 5, 91);
    static COMBAT = new EnumCreativeInventoryTab("Combat", 6, 102);
    static MATERIALS = new EnumCreativeInventoryTab("Materials / Misc", 7, 87);
    static MODS = new EnumCreativeInventoryTab("Not Listed", 99998);
    static NOTLISTED = new EnumCreativeInventoryTab("Not Listed", 99999);

    static FACTORIO = new EnumCreativeInventoryTab("Factorio", 9, 342);

    static SURVIVAL_INVENTORY = new EnumCreativeInventoryTab("Survival Inventory", 10, 32);

    static SEARCH = new EnumCreativeInventoryTab("Search", 999, 20);
    static BOOKMARKS = new EnumCreativeInventoryTab("Bookmarks", 998, 20);

    static DEBUG = new EnumCreativeInventoryTab("Debug", 8, 1, true);

    constructor(name, id, icon = 1, devOnly = false) {
        this.name = name;
        this.id = id;
        this.icon = icon;
        this.devOnly = devOnly;
    }

    
    static isHidden(tab) {
        return tab === EnumCreativeInventoryTab.DEBUG
            || tab === EnumCreativeInventoryTab.NOTLISTED;
    }

    
    static isDevMode() {
        if (typeof window === 'undefined' || !window.location) return false;
        return new URLSearchParams(window.location.search).get('dev') === '1';
    }

    
    static getBuiltinTabs() {
        const tabs = [];

        Object.keys(EnumCreativeInventoryTab).forEach(propertyName => {
            const tab = EnumCreativeInventoryTab[propertyName];
            if (!tab || typeof tab !== 'object' || tab.id >= 99998) return;
            if (tab.devOnly && !EnumCreativeInventoryTab.isDevMode()) return;
            tabs.push(tab);
        });

        return tabs;
    }

}