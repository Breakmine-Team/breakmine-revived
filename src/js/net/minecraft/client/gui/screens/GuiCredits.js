import GuiScreen from "../GuiScreen.js";
import GuiMainMenu from "./GuiMainMenu.js";
import GuiButton from "../widgets/GuiButton.js";

export default class GuiCredits extends GuiScreen {

    constructor(previousScreen, pagesOrItems = null, options = {}) {
        super();
        this.pauseGame = true;
        this.previousScreen = previousScreen;

        this.pages = this._normalizePages(pagesOrItems || this._defaultPages());
        this.itemsPerPage = options.itemsPerPage !== undefined ? options.itemsPerPage : 12;
        this.pages = this._autoChunk(this.pages, this.itemsPerPage);
        this.currentPage = 0;
    }

    _defaultPages() {
        return [
            {
                title: "Credits",
                items: [
                    { name: "SpinningCubes", role: "Lead Developer & Designer" },
                    { name: "Blaise", role: "Developer" },
                    { name: "Paradoxism", role: "Developer" },
                    { name: "Marw-Programmer", role: "Developer" },
                    { name: "ItzzJustMateo", role: "Server Operator" },
                    { name: "Ulysses", role: "Early Tester & Designer" },
                    { name: "Sara", role: "Early Tester & Designer" },
                    { name: "Chloe", role: "Early Tester" },
                    { name: "Finley", role: "Early Tester" },
                    { name: "Aliah L.", role: "Tester & Designer" },
                    { name: "Faith", role: "Tester & Designer" },
                    { name: "Mason S.", role: "Tester" },
                    { name: "Archer", role: "Texture Artist & K. K. Slider" },
                    { name: "Soup", role: "Texture Artist & Early Tester" },
                    { name: "ewanhowell5195", role: "Texture Artist" },
                    { name: "Laby Studio", role: "js-minecraft base" },
                    { name: "Software Used", role: "&seperator" },
                    { name: "Vite", role: "Build System" },
                    { name: "Three JS", role: "Library" },
                    { name: "Long JS", role: "Library" },
                    { name: "AES JS", role: "Library" },
                    { name: "BigIntModArith", role: "Library" },
                    { name: "ASN1Parser", role: "Library" },
                    { name: "MCChatFormat", role: "Library" },
                    { name: "Pako", role: "Library" },
                    { name: "JSZip", role: "Library" },
                ]
            }
        ];
    }

    _normalizePages(input) {
        if (!Array.isArray(input) || input.length === 0) {
            return [{ title: "Credits", items: [] }];
        }
        const looksLikePage = (p) =>
            p && typeof p === "object" && Array.isArray(p.items);

        if (!looksLikePage(input[0])) {
            return [{ title: "Credits", items: input }];
        }
        return input;
    }

    _autoChunk(pages, itemsPerPage) {
        if (!itemsPerPage || itemsPerPage <= 0) return pages;

        const out = [];
        for (const page of pages) {
            const items = page.items || [];
            if (items.length <= itemsPerPage) {
                out.push(page);
                continue;
            }
            const chunkCount = Math.ceil(items.length / itemsPerPage);
            for (let i = 0; i < chunkCount; i++) {
                const slice = items.slice(i * itemsPerPage, (i + 1) * itemsPerPage);
                out.push({
                    title: page.title,
                    items: slice
                });
            }
        }
        return out;
    }

    init() {
        super.init();
        this._buildPage();
    }

    _buildPage() {
        this.buttonList = [];
        this.selectedButtonIndex = -1;

        const page = this.pages[this.currentPage];
        if (!page) return;

        const buttonWidth = 200;
        const startX = (this.width / 2) - (buttonWidth / 2);
        const startY = 70;
        const itemHeight = 14;

        const navY = startY + this.itemsPerPage * itemHeight + 10;
        const navButtonWidth = Math.floor((buttonWidth - 8) / 2);

        if (this.pages.length > 1) {
            const prevButton = new GuiButton(this.minecraft, "< Prev", startX, navY, navButtonWidth, 20, () => {
                this.currentPage--;
                this._buildPage();
                this.selectFirstEnabledButton();
            });
            prevButton.setEnabled(this.currentPage > 0);
            this.buttonList.push(prevButton);

            const nextButton = new GuiButton(this.minecraft, "Next >", startX + navButtonWidth + 8, navY, navButtonWidth, 20, () => {
                this.currentPage++;
                this._buildPage();
                this.selectFirstEnabledButton();
            });
            nextButton.setEnabled(this.currentPage < this.pages.length - 1);
            this.buttonList.push(nextButton);
        }

        const doneY = (this.pages.length > 1) ? navY + 26 : navY;
        this.buttonList.push(new GuiButton(this.minecraft, "Back", startX, doneY, buttonWidth, 20, () => {
            this.minecraft.displayScreen(new GuiMainMenu(this.minecraft));
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);

        const page = this.pages[this.currentPage];
        const title = (page && page.title) || "Credits";
        this.drawCenteredString(stack, title, this.width / 2, 20, 0xFFFFFF);

        if (this.pages.length > 1) {
            const pageIndicator = `${this.currentPage + 1}/${this.pages.length}`;
            this.drawCenteredString(stack, pageIndicator, this.width / 2, 32, 0xAAAAAA);
        }

        const startY = 70;
        const itemHeight = 14;
        const margin = 70;
        const leftEdge = margin;
        const rightEdge = this.width - margin;

        const items = (page && page.items) || [];
        for (let i = 0; i < items.length; i++) {
            const entry = items[i];
            const yPos = startY + (i * itemHeight);

            this.drawString(stack, entry.name, leftEdge, yPos, 0xFFFFFF);
            
            if (entry.role && entry.role.startsWith("&seperator")) {
                const lineY = yPos + 4;
                const nameWidth = this.getStringWidth(stack, entry.name);
                const lineStartX = leftEdge + nameWidth + 6;
                
                this.drawRect(stack, lineStartX, lineY, rightEdge, lineY + 1, "#6A6A6A");
                this.drawRect(stack, lineStartX + 1, lineY + 1, rightEdge + 1, lineY + 2, "#2A2A2A");
            } else {
                this.drawRightString(stack, entry.role, rightEdge, yPos, 0xAAAAAA);
            }
        }

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
}