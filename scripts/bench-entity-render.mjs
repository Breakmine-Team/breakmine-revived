import * as THREE from '../libraries/three.module.js';
import { createMobEntity } from '../src/js/net/minecraft/client/entity/MobEntity.js';
import MobRenderer from '../src/js/net/minecraft/client/render/entity/entity/MobRenderer.js';

// CPU render preparation only: 200 frames alternating between two light levels.
const samples = [];
let rebuilds = 0;
for (let sample = 0; sample < 5; sample++) {
    let brightness = 1;
    const mob = createMobEntity({ player: null }, { getLightBrightness: () => brightness }, 'zombie', { x: 0, y: 64, z: 0 });
    const renderer = new MobRenderer({ minecraft: { getThreeTexture: () => new THREE.Texture() } }, mob.entityType);
    mob.renderer = renderer;
    const rebuild = renderer.rebuild.bind(renderer);
    renderer.rebuild = entity => { rebuilds++; rebuild(entity); };
    for (let frame = 0; frame < 30; frame++) renderer.render(mob, .5);
    rebuilds = 0;
    const start = performance.now();
    for (let frame = 0; frame < 200; frame++) {
        brightness = frame % 2 ? .3 : 1;
        renderer.render(mob, .5);
    }
    samples.push(performance.now() - start);
    renderer.group.traverse(child => {
        if (!child.isMesh) return;
        child.geometry.dispose();
        child.material.dispose();
    });
    renderer.texture.dispose();
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ frames: 200, samplesMs: samples, medianMs: samples[2], geometryRebuilds: rebuilds }));
