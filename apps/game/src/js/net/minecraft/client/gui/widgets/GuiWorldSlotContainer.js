import GuiWorldSlot from "../widgets/GuiWorldSlot.js";
import GuiScreen from "../GuiScreen.js";
import fs from "../../fs/ServerFs.js";

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
                    iconPath: data.iconPath,
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

        // Scrollbar geometry
        this.scrollBarWidth = 6;
        this.scrollBarX = parentGui.width - this.scrollBarWidth - 2;
        this.scrollBarMinThumb = 12;

        // Scrollbar interaction state
        this.isDragging = false;
        this.dragOffsetY = 0;

        // Wheel: how many pixels per notch. Reduced for smoother scrolling.
        this.scrollStep = (this.slotHeight + this.slotSpacing) / 6;
    }

    setSelected(index) {
        this.selectedWorld = index;
        this.parentGui.setSelectedWorld(index);
    }

    // --- Scroll math -------------------------------------------------------

    getContentHeight() {
        // top padding (7) + slots with spacing + bottom padding (4)
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
            visible: max > 0
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

    // --- Rendering ---------------------------------------------------------

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.clampScroll();

        const listTop = this.top;
        const listBottom = this.bottom;
        const slotWidth = this.slotWidth;
        this.parentGui.drawBackground(stack, this.parentGui.getTexture("gui/background.png"), this.parentGui.width, this.parentGui.height);

        stack.save();

        stack.beginPath();
        stack.rect(0, listTop, this.parentGui.width, listBottom - listTop);
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
                // Ensure minecraft instance is set for rendering
                if (!slot.minecraft && this.parentGui.minecraft) {
                    slot.minecraft = this.parentGui.minecraft;
                }
                slot.render(stack, mouseX, mouseY, partialTicks);
            }
        }

        stack.restore();

        // Scrollbar is drawn OUTSIDE the list clip so it is never cut off
        this.drawScrollBar(stack, mouseX, mouseY);
    }

    drawScrollBar(stack, mouseX, mouseY) {
        const sb = this.getScrollBarBounds();
        if (!sb.visible) return;

        // Track background
        this.parentGui.drawRect(
            stack,
            sb.x, sb.trackTop,
            sb.x + sb.width, sb.trackBottom,
            "rgba(0, 0, 0, 0.4)"
        );

        // Thumb (highlight on hover or while dragging)
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
        this.parentGui.drawRect(stack, 0, top, this.parentGui.width, bottom, "rgba(0, 0, 0, 0.5)");
    }

    drawOverlayFades(stack, top, bottom) {
        const FADE_HEIGHT = 4;

        this.parentGui.drawGradientRect(stack, 0, top, this.parentGui.width, top + FADE_HEIGHT, "rgba(0, 0, 0, 0.0)", "rgba(0, 0, 0, 1.0)");
        this.parentGui.drawGradientRect(stack, 0, bottom - FADE_HEIGHT, this.parentGui.width, bottom, "rgba(0, 0, 0, 1.0)", "rgba(0, 0, 0, 0.0)");
    }

    // --- Hit testing -------------------------------------------------------

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

    // --- Mouse input -------------------------------------------------------

    mouseClicked(mouseX, mouseY, mouseButton) {
        // 1. Scrollbar hit-test first (cursor drag target)
        const sb = this.getScrollBarBounds();
        if (sb.visible &&
            mouseX >= sb.x && mouseX <= sb.x + sb.width &&
            mouseY >= sb.trackTop && mouseY <= sb.trackBottom) {

            if (mouseY < sb.y || mouseY > sb.y + sb.height) {
                // Click landed on the track (not the thumb): jump the thumb
                // so its center sits under the cursor, then drag from there.
                const targetThumbY = mouseY - sb.height / 2;
                this.setScrollFromThumbY(targetThumbY, sb);
                const newSb = this.getScrollBarBounds();
                this.dragOffsetY = mouseY - newSb.y;
            } else {
                // Click landed on the thumb: drag from its current position.
                this.dragOffsetY = mouseY - sb.y;
            }
            this.isDragging = true;
            return;
        }

        // 2. Slot hit-test
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

    // Mouse wheel support. `amount` is the wheel delta:
    //   positive => scroll up (content moves down, amountScrolled decreases)
    //   negative => scroll down (content moves up, amountScrolled increases)
    // Trackpads send smaller deltas than mouse wheels, so we use the actual value.
    mouseScrolled(mouseX, mouseY, amount) {
        // Only scroll when the cursor is over the list viewport
        // (includes the scrollbar column itself).
        if (mouseY < this.top || mouseY > this.bottom) return;

        if (amount === 0) return;

        // Use actual delta for trackpad support, but clamp to reasonable limits
        // More aggressive clamping for trackpad
        const delta = Math.max(Math.min(amount, 1), -1);
        this.amountScrolled += delta * this.scrollStep;
        this.clampScroll();
    }
}
