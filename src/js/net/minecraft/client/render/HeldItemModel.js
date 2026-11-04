import * as THREE from '../../../../../../libraries/three.module.js';
import ModelRenderer from './model/renderer/ModelRenderer.js';
import Tessellator from './Tessellator.js';

// Pinned JAR item display transforms, in model pixels. The shared hand layer
// supplies its own rotation/offset before these transforms.
export function applyHeldItemDisplay(group, name, throwing = false, firstPerson = false, nativeTransform = null) {
    let rotation, translation, scale;
    if (name === 'trident') {
        rotation = firstPerson ? [0, -90, 25] : throwing ? [0, 90, 180] : [0, 60, 0];
        translation = firstPerson ? [-3, 17, 1] : throwing ? [8, -17, 9] : [11, 17, -2];
        scale = 1;
    } else if (name === 'bow' && !firstPerson) {
        rotation = [-80, 260, -40]; translation = [-1, -2, 2.5]; scale = .9;
    } else if (firstPerson) {
        rotation = [0, -90, 25]; translation = [1.13, 3.2, 1.13]; scale = .68;
    } else {
        rotation = [0, -90, 55]; translation = [0, 4, .5]; scale = .85;
    }
    if (nativeTransform) {
        rotation = nativeTransform.rotation ?? [0, 0, 0];
        translation = nativeTransform.translation ?? [0, 0, 0];
        group.scale.set(...(nativeTransform.scale ?? [1, 1, 1]));
    } else group.scale.setScalar(scale);
    group.position.set(...translation);
    group.rotation.set(...rotation.map(value => value * Math.PI / 180), 'XYZ');
}

export function createHandLayer(parent) {
    const rotation = new THREE.Group();
    rotation.name = 'itemInHandLayerRotation';
    rotation.rotation.set(-Math.PI / 2, Math.PI, 0, 'XYZ');
    const offset = new THREE.Group();
    offset.position.set(1, 2, -10);
    const display = new THREE.Group();
    display.name = 'thirdperson_righthand';
    rotation.add(offset); offset.add(display); parent.add(rotation);
    return display;
}

// Used by both player BlockRenderer and MobRenderer, so equipment cannot drift
// into two independent transform implementations. Generated sprites are
// already centered; special models retain ItemTransform's -0.5 block offset.
export function attachHeldItemModel(parent, model, name) {
    const display = createHandLayer(parent);
    applyHeldItemDisplay(display, name);
    if (name !== 'trident') model.scale.setScalar(16);
    display.add(model);
    model.traverse(mesh => {
        if (mesh.isMesh) mesh.userData.dynamicHeldItemLight = true;
    });
    return display;
}

export function createTridentModel(texture, { held = true } = {}) {
    // TridentModel.createLayer: 32x32 UVs; special renderer flips Y/Z.
    const root = new THREE.Group();
    const tessellator = new Tessellator();
    tessellator.bindTexture(texture);
    tessellator.setColor(1, 1, 1);
    tessellator.material.transparent = false;
    tessellator.material.alphaTest = .1;
    const parts = [
        ['pole', 0, 6, -.5, 2, -.5, 1, 25, 1],
        ['base', 4, 0, -1.5, 0, -.5, 3, 2, 1],
        ['left_spike', 4, 3, -2.5, -3, -.5, 1, 4, 1],
        ['middle_spike', 0, 0, -.5, -4, -.5, 1, 4, 1],
        ['right_spike', 4, 3, 1.5, -3, -.5, 1, 4, 1]
    ];
    for (const [name, u, v, ...box] of parts) {
        new ModelRenderer(name, 32, 32).setTextureOffset(u, v)
            .addBox(...box, 0, name === 'right_spike').rebuild(tessellator, root);
    }
    tessellator.material.dispose();
    // ItemTransform.apply translates -0.5 on all axes before the special
    // model's local transform (1,-1,-1). Unlike generated items, this model
    // isn't authored in a centered [-0.5,0.5] cube.
    if (held) {
        root.position.set(-8, -8, -8);
        root.scale.set(1, -1, -1);
    } else root.scale.setScalar(1 / 16);
    return root;
}
