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

    // Not a palette: selecting this tab shows the player's own survival
    // inventory in the creative screen (creative_inventory.png), the way the
    // chest tab did in old creative menus. The icon is the chest block.
    static SURVIVAL_INVENTORY = new EnumCreativeInventoryTab("Survival Inventory", 10, 32);

    // Pinned to the two top right slots of the creative screen. Search filters
    // the whole block list by typed name, bookmarks lists the blocks the player
    // saved with a middle click; neither one is a palette category.
    static SEARCH = new EnumCreativeInventoryTab("Search", 999, 20);
    static BOOKMARKS = new EnumCreativeInventoryTab("Bookmarks", 998, 20);

    // Development-only tab, shown only when the game is opened with ?dev=1.
    static DEBUG = new EnumCreativeInventoryTab("Debug", 8, 1, true);

    constructor(name, id, icon = 1, devOnly = false) {
        this.name = name;
        this.id = id;
        this.icon = icon;
        this.devOnly = devOnly;
    }

    /**
     * Tabs whose contents must never appear in the creative menu, including the
     * search page: they hold internal/debug blocks, not player-facing items.
     */
    static isHidden(tab) {
        return tab === EnumCreativeInventoryTab.DEBUG
            || tab === EnumCreativeInventoryTab.NOTLISTED;
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