import GuiLoadingScreen from './GuiLoadingScreen.js';
import GuiScreen from '../GuiScreen.js';
import GuiButton from '../widgets/GuiButton.js';
import { VANILLITH_VERSION_LABEL } from '../../world/generator/VanillaWorldgenStatus.js';

export class GuiVanillaPreviewLoading extends GuiLoadingScreen {
    constructor(cancel) { super(); this.cancel = cancel; this.setTitle(`Starting ${VANILLITH_VERSION_LABEL}...`); }
    init() {
        super.init();
        this.buttonList.push(new GuiButton(this.minecraft, 'Cancel', this.width / 2 - 75, this.height / 2 + 40, 150, 20, this.cancel));
    }
    keyTyped(key) { if (key === 'Escape') this.cancel(); }
}

export class GuiVanillaPreviewError extends GuiScreen {
    constructor(parent, message) { super(); this.parent = parent; this.message = message; }
    init() {
        super.init();
        this.removeLogField();
        this.logField = document.createElement('textarea');
        this.logField.value = this.message;
        this.logField.readOnly = true;
        Object.assign(this.logField.style, {
            position: 'fixed', left: '50%', top: '47%', transform: 'translate(-50%, -50%)',
            width: 'min(84vw, 940px)', height: 'min(30vh, 220px)', boxSizing: 'border-box',
            resize: 'vertical', padding: '12px', color: '#eee', background: '#17120f',
            border: '1px solid #80664a', font: '13px/1.5 monospace', whiteSpace: 'pre-wrap',
            userSelect: 'text', zIndex: '10020', pointerEvents: 'auto'
        });
        document.body.appendChild(this.logField);
        this.logField.focus();
        this.logField.select();
        this.copyButton = new GuiButton(this.minecraft, 'Copy Error', this.width / 2 - 105, this.height - 35, 100, 20, async () => {
            try {
                await navigator.clipboard.writeText(this.message);
                this.copyButton.string = 'Copied';
            } catch {
                this.logField.focus();
                this.logField.select();
                document.execCommand('copy');
                this.copyButton.string = 'Selected — Ctrl+C';
            }
        });
        this.buttonList.push(this.copyButton);
        this.buttonList.push(new GuiButton(this.minecraft, 'Back', this.width / 2 + 5, this.height - 35, 100, 20, () => {
            this.minecraft.displayScreen(this.parent);
        }));
    }
    onClose() { this.removeLogField(); }
    removeLogField() {
        if (this.logField?.parentNode) this.logField.parentNode.removeChild(this.logField);
        this.logField = null;
    }
    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawCenteredString(stack, 'Vanillith Console — Terrain test failed', this.width / 2, 25, 0xff7777);
        this.drawCenteredString(stack, 'Error details are selected. Press Ctrl+C or use Copy Error.', this.width / 2, this.height / 2 + 78, 0xffcccccc);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
}
