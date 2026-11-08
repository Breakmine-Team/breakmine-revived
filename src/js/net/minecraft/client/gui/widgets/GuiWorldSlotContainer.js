import GuiWorldSlot from "../widgets/GuiWorldSlot.js";
import GuiScreen from "../GuiScreen.js";

export default class GuiWorldSlotContainer extends GuiScreen {

    constructor(parentGui, listContent) {
        super(parentGui.minecraft);
        this.parentGui = parentGui;
        this.selectedWorld = -1;

        this.slotList = listContent.map((data, index) =>
            new GuiWorldSlot(
                {
                    name: data.name || 'Unknown World',
                    date: data.lastPlayed ? new Date(data.lastPlayed).toLocaleDateString() : '',
                    details: (data.worldType || 'normal') + ' - ' + (data.gameMode || 'survival'),
                    icon: data.icon,
                },
                parentGui.width / 2 - 110,
                0,
                220,
                36,
                () => {
                    this.setSelected(index);
                },
                parentGui.minecraft
            )
        );

        this.slotHeight = 36;
        this.slotSpacing = 2;
        this.slotX = parentGui.width / 2 - 110;
        this.slotWidth = 220;
        this.top = 32;
        this.bottom = parentGui.height - 64;
        this.amountScrolled = 0;

        this.viewLeft = 0;
        this.viewRight = parentGui.width;
        this.drawBackgroundTexture = true;
        this.alwaysShowScrollBar = false;

        this.scrollBarWidth = 6;
        this.scrollBarX = parentGui.width - this.scrollBarWidth - 2;
        this.scrollBarMinThumb = 12;

        this.isDragging = false;
        this.dragOffsetY = 0;

        this.scrollStep = (this.slotHeight + this.slotSpacing) / 6;
    }

    setSelected(index) {
        this.selectedWorld = index;
        this.parentGui.setSelectedWorld(index);
    }


    getContentHeight() {
        return this.slotList.length * (this.slotHeight + this.slotSpacing) + 11;
    }

    getMaxScroll() {
        const viewport = this.bottom - this.top;
        const content = this.getContentHeight();
        return Math.max(0, content - viewport);
    }

    clampScroll() {
        const max = this.getMaxScroll();
        if (this.amountScrolled < 0) this.amountScrolled = 0;
        if (this.amountScrolled > max) this.amountScrolled = max;
    }

    getScrollBarBounds() {
        const trackTop = this.top;
        const trackBottom = this.bottom;
        const trackHeight = trackBottom - trackTop;
        const contentHeight = this.getContentHeight();
        const max = this.getMaxScroll();

        let thumbHeight;
        if (contentHeight <= trackHeight || trackHeight <= 0) {
            thumbHeight = trackHeight;
        } else {
            thumbHeight = Math.max(
                this.scrollBarMinThumb,
                Math.floor(trackHeight * trackHeight / contentHeight)
            );
            if (thumbHeight > trackHeight) thumbHeight = trackHeight;
        }

        let thumbY;
        if (max <= 0) {
            thumbY = trackTop;
        } else {
            const usable = trackHeight - thumbHeight;
            thumbY = trackTop + Math.floor((this.amountScrolled / max) * usable);
        }

        return {
            x: this.scrollBarX,
            y: thumbY,
            width: this.scrollBarWidth,
            height: thumbHeight,
            trackTop,
            trackBottom,
            trackHeight,
            visible: max > 0 || this.alwaysShowScrollBar
        };
    }

    setScrollFromThumbY(thumbY, sb) {
        const usable = sb.trackHeight - sb.height;
        if (usable <= 0) {
            this.amountScrolled = 0;
            return;
        }
        const relativeY = thumbY - sb.trackTop;
        const ratio = Math.max(0, Math.min(1, relativeY / usable));
        this.amountScrolled = ratio * this.getMaxScroll();
    }


    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.clampScroll();

        const listTop = this.top;
        const listBottom = this.bottom;
        const slotWidth = this.slotWidth;
        if (this.drawBackgroundTexture) {
            this.parentGui.drawBackground(stack, this.parentGui.getTexture("gui/background.png"), this.parentGui.width, this.parentGui.height);
        }

        stack.save();

        stack.beginPath();
        stack.rect(this.viewLeft, listTop, this.viewRight - this.viewLeft, listBottom - listTop);
        stack.clip();

        let currentY = listTop + 7 - this.amountScrolled;

        this.drawBackgroundPart(stack, this.top, this.bottom);

        for (let i = 0; i < this.slotList.length; i++) {
            const slot = this.slotList[i];
            const slotHeight = this.slotHeight;
            const slotTop = currentY + (i * (slotHeight + this.slotSpacing));
            const slotBottom = slotTop + slotHeight;
            const slotLeft = this.slotX;
            const slotRight = slotLeft + slotWidth;

            if (slotBottom >= listTop && slotTop <= listBottom) {
                if (i === this.selectedWorld) {
                    this.parentGui.drawRect(stack, slotLeft - 1, slotTop - 3, slotRight + 1, slotBottom - 1, "rgb(153, 153, 153)");
                    this.parentGui.drawRect(stack, slotLeft, slotTop - 2, slotRight, slotBottom - 2, "rgba(0, 0, 0)");
                }

                slot.x = slotLeft;
                slot.y = slotTop;
                slot.width = slotWidth;
                slot.height = slotHeight;
                if (!slot.minecraft && this.parentGui.minecraft) {
                    slot.minecraft = this.parentGui.minecraft;
                }
                slot.render(stack, mouseX, mouseY, partialTicks);
            }
        }

        this.drawOverlayFades(stack, listTop, listBottom);

        stack.restore();

        this.drawScrollBar(stack, mouseX, mouseY);
    }

    drawScrollBar(stack, mouseX, mouseY) {
        const sb = this.getScrollBarBounds();
        if (!sb.visible) return;

        this.parentGui.drawRect(
            stack,
            sb.x, sb.trackTop,
            sb.x + sb.width, sb.trackBottom,
            "rgba(0, 0, 0, 0.4)"
        );

        if (this.getMaxScroll() <= 0) {
            this.parentGui.drawRect(
                stack,
                sb.x, sb.y,
                sb.x + sb.width, sb.y + sb.height,
                "rgba(110, 110, 110, 0.55)"
            );
            return;
        }

        const isHover =
            mouseX >= sb.x && mouseX <= sb.x + sb.width &&
            mouseY >= sb.y && mouseY <= sb.y + sb.height;
        const isActive = isHover || this.isDragging;
        const thumbColor = isActive ? "rgb(210, 210, 210)" : "rgb(150, 150, 150)";
        this.parentGui.drawRect(
            stack,
            sb.x, sb.y,
            sb.x + sb.width, sb.y + sb.height,
            thumbColor
        );
    }

    drawBackgroundPart(stack, top, bottom) {
        this.parentGui.drawRect(stack, this.viewLeft, top, this.viewRight, bottom, "rgba(0, 0, 0, 0.5)");
    }

    
    drawOverlayFades(stack, top, bottom) {
        this.drawEdgeFades(stack, this.viewLeft, this.viewRight, top, bottom);
    }


    getSlotIndexAt(mouseX, mouseY) {
        if (mouseY < this.top || mouseY > this.bottom) return -1;
        const slotLeft = this.slotX;
        const slotWidth = this.slotWidth;
        if (mouseX < slotLeft || mouseX > slotLeft + slotWidth) return -1;

        const startY = this.top + 7 - this.amountScrolled;
        for (let i = 0; i < this.slotList.length; i++) {
            const slotTop = startY + (i * (this.slotHeight + this.slotSpacing));
            const slotBottom = slotTop + this.slotHeight;
            if (mouseY >= slotTop && mouseY <= slotBottom) {
                return i;
            }
        }
        return -1;
    }


    mouseClicked(mouseX, mouseY, mouseButton) {
        const sb = this.getScrollBarBounds();
        if (sb.visible &&
            mouseX >= sb.x && mouseX <= sb.x + sb.width &&
            mouseY >= sb.trackTop && mouseY <= sb.trackBottom) {

            if (mouseY < sb.y || mouseY > sb.y + sb.height) {
                const targetThumbY = mouseY - sb.height / 2;
                this.setScrollFromThumbY(targetThumbY, sb);
                const newSb = this.getScrollBarBounds();
                this.dragOffsetY = mouseY - newSb.y;
            } else {
                this.dragOffsetY = mouseY - sb.y;
            }
            this.isDragging = true;
            return;
        }

        if (mouseY >= this.top && mouseY <= this.bottom) {
            const clickedIndex = this.getSlotIndexAt(mouseX, mouseY);
            if (clickedIndex >= 0 && clickedIndex < this.slotList.length) {
                this.setSelected(clickedIndex);
            }
        }
    }

    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.isDragging) {
            const sb = this.getScrollBarBounds();
            const targetThumbY = mouseY - this.dragOffsetY;
            this.setScrollFromThumbY(targetThumbY, sb);
        }
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        this.isDragging = false;
        this.dragOffsetY = 0;
    }

    mouseScrolled(mouseX, mouseY, amount) {
        if (mouseY < this.top || mouseY > this.bottom) return;

        if (amount === 0) return;

        const delta = Math.max(Math.min(amount, 1), -1);
        this.amountScrolled += delta * this.scrollStep;
        this.clampScroll();
    }
}
