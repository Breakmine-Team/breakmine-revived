import * as THREE from "../../../../../../libraries/three.module.js";

/**
 * Vanilla's first person transform for a generated (sprite) item, in the 16
 * unit model space item models use: rotations in degrees, translation in
 * pixels where 16 px is one block.
 */
const DEFAULT_FIRST_PERSON = {
    rotation: [0, -90, 25],
    translation: [1.13, 3.2, 1.13],
    // Item sprites here fill their whole cell, unlike vanilla's tool models,
    // so a full vanilla 0.68 reads oversized; 0.5 is about a 0.5 block item,
    // which is what the hand showed before items became 3D.
    scale: [0.5, 0.5, 0.5]
};

/**
 * Position a held item model for the hand.
 *
 * @param {THREE.Object3D} group holder that becomes the item's parent
 * @param {string|null} tex item texture name, for models that special case it
 * @param {boolean} isBlock true when the held thing is a block, not a sprite
 * @param {boolean} firstPerson whether this is the first person hand
 * @param {object|null} override per item display block (rotation/translation/
 *   scale in degrees and model units); missing values fall back to the vanilla
 *   first person generated item transform
 * @returns {THREE.Object3D} the group, for chaining
 */
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
