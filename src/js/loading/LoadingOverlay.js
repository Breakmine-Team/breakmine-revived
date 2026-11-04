import { LoadingOverlayState, loadingBarFillWidth, loadingBarBounds } from './LoadingProgress.mjs';

export const startupLoading = {
    attach(reload) {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        const bar = overlay.querySelector('.loading-progress');
        const fill = overlay.querySelector('.loading-progress-fill');
        const state = new LoadingOverlayState(reload);
        let width;
        const resize = (w, h) => {
            const bounds = loadingBarBounds(w, h);
            width = bounds.width;
            bar.style.left = `${bounds.left}px`;
            bar.style.top = `${bounds.top}px`;
            bar.style.width = `${width}px`;
            bar.style.transform = 'none';
        };
        resize(overlay.clientWidth, overlay.clientHeight);
        const observer = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            resize(width, height);
        });
        observer.observe(overlay);
        const draw = now => {
            const frame = state.frame(now);
            if (frame.removed) {
                observer.disconnect();
                overlay.remove();
                return;
            }
            overlay.style.opacity = String(frame.opacity);
            bar.style.opacity = String(frame.barOpacity);
            bar.setAttribute('aria-valuenow', String(Math.round(reload.getActualProgress() * 100)));
            fill.style.transform = `scaleX(${loadingBarFillWidth(width, frame.progress) / Math.max(1, width - 4)})`;
            if (reload.error) {
                observer.disconnect();
                overlay.setAttribute('aria-label', 'Game startup failed');
                const message = document.createElement('p');
                message.className = 'loading-error';
                message.textContent = `Loading failed: ${reload.error.message}`;
                overlay.append(message);
                return;
            }
            requestAnimationFrame(draw);
        };
        requestAnimationFrame(draw);
    }
};
