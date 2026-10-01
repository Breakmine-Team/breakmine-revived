import Gui from "../Gui.js";
import Block from "../../world/block/Block.js";
import CraftingRegistry from "../../crafting/CraftingRegistry.js";
import ItemStack from "../../item/ItemStack.js";

const BUTTON_LAYOUT = [
    {x:-144,y:29,w:26,h:24},{x:-119,y:29,w:26,h:24},{x:-94,y:29,w:26,h:24},{x:-69,y:29,w:26,h:24},{x:-44,y:29,w:26,h:24},
    {x:-144,y:53,w:26,h:24},{x:-119,y:53,w:26,h:24},{x:-94,y:53,w:26,h:24},{x:-69,y:53,w:26,h:24},{x:-44,y:53,w:26,h:24},
    {x:-144,y:77,w:26,h:24},{x:-119,y:77,w:26,h:24},{x:-94,y:77,w:26,h:24},{x:-69,y:77,w:26,h:24},{x:-44,y:77,w:26,h:24},
    {x:-144,y:101,w:26,h:24},{x:-119,y:101,w:26,h:24},{x:-94,y:101,w:26,h:24},{x:-69,y:101,w:26,h:24},{x:-44,y:101,w:26,h:24}
];

export default class GuiRecipeBook extends Gui {

    static unlocked = false;

    constructor(minecraft) {
        super(minecraft);

        this.textureToggle = null;
        this.textureBtn = null;
        this.textureBtnHover = null;
        this.textureGui = null;
        this.textureRecipeT = null;
        this.toggleX = 96;
        this.toggleY = 62;
        this.toggleW = 20;
        this.toggleH = 18;
        this.hoverIdx = -1;
        this.open = false;
        this.wasOpen = false;
        this.searchText = '';
        this.searchFocused = false;
        this.searchX = -130;
        this.searchY = 13;
        this.searchW = 82;
        this.searchH = 13;

        this.currentPage = 0;
        this.displayedRecipes = [];
    }

    init() {
        this.textureToggle = this.getTexture("gui/RecipeBook/RecipeBook.png");
        this.textureBtn = this.getTexture("gui/RecipeBook/RecipeF.png");
        this.textureRecipeT = this.getTexture("gui/RecipeBook/RecipeT.png");
        this.textureBtnHover = this.getTexture("gui/RecipeBook/RecipeBook1.png");
        this.textureGui = this.getTexture("gui/RecipeBook/RecipeBookGUI.png");
        this._rebuildDisplay();
    }

    _rebuildDisplay() {
        if (this.minecraft?.itemRenderer) {
            this.minecraft.itemRenderer.destroy("recipeBook");
        }
        const all = CraftingRegistry.recipes || [];
        const start = this.currentPage * 20;
        this.displayedRecipes = all.slice(start, start + 20);
    }

    _totalPages() {
        const all = CraftingRegistry.recipes || [];
        return Math.max(1, Math.ceil(all.length / 20));
    }

    _getGridInfo(container) {
        const ctor = container.constructor.name;
        if (ctor === 'ContainerSurvival' || ctor === 'ContainerPlayer') {
            return { inventory: this.minecraft.player.inventory, startIndex: 46, width: 2, height: 2 };
        }
        if (container.craftingInventory) {
            return { inventory: container.craftingInventory, startIndex: 0, width: 3, height: 3 };
        }
        return null;
    }

    _fitsInGrid(recipe, gridW, gridH) {
        if (recipe.constructor.name === 'ShapedCraftingRecipe') {
            return recipe.width <= gridW && recipe.height <= gridH;
        }
        return recipe.ingredients.length <= gridW * gridH;
    }

    _countItemInInv(inventory, typeId) {
        let count = 0;
        const len = inventory.items ? inventory.items.length : 0;
        for (let i = 0; i < len; i++) {
            const stack = inventory.getItemInSlot(i);
            if (stack && !stack.isEmpty() && stack.getType() === typeId) {
                count += stack.getCount();
            }
        }
        return count;
    }

    _canCraft(recipe) {
        const player = this.minecraft?.player;
        if (!player) return false;

        const counts = {};
        const ingredients = recipe.ingredients || [];
        for (const id of ingredients) {
            if (id === 0) continue;
            counts[id] = (counts[id] || 0) + 1;
        }

        const invs = [player.inventory];
        const screen = this.minecraft.currentScreen;
        if (screen && screen.container) {
            const gridInfo = this._getGridInfo(screen.container);
            if (gridInfo && gridInfo.inventory !== player.inventory) {
                invs.push(gridInfo.inventory);
            }
        }

        for (const [id, need] of Object.entries(counts)) {
            let have = 0;
            for (const inv of invs) {
                have += this._countItemInInv(inv, parseInt(id));
            }
            if (have < need) return false;
        }
        return true;
    }

    _fillWithRecipe(index, container) {
        const recipe = this.displayedRecipes[index];
        if (!recipe) return;

        const gridInfo = this._getGridInfo(container);
        if (!gridInfo) return;

        const { inventory: gridInv, startIndex, width: gridW, height: gridH } = gridInfo;
        const playerInv = this.minecraft.player.inventory;
        const itemRenderer = this.minecraft.itemRenderer;

        if (!this._fitsInGrid(recipe, gridW, gridH)) return;
        if (!this._canCraft(recipe)) return;

        for (let i = 0; i < gridW * gridH; i++) {
            const slot = startIndex + i;
            const item = gridInv.getItemInSlot(slot);
            if (item && !item.isEmpty()) {
                if (gridInv !== playerInv) {
                    playerInv.addItem(item.getType(), item.getCount());
                }
                gridInv.setItem(slot, new ItemStack(0, 0));
            }
        }

        const isShaped = recipe.constructor.name === 'ShapedCraftingRecipe';
        const targets = [];

        if (isShaped) {
            for (let ry = 0; ry < recipe.height; ry++) {
                for (let rx = 0; rx < recipe.width; rx++) {
                    const typeId = recipe.ingredients[ry * recipe.width + rx];
                    if (typeId !== 0) {
                        targets.push({ slot: startIndex + ry * gridW + rx, typeId });
                    }
                }
            }
        } else {
            let idx = 0;
            for (const typeId of recipe.ingredients) {
                if (typeId !== 0) {
                    targets.push({ slot: startIndex + idx, typeId });
                    idx++;
                }
            }
        }

        const ingredientCounts = {};
        for (const t of targets) {
            ingredientCounts[t.typeId] = (ingredientCounts[t.typeId] || 0) + 1;
        }

        for (const [typeId, count] of Object.entries(ingredientCounts)) {
            let remaining = count;
            for (let i = 0; i < 36 && remaining > 0; i++) {
                const stack = playerInv.getItemInSlot(i);
                if (stack && !stack.isEmpty() && stack.getType() === parseInt(typeId)) {
                    const toRemove = Math.min(stack.getCount(), remaining);
                    stack.shrink(toRemove);
                    remaining -= toRemove;
                }
            }
        }

        for (const t of targets) {
            gridInv.setItem(t.slot, new ItemStack(t.typeId, 1));
        }

        if (typeof container.refreshCraftingResult === 'function') {
            container.refreshCraftingResult();
        }
        container.dirty = true;

        if (itemRenderer) {
            itemRenderer.rebuildAllItems();
            itemRenderer.scheduleDirty("recipeBook");
        }
    }

    checkUnlock(inventory) {
        if (GuiRecipeBook.unlocked) return;
        if (!inventory || !inventory.items) return;
        for (let i = 0; i < inventory.items.length; i++) {
            if (inventory.items[i] && inventory.items[i].getType() === 17) {
                GuiRecipeBook.unlocked = true;
                return;
            }
        }
    }

    toggle() {
        if (!this.open && this.minecraft?.player) {
            this.checkUnlock(this.minecraft.player.inventory);
        }
        this.setOpen(!this.open);
    }

    setOpen(value) {
        if (this.open === value) return;
        this.open = value;
        if (this.open) {
            this.currentPage = 0;
            this._rebuildDisplay();
        } else {
            this.searchFocused = false;
            if (this.minecraft?.itemRenderer) {
                this.minecraft.itemRenderer.destroy("recipeBook");
            }
        }
    }

    isOpen() {
        return this.open;
    }

    draw(stack, containerX, containerY, mouseX, mouseY) {
        if (!this.textureToggle) return;

        const absTx = containerX + this.toggleX;
        const absTy = containerY + this.toggleY;

        if (this.open) {
            const itemRenderer = this.minecraft.itemRenderer;

            for (let i = 0; i < 20; i++) {
                const b = BUTTON_LAYOUT[i];
                const absX = containerX + b.x;
                const absY = containerY + b.y;
                const over = mouseX >= absX && mouseX < absX + b.w && mouseY >= absY && mouseY < absY + b.h;
                if (over) this.hoverIdx = i;

                const recipe = this.displayedRecipes[i];
                const craftable = recipe && this._canCraft(recipe);
                const btnTex = craftable ? this.textureRecipeT : this.textureBtn;
                this.drawSprite(stack, btnTex, 0, 0, 26, 25, absX, absY, b.w, b.h);

                if (recipe && itemRenderer) {
                    const block = Block.getById(recipe.resultTypeId);
                    if (block) {
                        itemRenderer.renderItemInGui("recipeBook", "btn_" + i, block, absX + 13, absY + 12);
                    }
                }
            }

            const sbAbsX = Math.floor(containerX + this.searchX);
            const sbAbsY = Math.floor(containerY + this.searchY);
            const padX = 3;
            const padY = 2;

            stack.fillStyle = '#000000';
            stack.fillRect(sbAbsX, sbAbsY, this.searchW, this.searchH);
            stack.strokeStyle = this.searchFocused ? '#ffffff' : '#888888';
            stack.lineWidth = 1;
            stack.strokeRect(sbAbsX + 0.5, sbAbsY + 0.5, this.searchW - 1, this.searchH - 1);

            if (this.searchFocused) {
                if (this.searchText) {
                    this.drawString(stack, this.searchText, sbAbsX + padX, sbAbsY + padY, 0xFFFFFF, false);
                }
            } else if (this.searchText) {
                this.drawString(stack, this.searchText, sbAbsX + padX, sbAbsY + padY, 0xFFFFFF, false);
            } else {
                this.drawString(stack, 'Search...', sbAbsX + padX, sbAbsY + padY, 0x888888, false);
            }

            const totalPages = this._totalPages();
            if (totalPages > 1) {
                this.drawString(stack, '<', containerX - 144, containerY + 128, 0x888888, false);
                this.drawString(stack, `Page ${this.currentPage + 1}/${totalPages}`, containerX - 130, containerY + 128, 0xFFFFFF, false);
                this.drawString(stack, '>', containerX - 52, containerY + 128, 0x888888, false);
            }
        }

        const overToggle = mouseX >= absTx && mouseX < absTx + this.toggleW && mouseY >= absTy && mouseY < absTy + this.toggleH;
        this.drawSprite(stack, overToggle ? this.textureBtnHover : this.textureToggle, 0, 0, this.textureToggle.naturalWidth, this.textureToggle.naturalHeight, absTx, absTy, this.toggleW, this.toggleH);
    }

    drawGui(stack, guiX, guiY) {
        if (!this.open || !this.textureGui) {
            if (this.wasOpen) {
                this.wasOpen = false;
            }
            return;
        }
        this.wasOpen = true;
        this.drawSprite(stack, this.textureGui, 0, 0, this.textureGui.naturalWidth, this.textureGui.naturalHeight, guiX, guiY, this.textureGui.naturalWidth, this.textureGui.naturalHeight);
    }

    isMouseOver(mouseX, mouseY, containerX, containerY) {
        const absTx = containerX + this.toggleX;
        const absTy = containerY + this.toggleY;
        if (mouseX >= absTx && mouseX < absTx + this.toggleW && mouseY >= absTy && mouseY < absTy + this.toggleH) return true;
        if (this.open) {
            for (const b of BUTTON_LAYOUT) {
                const absX = containerX + b.x;
                const absY = containerY + b.y;
                if (mouseX >= absX && mouseX < absX + b.w && mouseY >= absY && mouseY < absY + b.h) return true;
            }
            const sbAbsX = containerX + this.searchX;
            const sbAbsY = containerY + this.searchY;
            if (mouseX >= sbAbsX && mouseX < sbAbsX + this.searchW && mouseY >= sbAbsY && mouseY < sbAbsY + this.searchH) return true;

            const totalPages = this._totalPages();
            if (totalPages > 1) {
                if (mouseX >= containerX - 148 && mouseX < containerX - 136 && mouseY >= containerY + 126 && mouseY < containerY + 138) return true;
                if (mouseX >= containerX - 56 && mouseX < containerX - 44 && mouseY >= containerY + 126 && mouseY < containerY + 138) return true;
            }
        }
        return false;
    }

    getClickedIndex(mouseX, mouseY, containerX, containerY) {
        if (this.open) {
            for (let i = 0; i < BUTTON_LAYOUT.length; i++) {
                const b = BUTTON_LAYOUT[i];
                const absX = containerX + b.x;
                const absY = containerY + b.y;
                if (mouseX >= absX && mouseX < absX + b.w && mouseY >= absY && mouseY < absY + b.h) return i;
            }
        }
        return -1;
    }

    onClick(mouseX, mouseY, containerX, containerY) {
        const absTx = containerX + this.toggleX;
        const absTy = containerY + this.toggleY;
        if (mouseX >= absTx && mouseX < absTx + this.toggleW && mouseY >= absTy && mouseY < absTy + this.toggleH) {
            this.toggle();
            return true;
        }
        if (this.open) {
            const sbAbsX = containerX + this.searchX;
            const sbAbsY = containerY + this.searchY;
            if (mouseX >= sbAbsX && mouseX < sbAbsX + this.searchW && mouseY >= sbAbsY && mouseY < sbAbsY + this.searchH) {
                this.searchFocused = true;
                return true;
            }
            this.searchFocused = false;

            const totalPages = this._totalPages();
            if (totalPages > 1) {
                if (mouseX >= containerX - 148 && mouseX < containerX - 136 && mouseY >= containerY + 126 && mouseY < containerY + 138) {
                    if (this.currentPage > 0) {
                        this.currentPage--;
                        this._rebuildDisplay();
                    }
                    return true;
                }
                if (mouseX >= containerX - 56 && mouseX < containerX - 44 && mouseY >= containerY + 126 && mouseY < containerY + 138) {
                    if (this.currentPage < totalPages - 1) {
                        this.currentPage++;
                        this._rebuildDisplay();
                    }
                    return true;
                }
            }

            for (let i = 0; i < BUTTON_LAYOUT.length; i++) {
                const b = BUTTON_LAYOUT[i];
                const absX = containerX + b.x;
                const absY = containerY + b.y;
                if (mouseX >= absX && mouseX < absX + b.w && mouseY >= absY && mouseY < absY + b.h) {
                    const recipe = this.displayedRecipes[i];
                    if (recipe && this._canCraft(recipe)) {
                        const screen = this.minecraft.currentScreen;
                        if (screen && screen.container) {
                            this._fillWithRecipe(i, screen.container);
                        }
                    }
                    return true;
                }
            }
        }
        return false;
    }

    handleKey(key, character, containerX, containerY) {
        if (!this.searchFocused) return false;
        if (key === 'Escape') {
            this.searchFocused = false;
            return true;
        }
        if (key === 'Backspace') {
            this.searchText = this.searchText.slice(0, -1);
            return true;
        }
        if (key === 'Enter') {
            this.searchFocused = false;
            return true;
        }
        if (character && character.length === 1) {
            this.searchText += character;
            return true;
        }
        return false;
    }

}
