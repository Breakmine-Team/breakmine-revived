import GuiContainer from "../GuiContainer.js";
import ContainerCreative from "../../../inventory/container/ContainerCreative.js";
import InventoryBasic from "../../../inventory/inventory/InventoryBasic.js";
import EnumCreativeInventoryTab from "../../EnumCreativeInventoryTab.js";
import GuiScreen from "../../GuiScreen.js";
import Block from "../../../world/block/Block.js";

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
        
        // Start selected tab at index 1
        this.selectedTabIndex = 1;
    }

    init() {
        this.textureSearchInventory = this.getTexture("gui/container/creative_search.png");
        this.textureInventory = this.getTexture("gui/container/creative.png");
        this.textureScrollbar = this.getTexture("gui/scrollbar.png");
        this.textureTabs = this.getTexture("gui/tabs.png");

        super.init();
        
        // Calculate max scroll based on total items
        const itemCount = this.container.itemList.length;
        const visibleRows = 5; // 5 rows visible at once
        const totalRows = Math.ceil(itemCount / 9);
        this.maxScroll = Math.max(0, totalRows - visibleRows);
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

        for (let tabId = 1; tabId <= 7; tabId++) {
            const tabX = this.getTabX(tabId);
            if (mouseX >= tabX && mouseX < tabX + 26) {
                if (this.selectedTabIndex !== tabId) {
                    this.selectedTabIndex = tabId;
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
        // Draw inactive bottom tabs (left-side)
        if (true) {
            const sourceX = 0;
            const sourceY = 65;
            const tabRowWidth = 130;
            const tabRowHeight = 31;

            const destX = this.x;
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

        // Draw inactive bottom tabs (right-side)
        if (true) {
            const sourceX = 0;
            const sourceY = 65;
            const tabRowWidth = 52;
            const tabRowHeight = 31;

            const destX = this.x + 143;
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

        // Draw active bottom tab (1 to 7)
        let sourceX = 0;
        const sourceY = 96;
        const tabRowWidth = 26;
        const tabRowHeight = 32;

        let destX = this.x;

        if (this.selectedTabIndex === 2) {
            destX += 26;
            sourceX = 26;
        } else if (this.selectedTabIndex === 3) {
            destX += 26 * 2;
            sourceX = 26;
        } else if (this.selectedTabIndex === 4) {
            destX += 26 * 3;
            sourceX = 26;
        } else if (this.selectedTabIndex === 5) {
            destX += 26 * 4;
            sourceX = 26;
        } else if (this.selectedTabIndex === 6) {
            destX += 143;
            sourceX = 26;
        } else if (this.selectedTabIndex === 7) {
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
        for (let tabId = 1; tabId <= 7; tabId++) {
            let tab = null;
            Object.keys(EnumCreativeInventoryTab).forEach(propertyName => {
                let property = EnumCreativeInventoryTab[propertyName];
                if (property && property.id === tabId) {
                    tab = property;
                }
            });

            if (!tab) continue;

            const block = Block.getById(tab.icon);
            if (!block) continue;

            const tabX = this.getTabX(tabId);

            const tabY = this.y + this.inventoryHeight - 4;
            
            // Active tab pops down slightly (+12), while inactive tabs stay centered (+10)
            const isSelected = (this.selectedTabIndex === tabId);
            let iconYOffset = isSelected ? 13 : 10;
            iconYOffset += 4;

            this.minecraft.itemRenderer.renderItemInGui(
                "inventory",
                "creative_tab_" + tabId,
                block,
                tabX + 13,
                tabY + iconYOffset
            );
        }
    }

    drawTitle(stack) {
        let gotName = undefined;
        Object.keys(EnumCreativeInventoryTab).forEach(propertyName => {
            let property = EnumCreativeInventoryTab[propertyName];
            if (property.id && property.id === this.selectedTabIndex) {
                gotName = property.name;
            }
        });
        this.drawString(stack, gotName ?? `Unnamed tab #${this.selectedTabIndex}`, this.x + 8, this.y + 6, 0x404040, false);
    }

    updateTabItems() {
        this.container.updateFilter(this.selectedTabIndex);
        
        const itemCount = this.container.itemList.length;
        const visibleRows = 5;
        const totalRows = Math.ceil(itemCount / 9);
        this.maxScroll = Math.max(0, totalRows - visibleRows);
        
        this.scrollOffset = 0;
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
            if (this.selectedTabIndex < 7) {
                this.selectedTabIndex++;
                tabChanged = true;
            }
        }

        if (key === "ArrowLeft") {
            if (this.selectedTabIndex > 1) {
                this.selectedTabIndex--;
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