import GuiContainer from "../GuiContainer.js";
import ContainerCreative from "../../../inventory/container/ContainerCreative.js";
import InventoryBasic from "../../../inventory/inventory/InventoryBasic.js";
import EnumCreativeInventoryTab from "../../EnumCreativeInventoryTab.js";
import GuiScreen from "../../GuiScreen.js";
import GuiTextField from "../../widgets/GuiTextField.js";
import Block from "../../../world/block/Block.js";
import { BlockRegistry } from "../../../world/block/BlockRegistry.js";

export default class GuiContainerCreative extends GuiContainer {

    static inventory = new InventoryBasic();
    static bookmarksKey = "creativeBookmarks";

    /**
     * Bookmarks live in local storage; the set itself sits on the container so
     * that both screens share it.
     */
    static loadBookmarks() {
        try {
            const saved = window.localStorage.getItem(GuiContainerCreative.bookmarksKey);
            if (!saved) return;

            for (const typeId of JSON.parse(saved)) {
                ContainerCreative.bookmarks.add(typeId);
            }
        } catch (error) {
            // No storage (or a corrupted value) just means no saved bookmarks.
        }
    }

    static saveBookmarks() {
        try {
            window.localStorage.setItem(GuiContainerCreative.bookmarksKey, JSON.stringify([...ContainerCreative.bookmarks]));
        } catch (error) {
            // Storage can be full or blocked; the set still works for this run.
        }
    }

    constructor(player) {
        super(new ContainerCreative(player));
        this.player = player;

        this.inventoryWidth = 195;
        this.inventoryHeight = 136;

        this.cantPauseGame = true;

        this.scrollOffset = 0;
        this.maxScroll = 0;

        this.isScrolling = false;
        this.currentScroll = 0;
        this._lastScrollTime = 0;
        this._scrollCooldownMs = 100;

        // Tabs are laid out in two rows - the first ones along the top edge and
        // the rest along the bottom - so there is nothing to page through.
        // The top edge only fits five tabs before the two slots under the
        // panel's right corner; those two tabs go on the bottom row instead.
        this.topRowTabs = 5;
        this.tabsPerPage = 7;
        this.selectedTabIndex = 1;
        this.allTabs = [];

        GuiContainerCreative.loadBookmarks();
    }

    init() {
        this.textureSearchInventory = this.getTexture("gui/container/creative_search.png");
        this.textureInventory = this.getTexture("gui/container/creative.png");
        this.textureSurvivalInventory = this.getTexture("gui/container/creative_inventory.png");
        this.textureScrollbar = this.getTexture("gui/scrollbar.png");
        this.textureTabs = this.getTexture("gui/tabs.png");
        this.textureBookIcon = this.getTexture("gui/RecipeBook/RecipeBook.png");

        super.init();

        // The search page's text field sits inside the box that
        // creative_search.png draws. It stays focused so typing always reaches
        // it, but only renders (and only takes keys) while that tab is open.
        this.searchField = new GuiTextField(this.x + 79, this.y + 5, 86, 9, false, true);
        this.searchField.enabled = true;
        this.searchField.renderBackground = false;
        this.searchField.noShadow = true;
        this.searchField.maxLength = 40;
        this.searchField.isFocused = true;
        this.searchField.renderE = false;
        this.buttonList.push(this.searchField);

        // Load all tabs (built-in + custom from mods)
        this.loadAllTabs();

        // Calculate max scroll based on total items
        const itemCount = this.container.itemList.length;
        const visibleRows = 5; // 5 rows visible at once
        const totalRows = Math.ceil(itemCount / 9);
        this.maxScroll = Math.max(0, totalRows - visibleRows);

    }

    loadAllTabs() {
        this.allTabs = [];

        // Load built-in tabs from EnumCreativeInventoryTab. Dev-only tabs
        // (Debug) only come back when the page was opened with ?dev=1.
        for (const tab of EnumCreativeInventoryTab.getBuiltinTabs()) {
            this.allTabs.push({
                id: tab.id,
                name: tab.name,
                icon: tab.icon,
                isCustom: false
            });
        }

        // Load custom tabs from mods
        if (this.minecraft.modLoader) {
            const customTabs = this.minecraft.modLoader.getCustomTabs();
            for (const customTab of customTabs) {
                this.allTabs.push({
                    id: customTab.id,
                    name: customTab.name,
                    iconBlockId: customTab.iconBlockId,
                    isCustom: true,
                    modId: customTab.modId
                });
            }
        }

        // Sort tabs by ID to maintain consistent order
        this.allTabs.sort((a, b) => a.id - b.id);
    }

    /**
     * Lay the tabs out in their two rows: the first tabs run along the top edge
     * starting at the top left, the rest continue along the bottom edge. Both
     * rows together hold every tab, so there is no paging. Search and bookmarks
     * are pinned to the two top right slots and the Survival Inventory tab to
     * the bottom right one; slots that stay empty are null.
     */
    getTabRows() {
        const pinnedTabs = [EnumCreativeInventoryTab.SEARCH, EnumCreativeInventoryTab.BOOKMARKS]
            .map(tab => this.allTabs.find(builtin => builtin.id === tab.id));
        const survivalTab = this.allTabs.find(tab => tab.id === EnumCreativeInventoryTab.SURVIVAL_INVENTORY.id);
        const flow = this.allTabs.filter(tab => tab !== survivalTab && !pinnedTabs.includes(tab));

        const top = flow.slice(0, this.topRowTabs);
        while (top.length < this.tabsPerPage - 2) {
            top.push(null);
        }

        // Search and bookmarks always own the two top right slots.
        top.push(pinnedTabs[0] ?? null, pinnedTabs[1] ?? null);

        const bottom = flow.slice(this.topRowTabs, this.topRowTabs + this.tabsPerPage - 1);

        if (survivalTab) {
            // Keep the last bottom slot for the survival inventory; tabs that
            // would need a third row are left out rather than overlapped.
            while (bottom.length < this.tabsPerPage - 1) {
                bottom.push(null);
            }
            bottom.length = this.tabsPerPage - 1;
            bottom.push(survivalTab);
        }

        return {top, bottom};
    }

    mouseClicked(mouseX, mouseY, button) {
        if (button === 0 && this.handleTabClick(mouseX, mouseY)) {
            return;
        }

        super.mouseClicked(mouseX, mouseY, button);

        // A middle click in the palette changed the bookmarks; keep them.
        if (button === 2) {
            GuiContainerCreative.saveBookmarks();
        }

        if (!this.isSurvivalTab()) {
            const barX = this.x + 176;
            const barY = this.y + 19;
            const barWidth = 12;
            const barHeight = 109;

            if (mouseX >= barX && mouseX < barX + barWidth && 
                mouseY >= barY && mouseY < barY + barHeight) {
                
                this.isScrolling = true;
                this.handleScrollInput(mouseY);
            }
        }
    }

    mouseReleased(mouseX, mouseY, button) {
        super.mouseReleased(mouseX, mouseY, button);
        this.isScrolling = false;
    }

    /**
     * Get the x position of a creative tab (1–7).
     */
    getTabX(tabId) {
        let tabX = this.x;
        if (tabId >= 2 && tabId <= 5) {
            tabX += 26 * (tabId - 1);
        } else if (tabId === 6) {
            tabX += 143;
        } else if (tabId === 7) {
            tabX += 143 + 26;
        }
        return tabX;
    }

    /**
     * Where the active tab at `index` (0-based, on the current page) is drawn
     * and which horizontal slice of tabs.png it uses (0 = left tab, 26 = the
     * middle/right slice, 156 = the far right tab).
     */
    getTabPosition(index) {
        if (index >= 1 && index <= 4) {
            return {destX: this.x + 26 * index, sourceX: 26};
        } else if (index === 5) {
            return {destX: this.x + 143, sourceX: 26};
        } else if (index === 6) {
            return {destX: this.x + 143 + 26, sourceX: 156};
        }
        return {destX: this.x, sourceX: 0};
    }

    /**
     * True while the Survival Inventory tab is open. That tab is not a palette
     * filter: it shows the player's own inventory, so the palette background,
     * scrollbar and scrolling do not apply to it.
     */
    isSurvivalTab() {
        return this.selectedTabIndex === EnumCreativeInventoryTab.SURVIVAL_INVENTORY.id;
    }

    /**
     * True while the search page is open: the palette then lists every block
     * whose name matches the typed query.
     */
    isSearchTab() {
        return this.selectedTabIndex === EnumCreativeInventoryTab.SEARCH.id;
    }

    /**
     * True while the bookmarks page is open.
     */
    isBookmarksTab() {
        return this.selectedTabIndex === EnumCreativeInventoryTab.BOOKMARKS.id;
    }

    /**
     * Handle a click on one of the creative tabs. Returns true if the click
     * hit a tab (which was then selected).
     */
    handleTabClick(mouseX, mouseY) {
        const tabY = this.y + this.inventoryHeight - 4;
        const topTabY = this.y - 28;

        if (mouseX < this.x || mouseX >= this.x + this.inventoryWidth) return false;

        const {top: topTabs, bottom: bottomTabs} = this.getTabRows();

        // Either row is clickable; each one only holds its own tabs.
        if (mouseY >= topTabY && mouseY < topTabY + 32) {
            return this.selectTabAt(topTabs, mouseX);
        }

        if (mouseY >= tabY && mouseY < tabY + 32) {
            return this.selectTabAt(bottomTabs, mouseX);
        }

        return false;
    }

    /**
     * Select the tab under `mouseX` in `tabs`, laid out from position 1.
     */
    selectTabAt(tabs, mouseX) {
        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            if (!tab) continue;

            const tabX = this.getTabX(i + 1);
            if (mouseX >= tabX && mouseX < tabX + 26) {
                if (this.selectedTabIndex !== tab.id) {
                    this.selectedTabIndex = tab.id;
                    this.updateTabItems();
                }
                return true;
            }
        }

        return false;
    }

    mouseDragged(mouseX, mouseY, button) {
        if (this.isScrolling) {
            this.handleScrollInput(mouseY);
        }
        super.mouseDragged(mouseX, mouseY, button);
    }

    handleScrollInput(mouseY) {
        const trackTop = this.y + 18;
        const trackBottom = this.y + 128;
        const thumbHeight = 15;
        
        const scrollRange = (trackBottom - trackTop) - thumbHeight;
        let relativeY = mouseY - trackTop - (thumbHeight / 2);
        
        let scrollPercent = relativeY / scrollRange;
        scrollPercent = Math.max(0, Math.min(1, scrollPercent));

        this.scrollOffset = Math.round(scrollPercent * this.maxScroll);
        
        this.container.scrollTo(scrollPercent);
    }

    drawInventoryBackground(stack) {
        const {top: topTabs, bottom: bottomTabs} = this.getTabRows();
        const survival = this.isSurvivalTab();

        // A middle click can change the bookmarks while their page is open.
        if (this.isBookmarksTab() && this.container.bookmarksDirty) {
            this.container.bookmarksDirty = false;
            this.container.showBookmarks();
        }

        // Draw the inactive tabs of both rows, then the panel covers their inner
        // edge. tabs.png has a top set of graphics (rows 0-31) and a bottom set
        // (rows 64-127); empty slots are skipped.
        const tabY = this.y + this.inventoryHeight - 4;
        const topTabY = this.y - 28;

        for (let i = 0; i < topTabs.length; i++) {
            if (!topTabs[i]) continue;

            this.drawSprite(stack, this.textureTabs, 0, 0, 26, 32, this.getTabX(i + 1), topTabY, 26, 32);
        }

        for (let i = 0; i < bottomTabs.length; i++) {
            if (!bottomTabs[i]) continue;

            this.drawSprite(stack, this.textureTabs, 0, 65, 26, 31, this.getTabX(i + 1), tabY, 26, 31);
        }

        // Draw the main background texture. The Survival Inventory tab is not
        // a palette, so it brings its own panel (creative_inventory.png).
        this.drawSprite(
            stack,
            survival
                ? this.textureSurvivalInventory
                : (this.isSearchTab() ? this.textureSearchInventory : this.textureInventory),
            0,
            0,
            this.inventoryWidth,
            this.inventoryHeight,
            this.x,
            this.y,
            this.inventoryWidth,
            this.inventoryHeight
        );

        // Highlight the active tab in whichever row it sits in
        const activeTopTabIndex = topTabs.findIndex(tab => tab && tab.id === this.selectedTabIndex);
        if (activeTopTabIndex !== -1) {
            const {destX, sourceX} = this.getTabPosition(activeTopTabIndex);

            this.drawSprite(stack, this.textureTabs, sourceX, 32, 26, 32, destX, topTabY, 26, 32);
        }

        const activeBottomTabIndex = bottomTabs.findIndex(tab => tab && tab.id === this.selectedTabIndex);
        if (activeBottomTabIndex !== -1) {
            const {destX, sourceX} = this.getTabPosition(activeBottomTabIndex);

            this.drawSprite(stack, this.textureTabs, sourceX, 96, 26, 32, destX, tabY, 26, 32);
        }

        // The survival panel has no scroll column, so neither state is drawn.
        if (survival) return;

        if (this.maxScroll > 0) {
            const barX = this.x + 175;
            const trackTop = 18;
            const trackBottom = 128;
            const thumbHeight = 15;

            const scrollRange = (trackBottom - trackTop) - thumbHeight;

            const scrollPercent = this.scrollOffset / this.maxScroll;
            const thumbY = this.y + trackTop + (scrollPercent * scrollRange);

            this.drawSprite(stack, this.textureScrollbar, 0, 0, 12, 15, barX, thumbY, 12, 15);
        } else {
            const barX = this.x + 175;
            const trackTop = 18;

            const thumbY = this.y + trackTop;

            this.drawSprite(stack, this.textureScrollbar, 0, 15, 12, 15, barX, thumbY, 12, 15);
        }
    }

    renderPostScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawTabIcons(stack);
        super.renderPostScreen(stack, mouseX, mouseY, partialTicks);
    }

    /**
     * The block shown inside a tab: built-in tabs name their icon id, custom
     * ones either a namespaced or a numeric block id.
     */
    getTabIconBlock(tab) {
        if (tab.isCustom) {
            if (tab.iconBlockId.includes(':')) {
                const [modId, blockName] = tab.iconBlockId.split(':');
                return BlockRegistry.get(`${modId}:${blockName}`);
            }
            return Block.getById(parseInt(tab.iconBlockId));
        }

        return Block.getById(tab.icon);
    }

    drawTabIcons(stack) {
        // The selected tab pops toward its panel edge, so its icon sits 3px
        // closer to the panel than the icon of an inactive tab.
        const {top, bottom} = this.getTabRows();
        const rows = [
            {tabs: top, y: this.y - 28, suffix: "_top", selectedOffset: 15, normalOffset: 18},
            {tabs: bottom, y: this.y + this.inventoryHeight - 4, suffix: "", selectedOffset: 17, normalOffset: 14}
        ];

        for (const row of rows) {
            for (let i = 0; i < row.tabs.length; i++) {
                const tab = row.tabs[i];
                if (!tab) continue;

                const iconY = row.y + (this.selectedTabIndex === tab.id ? row.selectedOffset : row.normalOffset);

                // Bookmarks shows the recipe book sprite; every other tab shows
                // the block that names it.
                if (tab.id === EnumCreativeInventoryTab.BOOKMARKS.id && this.textureBookIcon) {
                    this.drawSprite(stack, this.textureBookIcon, 0, 0, 20, 18, this.getTabX(i + 1) + 3, iconY - 9, 20, 18);
                    continue;
                }

                const block = this.getTabIconBlock(tab);
                if (!block) continue;

                const isSelected = this.selectedTabIndex === tab.id;

                this.minecraft.itemRenderer.renderItemInGui(
                    "inventory",
                    "creative_tab_" + tab.id + row.suffix,
                    block,
                    this.getTabX(i + 1) + 13,
                    row.y + (isSelected ? row.selectedOffset : row.normalOffset)
                );
            }
        }
    }

    drawTitle(stack) {
        let gotName = undefined;
        const selectedTab = this.allTabs.find(tab => tab.id === this.selectedTabIndex);
        if (selectedTab) {
            gotName = selectedTab.name;
        }
        this.drawString(stack, gotName ?? `Unnamed tab #${this.selectedTabIndex}`, this.x + 8, this.y + 6, 0x404040, false);

        // The text field draws the query and its cursor itself; only the hint
        // for an empty query is drawn here, before the field paints over it.
        if (this.isSearchTab() && this.searchField && this.searchField.getText().length === 0) {
            this.drawString(stack, "Search...", this.searchField.x + 2, this.searchField.y + this.searchField.height / 2 - 4, 0x808080, false);
        }
    }

    updateTabItems() {
        const survival = this.isSurvivalTab();

        if (this.searchField) {
            this.searchField.renderE = this.isSearchTab();
            this.searchField.isFocused = this.isSearchTab();
        }

        // The survival page has nothing to filter: it swaps the palette rows
        // for the player's own inventory instead. Search and bookmarks build
        // their own item list, the category tabs filter by inventory tab.
        this.container.showSurvivalInventory(survival);

        if (survival) {
            // showSurvivalInventory already cleared the list for this page.
        } else if (this.isSearchTab()) {
            this.container.updateSearch(this.searchField.getText());
        } else if (this.isBookmarksTab()) {
            this.container.showBookmarks();
        } else {
            this.container.updateFilter(this.selectedTabIndex);
        }

        this.refreshFilteredItems();
    }

    /**
     * Recompute the scroll range for the current item list and rebuild the item
     * renderer, so a changed filter shows up right away.
     */
    refreshFilteredItems() {
        const totalRows = Math.ceil(this.container.itemList.length / 9);
        this.maxScroll = Math.max(0, totalRows - 5);
        this.scrollOffset = 0;

        if (this.minecraft?.itemRenderer) {
            this.minecraft.itemRenderer.destroy("*");
        }
        this.container.dirty = true;
    }

    /**
     * Feed a key press into the search query. Returns false for keys that are
     * not text, so they keep their normal meaning.
     */
    handleSearchKey(key, character) {
        // The text field owns the text and the cursor; only the keys it edits
        // with are routed through here, so Escape and the shortcuts keep their
        // normal meaning.
        const isText = typeof character === "string" && character.length === 1;
        if (!isText && key !== "Backspace" && key !== "ArrowLeft" && key !== "ArrowRight") {
            return false;
        }

        this.searchField.keyTyped(key, character);
        this.container.updateSearch(this.searchField.getText());
        this.refreshFilteredItems();
        return true;
    }

    keyTyped(key, character) {
        // On the search page the keyboard types the query, so the inventory key
        // can be part of a block name instead of closing the screen.
        if (this.isSearchTab() && this.handleSearchKey(key, character)) {
            return true;
        }

        if (key === this.minecraft.settings.keyOpenInventory) {
            this.minecraft.displayScreen(null);
            return true;
        }

        // Scroll up
        if (key === "ArrowUp") {
            this.scrollToRow(this.scrollOffset - 1);
            return true;
        }

        // Scroll down
        if (key === "ArrowDown") {
            this.scrollToRow(this.scrollOffset + 1);
            return true;
        }

        let tabChanged = false;

        if (key === "ArrowRight" || key === "ArrowLeft") {
            // Walk the tabs in the order they are drawn: top row, then bottom.
            const {top, bottom} = this.getTabRows();
            const ordered = [...top, ...bottom.filter(tab => tab !== null)];
            const currentIndex = ordered.findIndex(tab => tab.id === this.selectedTabIndex);
            const nextIndex = key === "ArrowRight" ? currentIndex + 1 : currentIndex - 1;

            if (currentIndex !== -1 && nextIndex >= 0 && nextIndex < ordered.length) {
                this.selectedTabIndex = ordered[nextIndex].id;
                tabChanged = true;
            }
        }

        if (tabChanged) {
            this.updateTabItems();
            return true;
        }

        return super.keyTyped(key, character);
    }

    scrollToRow(row) {
        if (this.isSurvivalTab()) return;

        this.scrollOffset = Math.max(0, Math.min(this.maxScroll, row));
        const scrollPercent = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
        
        this.container.scrollTo(scrollPercent);

        if (this.minecraft?.itemRenderer) {
            this.minecraft.itemRenderer.destroy("*");
        }
        this.container.dirty = true;
    }

    onScroll(mouseX, mouseY, amount) {
        return this.mouseScroll(mouseX, mouseY, amount);
    }

    mouseScroll(mouseX, mouseY, direction) {
        if (this.isSurvivalTab()) return false;

        const now = Date.now();
        if (now - this._lastScrollTime < this._scrollCooldownMs) {
            return false;
        }
        this._lastScrollTime = now;

        // direction: positive => scroll down, negative => scroll up
        this.scrollToRow(this.scrollOffset + (direction > 0 ? 1 : -1));
        return true;
    }

}