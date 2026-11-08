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

    
    static loadBookmarks() {
        try {
            const saved = window.localStorage.getItem(GuiContainerCreative.bookmarksKey);
            if (!saved) return;

            for (const typeId of JSON.parse(saved)) {
                ContainerCreative.bookmarks.add(typeId);
            }
        } catch (error) {
        }
    }

    static saveBookmarks() {
        try {
            window.localStorage.setItem(GuiContainerCreative.bookmarksKey, JSON.stringify([...ContainerCreative.bookmarks]));
        } catch (error) {
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

        this.searchField = new GuiTextField(this.x + 79, this.y + 5, 86, 9, false, true);
        this.searchField.enabled = true;
        this.searchField.renderBackground = false;
        this.searchField.noShadow = true;
        this.searchField.maxLength = 40;
        this.searchField.isFocused = true;
        this.searchField.renderE = false;
        this.buttonList.push(this.searchField);

        this.loadAllTabs();

        const itemCount = this.container.itemList.length;
        const visibleRows = 5; 
        const totalRows = Math.ceil(itemCount / 9);
        this.maxScroll = Math.max(0, totalRows - visibleRows);

    }

    loadAllTabs() {
        this.allTabs = [];

        for (const tab of EnumCreativeInventoryTab.getBuiltinTabs()) {
            this.allTabs.push({
                id: tab.id,
                name: tab.name,
                icon: tab.icon,
                isCustom: false
            });
        }

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

        this.allTabs.sort((a, b) => a.id - b.id);
    }

    
    getTabRows() {
        const pinnedTabs = [EnumCreativeInventoryTab.SEARCH, EnumCreativeInventoryTab.BOOKMARKS]
            .map(tab => this.allTabs.find(builtin => builtin.id === tab.id));
        const survivalTab = this.allTabs.find(tab => tab.id === EnumCreativeInventoryTab.SURVIVAL_INVENTORY.id);
        const flow = this.allTabs.filter(tab => tab !== survivalTab && !pinnedTabs.includes(tab));

        const top = flow.slice(0, this.topRowTabs);
        while (top.length < this.tabsPerPage - 2) {
            top.push(null);
        }

        top.push(pinnedTabs[0] ?? null, pinnedTabs[1] ?? null);

        const bottom = flow.slice(this.topRowTabs, this.topRowTabs + this.tabsPerPage - 1);

        if (survivalTab) {
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

    
    isSurvivalTab() {
        return this.selectedTabIndex === EnumCreativeInventoryTab.SURVIVAL_INVENTORY.id;
    }

    
    isSearchTab() {
        return this.selectedTabIndex === EnumCreativeInventoryTab.SEARCH.id;
    }

    
    isBookmarksTab() {
        return this.selectedTabIndex === EnumCreativeInventoryTab.BOOKMARKS.id;
    }

    
    handleTabClick(mouseX, mouseY) {
        const tabY = this.y + this.inventoryHeight - 4;
        const topTabY = this.y - 28;

        if (mouseX < this.x || mouseX >= this.x + this.inventoryWidth) return false;

        const {top: topTabs, bottom: bottomTabs} = this.getTabRows();

        if (mouseY >= topTabY && mouseY < topTabY + 32) {
            return this.selectTabAt(topTabs, mouseX);
        }

        if (mouseY >= tabY && mouseY < tabY + 32) {
            return this.selectTabAt(bottomTabs, mouseX);
        }

        return false;
    }

    
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

        if (this.isBookmarksTab() && this.container.bookmarksDirty) {
            this.container.bookmarksDirty = false;
            this.container.showBookmarks();
        }

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

        this.container.showSurvivalInventory(survival);

        if (survival) {
        } else if (this.isSearchTab()) {
            this.container.updateSearch(this.searchField.getText());
        } else if (this.isBookmarksTab()) {
            this.container.showBookmarks();
        } else {
            this.container.updateFilter(this.selectedTabIndex);
        }

        this.refreshFilteredItems();
    }

    
    refreshFilteredItems() {
        const totalRows = Math.ceil(this.container.itemList.length / 9);
        this.maxScroll = Math.max(0, totalRows - 5);
        this.scrollOffset = 0;

        if (this.minecraft?.itemRenderer) {
            this.minecraft.itemRenderer.destroy("*");
        }
        this.container.dirty = true;
    }

    
    handleSearchKey(key, character) {
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
        if (this.isSearchTab() && this.handleSearchKey(key, character)) {
            return true;
        }

        if (key === this.minecraft.settings.keyOpenInventory) {
            this.minecraft.displayScreen(null);
            return true;
        }

        if (key === "ArrowUp") {
            this.scrollToRow(this.scrollOffset - 1);
            return true;
        }

        if (key === "ArrowDown") {
            this.scrollToRow(this.scrollOffset + 1);
            return true;
        }

        let tabChanged = false;

        if (key === "ArrowRight" || key === "ArrowLeft") {
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

        this.scrollToRow(this.scrollOffset + (direction > 0 ? 1 : -1));
        return true;
    }

}