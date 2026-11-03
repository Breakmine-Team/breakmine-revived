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

    // Shaft machinery (shafts, half-shafts and cogs), formerly the Factorio mod.
    static FACTORIO = new EnumCreativeInventoryTab("Factorio", 9, 342);

    // Development-only tab, shown only when the game is opened with ?dev=1.
    static DEBUG = new EnumCreativeInventoryTab("Debug", 8, 1, true);

    constructor(name, id, icon = 1, devOnly = false) {
        this.name = name;
        this.id = id;
        this.icon = icon;
        this.devOnly = devOnly;
    }

    /** True when the page was opened with ?dev=1. */
    static isDevMode() {
        if (typeof window === 'undefined' || !window.location) return false;
        return new URLSearchParams(window.location.search).get('dev') === '1';
    }

    /**
     * The built-in tabs the creative screen should offer. Development-only
     * tabs (Debug) are left out unless the page was opened with ?dev=1.
     */
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