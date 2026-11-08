import * as THREE from "../../../../../../libraries/three.module.js";

const DEFAULT_FIRST_PERSON = {
    rotation: [0, -90, 25],
    translation: [1.13, 3.2, 1.13],
    scale: [0.5, 0.5, 0.5]
};

export function applyHeldItemDisplay(group, tex, isBlock, firstPerson, override) {
    const display = firstPerson ? (override || DEFAULT_FIRST_PERSON) : DEFAULT_FIRST_PERSON;

    const rotation = display.rotation || DEFAULT_FIRST_PERSON.rotation;
    const translation = display.translation || DEFAULT_FIRST_PERSON.translation;
    const scale = display.scale || DEFAULT_FIRST_PERSON.scale;

    group.rotation.set(
        THREE.MathUtils.degToRad(rotation[0] || 0),
        THREE.MathUtils.degToRad(rotation[1] || 0),
        THREE.MathUtils.degToRad(rotation[2] || 0)
    );
    group.position.set(translation[0] || 0, translation[1] || 0, translation[2] || 0);
    group.scale.set(scale[0] === undefined ? 1 : scale[0],
        scale[1] === undefined ? 1 : scale[1],
        scale[2] === undefined ? 1 : scale[2]);

    return group;
}
