export default class EnumCreativeInventoryTab {

    static BUILDING_BLOCKS = new EnumCreativeInventoryTab("Building Blocks", 1, 2);
    static DECORATION = new EnumCreativeInventoryTab("Decoration", 2, 49);
    static BLUESTONE = new EnumCreativeInventoryTab("Bluestone", 3, 181);
    static FACTORIO = new EnumCreativeInventoryTab("Factorio", 4, 343);
    static MACHINES = new EnumCreativeInventoryTab("Machines", 12, 34);
    static MISC = new EnumCreativeInventoryTab("Miscellaneous", 5, 327);

    static FOODSTUFFS = new EnumCreativeInventoryTab("Foodstuffs", 6, 84);
    static TOOLS = new EnumCreativeInventoryTab("Tools", 7, 104);
    static COMBAT = new EnumCreativeInventoryTab("Combat", 8, 112);
    static BREWING = new EnumCreativeInventoryTab("Brewing", 9, 373);
    static MATERIALS = new EnumCreativeInventoryTab("Materials", 10, 87);

    static SEARCH = new EnumCreativeInventoryTab("Search", 999, 499);
    static SURVIVAL_INVENTORY = new EnumCreativeInventoryTab("", 11, 32);

    static BOOKMARKS = new EnumCreativeInventoryTab("Bookmarks", 998, 20);
    static MODS = new EnumCreativeInventoryTab("Not Listed", 99998);
    static NOTLISTED = new EnumCreativeInventoryTab("Not Listed", 99999);
    static DEBUG = new EnumCreativeInventoryTab("Debug", 99, 1, true);

    constructor(name, id, icon = 1, devOnly = false) {
        this.name = name;
        this.id = id;
        this.icon = icon;
        this.devOnly = devOnly;
    }

    static isHidden(tab) {
        return tab === EnumCreativeInventoryTab.DEBUG
            || tab === EnumCreativeInventoryTab.NOTLISTED
            || tab === EnumCreativeInventoryTab.BOOKMARKS;
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
            if (EnumCreativeInventoryTab.isHidden(tab)) return;
            if (tab.devOnly && !EnumCreativeInventoryTab.isDevMode()) return;
            tabs.push(tab);
        });

        return tabs;
    }

}