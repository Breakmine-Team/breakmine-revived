export default class SwingState {

    constructor() {
        this.currentSwing = null;
        this.ticks = 0;
        this.oldAnimation = 0;
        this.animation = 0;
    }

    startIfAble(hand, animation, durationTicks) {
        if (this.currentSwing === null || this.ticks > this.currentSwing.durationTicks / 2 || this.ticks <= 0) {
            this.start(hand, animation, durationTicks);
            return true;
        }
        return false;
    }

    start(hand, animation, durationTicks) {
        const previous = this.currentSwing;
        this.currentSwing = { hand, animation, durationTicks };
        if (!previous || previous.hand !== hand
            || previous.durationTicks !== durationTicks
            || previous.animation.type !== animation.type
            || previous.animation.duration !== animation.duration) {
            this.oldAnimation = 0;
            this.animation = 0;
        }
        this.ticks = 0;
    }

    tick() {
        this.oldAnimation = this.animation;
        if (this.currentSwing !== null) {
            if (this.currentSwing.durationTicks > 0) {
                this.animation = Math.min(this.ticks / this.currentSwing.durationTicks, 1);
            }
            this.ticks++;
            if (this.ticks > this.currentSwing.durationTicks) {
                this.currentSwing = null;
                this.animation = 0;
            }
        } else {
            this.animation = 0;
        }
    }

    getAnimation(partialTicks) {
        const target = this.animation >= this.oldAnimation
            ? this.animation
            : this.animation + 1;
        return this.oldAnimation + (target - this.oldAnimation) * partialTicks;
    }

    isSwinging() {
        return this.currentSwing !== null;
    }
}
