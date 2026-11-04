export default class Tag {
    constructor(name) {
        this.name = name;
    }

    getName() {
        return this.name;
    }

    write(buffer) {

    }

    read(buffer) {

    }

    /**
     * Convert this tag to a plain-JS value (numbers/strings/arrays/objects)
     * so it survives JSON / structured-clone serialization.
     */
    toObject() {
        return this.getValue();
    }
}