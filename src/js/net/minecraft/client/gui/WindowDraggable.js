const SHELF_ITEM_WIDTH = 150; 
const SHELF_PADDING = 5;

const minimizedWindows = []; 

class DraggableWindow {
    windowEl;
    dragHandleEl;
    offsetX = 0;
    offsetY = 0;
    lastX; 
    lastY; 
    isMinimized = false; 

    static maxZIndex = 1000;

    /**
         * @param {HTMLElement} windowElement - The main window element to make draggable.
         * @param {HTMLElement} dragHandleElement - The element used as the drag handle.
         * @param {number} startX - Initial X position.
         * @param {number} startY - Initial Y position.
         */
    constructor(windowElement, dragHandleElement, startX, startY) {
        this.windowEl = windowElement;
        this.dragHandleEl = dragHandleElement;
        this.lastX = startX;
        this.lastY = startY;

        if (this.windowEl.style.position !== 'absolute') {
            this.windowEl.style.position = 'absolute';
        }

        this.windowEl.style.left = `${startX}px`;
        this.windowEl.style.top = `${startY}px`;

        this.activateWindow();

        this.dragHandleEl.addEventListener('mousedown', this.dragStart.bind(this));
        this.dragHandleEl.addEventListener('touchstart', this.dragStart.bind(this), { passive: false });
        this.windowEl.addEventListener('mousedown', this.activateWindow.bind(this));
        this.windowEl.addEventListener('touchstart', this.activateWindow.bind(this), { passive: true });
    }

    getCoords(event) {
        if (event.touches) {
            if (event.touches.length > 0) {
                return { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
            }
            return null;
        }
        return { clientX: event.clientX, clientY: event.clientY };
    }

    activateWindow() {
        if (this.isMinimized) {
            this.restoreWindow();
            return;
        }

        DraggableWindow.maxZIndex += 1;
        this.windowEl.style.zIndex = DraggableWindow.maxZIndex.toString();

        this.windowEl.classList.add('active-window');

        document.querySelectorAll('.window').forEach(win => {
            if (win !== this.windowEl) {
                win.classList.remove('active-window');
            }
        });
    }

    dragStart(event) {
        if (this.isMinimized) {
            this.restoreWindow();
            return;
        }

        const coords = this.getCoords(event);
        if (!coords) return;

        if (event.type === 'touchstart') {
            event.preventDefault();
        }

        this.activateWindow();

        // Calculate the offset from the mouse pointer to the top-left corner of the window
        const rect = this.windowEl.getBoundingClientRect();
        const containerRect = this.windowEl.parentElement.getBoundingClientRect();

        this.offsetX = coords.clientX - rect.left + containerRect.left;
        this.offsetY = coords.clientY - rect.top + containerRect.top;

        document.addEventListener('mousemove', this.dragMoveGlobal);
        document.addEventListener('mouseup', this.dragEndGlobal);
        document.addEventListener('touchmove', this.dragMoveGlobal, { passive: false });
        document.addEventListener('touchend', this.dragEndGlobal);
    }

    dragMove(event) {
        const coords = this.getCoords(event);
        if (!coords) return;

        if (event.type === 'touchmove') {
            event.preventDefault();
        }

        const container = this.windowEl.parentElement;
        const containerRect = container.getBoundingClientRect();
        const windowRect = this.windowEl.getBoundingClientRect();

        let newX = coords.clientX - this.offsetX - containerRect.left;
        let newY = coords.clientY - this.offsetY - containerRect.top;

        // Store the position while moving
        this.lastX = newX = Math.max(0, newX); 
        this.lastY = newY = Math.max(0, newY); 

        this.lastX = newX = Math.min(newX, containerRect.width - windowRect.width);
        this.lastY = newY = Math.min(newY, containerRect.height - windowRect.height);

        this.windowEl.style.left = `${newX}px`;
        this.windowEl.style.top = `${newY}px`;
    }

    dragEnd() {
        document.removeEventListener('mousemove', this.dragMoveGlobal);
        document.removeEventListener('mouseup', this.dragEndGlobal);
        document.removeEventListener('touchmove', this.dragMoveGlobal);
        document.removeEventListener('touchend', this.dragEndGlobal);
    }

    minimizeWindow() {
        if (this.isMinimized) return;

        // 1. Store the active position before minimizing
        this.lastX = parseInt(this.windowEl.style.left, 10);
        this.lastY = parseInt(this.windowEl.style.top, 10);

        // 2. Add to shelf array
        minimizedWindows.push(this);

        // 3. Update all shelf positions and set state
        minimizedWindows.forEach(w => w.updateShelfPosition());

        this.windowEl.classList.add('minimized');
        this.windowEl.classList.remove('active-window');
        this.isMinimized = true;
    }

    restoreWindow() {
        if (!this.isMinimized) return;

        // 1. Remove from shelf array and update others
        const index = minimizedWindows.indexOf(this);
        if (index > -1) {
            minimizedWindows.splice(index, 1);
        }
        minimizedWindows.forEach(w => w.updateShelfPosition());

        // 2. Restore class and position
        this.windowEl.classList.remove('minimized');
        this.windowEl.style.left = `${this.lastX}px`;
        this.windowEl.style.top = `${this.lastY}px`;
        this.isMinimized = false;

        // 3. Bring to front
        this.activateWindow(); 
    }

    updateShelfPosition() {
        if (!this.isMinimized) return;
        const index = minimizedWindows.indexOf(this);
        if (index === -1) return;

        // Position relative to the screen (fixed)
        const newX = 10 + index * (SHELF_ITEM_WIDTH + SHELF_PADDING); 

        this.windowEl.style.width = `${SHELF_ITEM_WIDTH}px`;
        this.windowEl.style.left = `${newX}px`;
        // The bottom property is set in the CSS .window.minimized style
    }

    closeWindow() {
        if (this.isMinimized) {
            const index = minimizedWindows.indexOf(this);
            if (index > -1) {
                minimizedWindows.splice(index, 1);
                minimizedWindows.forEach(w => w.updateShelfPosition());
            }
        }
        this.windowEl.remove();
    }

    // Global listeners bound to 'this'
    dragMoveGlobal = this.dragMove.bind(this);
    dragEndGlobal = this.dragEnd.bind(this);

    static create({ title, content, startX = 50, startY = 50, container, allowClose, onScroll }) {
        const windowId = `window-${Date.now()}-${Math.floor(Math.random() * 100)}`;

        let windowHtml = `<div class="window" id="${windowId}" style="width: 700px">
                <div class="title-bar">
                    <div class="title-bar-text">${title}</div>
                    <div class="title-bar-controls"></div>
                </div>
                <div class="window-body">
                    <p>${content}</p>
                </div>
            </div>`;

        if (allowClose === true) {
            windowHtml = `<div class="window" id="${windowId}" style="width: 450px">
                <div class="title-bar">
                    <div class="title-bar-text">${title}</div>
                    <div class="title-bar-controls">
                        <button class="close" aria-label="Close"></button>
                    </div>
                </div>
                <div class="window-body">
                    <p>${content}</p>
                </div>
            </div>`;
        }

        container.insertAdjacentHTML('beforeend', windowHtml);

        const windowEl = document.getElementById(windowId);
        const dragHandleEl = windowEl.querySelector('.title-bar');

        const instance = new DraggableWindow(windowEl, dragHandleEl, startX, startY);

        // Add scrollwheel support
        if (onScroll && typeof onScroll === 'function') {
            windowEl.addEventListener('wheel', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const delta = Math.sign(event.deltaY);
                const rect = windowEl.getBoundingClientRect();
                const mouseX = event.clientX - rect.left;
                const mouseY = event.clientY - rect.top;
                onScroll(mouseX, mouseY, delta);
            }, { passive: false });
        }

        windowEl.querySelectorAll('.title-bar-controls').forEach(parent => {
            Array.from(parent.children).forEach(btn => {
                console.log(btn);
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    instance.closeWindow();
                });
            });
        });
        
        return instance;
    }
}


// Logger

export function createWindow(name, content2, style = "padding: 4px;", allowClose = false, onScroll = null) {
    const content = `
            <div style="${style}">
                ${content2}
            </div>
        `;

    DraggableWindow.create({
        title: name,
        content: content,
        startX: 0,
        startY: 0,
        container: document.body,
        allowClose: allowClose,
        onScroll: onScroll
    });
}

export function createErrorWindow(errorshort, msg, allowClose = false, onScroll = null) {
    createWindow(`${errorshort}`, `<span style="color: black; font-family: sans-serif; max-width: 500px;">${msg}</span>`, "padding: 0px;", allowClose, onScroll);
}

//createErrorWindow("SyntaxError", "");