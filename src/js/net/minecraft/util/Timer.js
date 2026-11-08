export default class Timer {

    static MS_PER_SECOND = 1000;
    static MAX_MS_PER_UPDATE = 1000;
    static MAX_TICKS_PER_UPDATE = 100;

    
    constructor(ticksPerSecond) {
        this.ticksPerSecond = ticksPerSecond;

        this.lastTime = Date.now();

        this.timeScale = 1.0;

        this.fps = 0.0;

        this.passedTime = 0.0;

        this.ticks = 0;

        this.partialTicks = 0;
    }


    
    advanceTime() {
        let now = Date.now();
        let passedMs = now - this.lastTime;

        this.lastTime = now;

        passedMs = Math.max(0, passedMs);
        passedMs = Math.min(Timer.MAX_MS_PER_UPDATE, passedMs);

        this.fps = Timer.MS_PER_SECOND / passedMs;

        this.passedTime += passedMs * this.timeScale * this.ticksPerSecond / Timer.MS_PER_SECOND;
        this.ticks = parseInt(this.passedTime);

        this.ticks = Math.min(Timer.MAX_TICKS_PER_UPDATE, this.ticks);

        this.passedTime -= this.ticks;
        this.partialTicks = this.passedTime;
    }
}