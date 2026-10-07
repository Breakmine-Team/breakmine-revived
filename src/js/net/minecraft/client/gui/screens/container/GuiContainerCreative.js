import GuiContainer from "../GuiContainer.js";
import ContainerCreative from "../../../inventory/container/ContainerCreative.js";
import InventoryBasic from "../../../inventory/inventory/InventoryBasic.js";
import EnumCreativeInventoryTab from "../../EnumCreativeInventoryTab.js";
import GuiScreen from "../../GuiScreen.js";
import Block from "../../../world/block/Block.js";
import { BlockRegistry } from "../../../world/block/BlockRegistry.js";
import GuiButton from "../../widgets/GuiButton.js";

export default class GuiContainerCreative extends GuiContainer {

    static inventory = new InventoryBasic();

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

        // Tab pagination
        this.currentPage = 0;
        this.tabsPerPage = 7;
        this.selectedTabIndex = 1;
        this.allTabs = [];
    }

    init() {
        this.textureSearchInventory = this.getTexture("gui/container/creative_search.png");
        this.textureInventory = this.getTexture("gui/container/creative.png");
        this.textureScrollbar = this.getTexture("gui/scrollbar.png");
        this.textureTabs = this.getTexture("gui/tabs.png");

        super.init();

        // Load all tabs (built-in + custom from mods)
        this.loadAllTabs();

        // Calculate max scroll based on total items
        const itemCount = this.container.itemList.length;
        const visibleRows = 5; // 5 rows visible at once
        const totalRows = Math.ceil(itemCount / 9);
        this.maxScroll = Math.max(0, totalRows - visibleRows);

        // Only add navigation buttons if there are more than 7 tabs
        if (this.allTabs.length > this.tabsPerPage) {
            // Add prev page button (above the GUI texture)
            this.prevTabButton = new GuiButton(
                this.minecraft,
                "<",
                this.x,
                this.y - 22,
                20,
                20,
                () => {
                    if (this.currentPage > 0) {
                        this.currentPage--;
                        this.updateTabButtons();
                    }
                }
            );
            this.buttonList.push(this.prevTabButton);

            // Add next page button (above the GUI texture)
            this.nextTabButton = new GuiButton(
                this.minecraft,
                ">",
                this.x + this.inventoryWidth - 20,
                this.y - 22,
                20,
                20,
                () => {
                    const maxPage = Math.ceil(this.allTabs.length / this.tabsPerPage) - 1;
                    if (this.currentPage < maxPage) {
                        this.currentPage++;
                        this.updateTabButtons();
                    }
                }
            );
            this.buttonList.push(this.nextTabButton);

            // Set initial button enabled states
            this.updateTabButtons();
        }
    }

    loadAllTabs() {
        this.allTabs = [];

        // Load built-in tabs from EnumCreativeInventoryTab
        Object.keys(EnumCreativeInventoryTab).forEach(propertyName => {
            const tab = EnumCreativeInventoryTab[propertyName];
            if (tab && typeof tab === 'object' && !(tab.id >= 99998)) {
                this.allTabs.push({
                    id: tab.id,
                    name: tab.name,
                    icon: tab.icon,
                    isCustom: false
                });
            }
        });

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

    getCurrentPageTabs() {
        const startIndex = this.currentPage * this.tabsPerPage;
        const endIndex = startIndex + this.tabsPerPage;
        return this.allTabs.slice(startIndex, endIndex);
    }

    updateTabButtons() {
        if (!this.prevTabButton || !this.nextTabButton) return;

        const maxPage = Math.ceil(this.allTabs.length / this.tabsPerPage) - 1;
        this.prevTabButton.setEnabled(this.currentPage > 0);
        this.nextTabButton.setEnabled(this.currentPage < maxPage);

        // Destroy items so they rerender when page changes
        if (this.minecraft?.itemRenderer) {
            this.minecraft.itemRenderer.destroy("*");
        }
        this.container.dirty = true;
    }

    mouseClicked(mouseX, mouseY, button) {
        if (button === 0 && this.handleTabClick(mouseX, mouseY)) {
            return;
        }

        super.mouseClicked(mouseX, mouseY, button);
        if (true) {
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
     * Handle a click on one of the creative tabs. Returns true if the click
     * hit a tab (which was then selected).
     */
    handleTabClick(mouseX, mouseY) {
        const tabY = this.y + this.inventoryHeight - 4;
        if (mouseY < tabY || mouseY >= tabY + 32) return false;
        if (mouseX < this.x || mouseX >= this.x + this.inventoryWidth) return false;

        const currentTabs = this.getCurrentPageTabs();
        for (let i = 0; i < currentTabs.length; i++) {
            const tab = currentTabs[i];
            const tabX = this.getTabX(i + 1); // Position in current page (1-7)
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
        const currentTabs = this.getCurrentPageTabs();

        // Draw inactive bottom tabs - only for positions that have tabs
        for (let i = 0; i < currentTabs.length; i++) {
            const tabX = this.getTabX(i + 1);
            const tabY = this.y + this.inventoryHeight - 4;

            const sourceX = 0;
            const sourceY = 65;
            const tabRowWidth = 26;
            const tabRowHeight = 31;

            this.drawSprite(
                stack,
                this.textureTabs,
                sourceX, sourceY,
                tabRowWidth, tabRowHeight,
                tabX, tabY,
                tabRowWidth, tabRowHeight
            );
        }

        // Draw the main background texture
        this.drawSprite(
            stack,
            this.selectedTabIndex === 999 ? this.textureSearchInventory : this.textureInventory,
            0,
            0,
            this.inventoryWidth,
            this.inventoryHeight,
            this.x,
            this.y,
            this.inventoryWidth,
            this.inventoryHeight
        );

        // Draw active bottom tab based on position in current page
        const activeTabIndex = currentTabs.findIndex(tab => tab.id === this.selectedTabIndex);
        if (activeTabIndex !== -1) {
            let sourceX = 0;
            const sourceY = 96;
            const tabRowWidth = 26;
            const tabRowHeight = 32;

            let destX = this.x;

            if (activeTabIndex === 1) {
                destX += 26;
                sourceX = 26;
            } else if (activeTabIndex === 2) {
                destX += 26 * 2;
                sourceX = 26;
            } else if (activeTabIndex === 3) {
                destX += 26 * 3;
                sourceX = 26;
            } else if (activeTabIndex === 4) {
                destX += 26 * 4;
                sourceX = 26;
            } else if (activeTabIndex === 5) {
                destX += 143;
                sourceX = 26;
            } else if (activeTabIndex === 6) {
                destX += 143 + 26;
                sourceX = 156;
            }

            const destY = this.y + this.inventoryHeight - 4;

            this.drawSprite(
                stack,
                this.textureTabs,
                sourceX, sourceY,
                tabRowWidth, tabRowHeight,
                destX, destY,
                tabRowWidth, tabRowHeight
            );
        }

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
        this.drawTabIcons();
        super.renderPostScreen(stack, mouseX, mouseY, partialTicks);
    }

    drawTabIcons() {
        const currentTabs = this.getCurrentPageTabs();
        for (let i = 0; i < currentTabs.length; i++) {
            const tab = currentTabs[i];
            const tabX = this.getTabX(i + 1); // Position in current page (1-7)

            const tabY = this.y + this.inventoryHeight - 4;

            // Active tab pops down slightly (+12), while inactive tabs stay centered (+10)
            const isSelected = (this.selectedTabIndex === tab.id);
            let iconYOffset = isSelected ? 13 : 10;
            iconYOffset += 4;

            let block;
            if (tab.isCustom) {
                // For custom tabs, resolve the block ID
                if (tab.iconBlockId.includes(':')) {
                    const [modId, blockName] = tab.iconBlockId.split(':');
                    const namespacedId = `${modId}:${blockName}`;
                    block = BlockRegistry.get(namespacedId);
                } else {
                    // Assume it's a vanilla block ID
                    block = Block.getById(parseInt(tab.iconBlockId));
                }
            } else {
                // For built-in tabs, use the icon property
                block = Block.getById(tab.icon);
            }

            if (!block) continue;

            this.minecraft.itemRenderer.renderItemInGui(
                "inventory",
                "creative_tab_" + tab.id,
                block,
                tabX + 13,
                tabY + iconYOffset
            );
        }
    }

    drawTitle(stack) {
        let gotName = undefined;
        const selectedTab = this.allTabs.find(tab => tab.id === this.selectedTabIndex);
        if (selectedTab) {
            gotName = selectedTab.name;
        }
        this.drawString(stack, gotName ?? `Unnamed tab #${this.selectedTabIndex}`, this.x + 8, this.y + 6, 0x404040, false);

        // Draw page counter label (e.g., "1/2") centered above the GUI, only if there are multiple pages
        if (this.allTabs.length > this.tabsPerPage) {
            const maxPage = Math.ceil(this.allTabs.length / this.tabsPerPage);
            const pageCounter = `${this.currentPage + 1}/${maxPage}`;
            const counterWidth = this.minecraft.fontRenderer.getStringWidth(stack, pageCounter);
            this.drawString(stack, pageCounter, this.x + this.inventoryWidth / 2 - counterWidth / 2, this.y - 16, 0xFFFFFF, false);
        }
    }

    updateTabItems() {
        this.container.updateFilter(this.selectedTabIndex);

        const itemCount = this.container.itemList.length;
        const visibleRows = 5;
        const totalRows = Math.ceil(itemCount / 9);
        this.maxScroll = Math.max(0, totalRows - visibleRows);

        this.scrollOffset = 0;

        // Destroy items so they rerender with the new tab's items
        if (this.minecraft?.itemRenderer) {
            this.minecraft.itemRenderer.destroy("*");
        }
        this.container.dirty = true;

        // Update button enabled states (for page navigation)
        this.updateTabButtons();
    }

    keyTyped(key, character) {
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

        if (key === "ArrowRight") {
            // Move to next tab, or next page if at end of current page
            const currentTabs = this.getCurrentPageTabs();
            const currentIndex = currentTabs.findIndex(tab => tab.id === this.selectedTabIndex);
            if (currentIndex < currentTabs.length - 1) {
                // Move to next tab in current page
                this.selectedTabIndex = currentTabs[currentIndex + 1].id;
                tabChanged = true;
            } else {
                // Move to first tab of next page
                const maxPage = Math.ceil(this.allTabs.length / this.tabsPerPage) - 1;
                if (this.currentPage < maxPage) {
                    this.currentPage++;
                    const nextTabs = this.getCurrentPageTabs();
                    if (nextTabs.length > 0) {
                        this.selectedTabIndex = nextTabs[0].id;
                        tabChanged = true;
                    }
                }
            }
        }

        if (key === "ArrowLeft") {
            // Move to previous tab, or previous page if at start of current page
            const currentTabs = this.getCurrentPageTabs();
            const currentIndex = currentTabs.findIndex(tab => tab.id === this.selectedTabIndex);
            if (currentIndex > 0) {
                // Move to previous tab in current page
                this.selectedTabIndex = currentTabs[currentIndex - 1].id;
                tabChanged = true;
            } else {
                // Move to last tab of previous page
                if (this.currentPage > 0) {
                    this.currentPage--;
                    const prevTabs = this.getCurrentPageTabs();
                    if (prevTabs.length > 0) {
                        this.selectedTabIndex = prevTabs[prevTabs.length - 1].id;
                        tabChanged = true;
                    }
                }
            }
        }

        if (tabChanged) {
            this.updateTabItems();
            return true;
        }

        return super.keyTyped(key, character);
    }

    scrollToRow(row) {
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