import GuiContainer from '../GuiContainer.js';
import ContainerStonecutter from '../../../inventory/container/ContainerStonecutter.js';
import Block from '../../../world/block/Block.js';

export default class GuiContainerStonecutter extends GuiContainer {
    constructor(player, position) {
        super(new ContainerStonecutter(player, position));
        this.inventoryWidth = 176;
        this.inventoryHeight = 166;
        this.row = 0;
        this.lastInputType = null;
        this.recipeSignature = '';
    }

    init() {
        this.textureInventory = this.getTexture('gui/container/stonecutter.png');
        this.sprites = Object.fromEntries(['recipe', 'recipe_highlighted', 'recipe_selected', 'scroller', 'scroller_disabled']
            .map(name => [name, this.getTexture(`gui/sprites/container/stonecutter/${name}.png`)]));
        super.init();
    }

    maxRow() { return Math.max(0, Math.ceil(this.container.recipes.length / 4) - 3); }

    changeRow(row) {
        this.row = Math.max(0, Math.min(this.maxRow(), row));
    }

    drawInventoryBackground(stack) {
        this.drawSprite(stack, this.textureInventory, 0, 0, 176, 166, this.x, this.y, 176, 166);
        const max = this.maxRow();
        const offset = max ? Math.round(41 * this.row / max) : 0;
        this.drawSprite(stack, this.sprites[max ? 'scroller' : 'scroller_disabled'], 0, 0, 12, 15, this.x + 119, this.y + 15 + offset, 12, 15);
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        if (this.lastInputType !== this.container.inputType) {
            this.lastInputType = this.container.inputType;
            this.row = 0;
        }
        const signature = `${this.lastInputType}:${this.row}`;
        if (this.recipeSignature !== signature) {
            this.minecraft.itemRenderer.destroy('stonecutter');
            this.recipeSignature = signature;
        }
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
        for (let i = 0; i < 12; i++) {
            const index = this.row * 4 + i;
            const recipe = this.container.recipes[index];
            if (!recipe) break;
            const x = this.x + 52 + (i % 4) * 16, y = this.y + 14 + Math.floor(i / 4) * 18;
            const hover = mouseX >= x && mouseX < x + 16 && mouseY >= y && mouseY < y + 18;
            const sprite = index === this.container.selected ? 'recipe_selected' : hover ? 'recipe_highlighted' : 'recipe';
            this.drawSprite(stack, this.sprites[sprite], 0, 0, 16, 18, x, y, 16, 18);
            const block = Block.getById(recipe.resultTypeId);
            if (block) this.minecraft.itemRenderer.renderItemInGui('stonecutter', `recipe:${i}`, block, x + 8, y + 9);
        }
        this.drawString(stack, 'Stonecutter', this.x + 8, this.y + 5, 0x404040, false);
    }

    mouseClicked(mouseX, mouseY, button) {
        if (button === 0) {
            const dx = mouseX - this.x - 52, dy = mouseY - this.y - 14;
            if (dx >= 0 && dx < 64 && dy >= 0 && dy < 54) {
                this.container.select(this.row * 4 + Math.floor(dy / 18) * 4 + Math.floor(dx / 16));
                return;
            }
            if (mouseX >= this.x + 119 && mouseX < this.x + 131 && mouseY >= this.y + 15 && mouseY < this.y + 70) {
                this.changeRow(Math.round((mouseY - this.y - 22) / 41 * this.maxRow()));
                return;
            }
        }
        super.mouseClicked(mouseX, mouseY, button);
    }

    onScroll(mouseX, mouseY, amount) { this.changeRow(this.row + Math.sign(amount)); }

    keyTyped(key, character) {
        if (key === this.minecraft.settings.keyOpenInventory) {
            this.minecraft.displayScreen(null);
            return true;
        }
        return super.keyTyped(key, character);
    }

    onClose() {
        const player = this.minecraft.player;
        const input = this.container.inventory.getItemInSlot(0);
        if (!input.isEmpty() && !input.damage && !Object.keys(input.enchantments ?? {}).length && player.inventory.addItem(input.getType(), input.getCount())) {
            this.container.inventory.setItem(0, 0);
        }
        const cursor = player.inventory.itemInCursor;
        super.onClose();
        player.inventory.itemInCursor = cursor;
        this.minecraft.itemRenderer.destroy('stonecutter');
    }
}
