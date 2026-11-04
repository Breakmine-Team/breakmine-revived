// Ported from reference SimpleReloadInstance.weightProgress/getActualProgress and
// LoadingOverlay.extractRenderState/tick (verified against the local JAR).
const clamp = value => Math.max(0, Math.min(1, value));
const f = Math.fround;

export function smoothLoadingProgress(current, actual) {
    return clamp(f(f(f(current) * f(.95)) + f(f(actual) * f(.050000012))));
}

export class ReloadProgress {
    constructor(prepareTasks, applyTasks, listeners) {
        this.prepareTotal = prepareTasks;
        this.applyTotal = applyTasks;
        this.listeners = new Set(listeners);
        this.listenerTotal = this.listeners.size;
        this.prepared = 0;
        this.applied = 0;
        this.error = null;
    }

    finishPrepare() { this.prepared++; }
    finishApply() { this.applied++; }
    addApplyTasks(count) { this.applyTotal += count; }
    finishListener(name) { this.listeners.delete(name); }

    getActualProgress() {
        const done = this.prepared * 2 + this.applied * 2 + this.listenerTotal - this.listeners.size;
        const total = this.prepareTotal * 2 + this.applyTotal * 2 + this.listenerTotal;
        return total ? clamp(f(f(done) / f(total))) : 1;
    }

    isDone() {
        return !this.error && this.prepared === this.prepareTotal
            && this.applied === this.applyTotal && this.listeners.size === 0;
    }
}

export class LoadingOverlayState {
    constructor(reload, { fadeIn = false } = {}) {
        this.reload = reload;
        this.fadeIn = fadeIn;
        this.currentProgress = 0;
        this.fadeInStart = -1;
        this.fadeOutStart = -1;
    }

    frame(now) {
        if (this.fadeIn && this.fadeInStart === -1) this.fadeInStart = now;
        if (this.fadeOutStart === -1 && this.reload.isDone()
            && (!this.fadeIn || now - this.fadeInStart >= 1000)) this.fadeOutStart = now;
        this.currentProgress = smoothLoadingProgress(this.currentProgress, this.reload.getActualProgress());
        const out = this.fadeOutStart === -1 ? -1 : (now - this.fadeOutStart) / 1000;
        const incoming = this.fadeIn ? clamp((now - this.fadeInStart) / 500) : 1;
        return {
            progress: this.currentProgress,
            opacity: out >= 1 ? 1 - clamp(out - 1) : incoming,
            barOpacity: out < 1 ? (1 - clamp(out)) * incoming : 0,
            removed: out >= 2
        };
    }
}

export function loadingBarFillWidth(width, progress) {
    // JAR fills [left + 2, left + ceil((width - 2) * progress)].
    return Math.max(0, Math.ceil(f(f(width - 2) * f(progress))) - 2);
}

export function loadingBarBounds(width, height) {
    const half = Math.floor(Math.min(width * .75, height) * .5);
    const center = Math.floor(width / 2);
    return { left: center - half, top: Math.floor(height * .8325) - 5, width: half * 2, height: 10 };
}
