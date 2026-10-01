import Sound from "./Sound.js";

export default class SoundGrass extends Sound {

    constructor(name, pitch) {
        super(name, pitch);
    }

    getBreakSound() {
        return "random." + this.name;
    }

    getStepSound() {
        return "step." + this.name;
    }
    
}