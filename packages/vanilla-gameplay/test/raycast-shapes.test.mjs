import test from 'node:test';
import assert from 'node:assert/strict';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import BoundingBox from '../../../src/js/net/minecraft/util/BoundingBox.js';
import Vector3 from '../../../src/js/net/minecraft/util/Vector3.js';

test('block ray tracing respects partial local bounds instead of the full cube', () => {
    const block = new Block(65000);
    block.getBoundingBox = () => new BoundingBox(0, 0, 0, 1, 0.5, 1);

    const hit = block.collisionRayTrace(null, 4, 10, -2,
        new Vector3(4.5, 11, -1.5), new Vector3(4.5, 9, -1.5));
    assert.ok(hit);
    assert.equal(hit.vector.y, 10.5);

    const miss = block.collisionRayTrace(null, 4, 10, -2,
        new Vector3(4.5, 10.9, -1.5), new Vector3(4.5, 10.7, -1.5));
    assert.equal(miss, null);
});

test('multipart ray tracing accepts wrapped boxes and does not fall back to a cube', () => {
    const block = new Block(65001);
    block.multipart = true;
    block.getMultipart = () => [["block", 1, { bbox: new BoundingBox(0, 0, 0, 0.25, 1, 1) }]];

    const miss = block.collisionRayTrace(null, 0, 0, 0,
        new Vector3(0.75, 0.5, -1), new Vector3(0.75, 0.5, 2));
    assert.equal(miss, null);

    const hit = block.collisionRayTrace(null, 0, 0, 0,
        new Vector3(-1, 0.5, 0.5), new Vector3(1, 0.5, 0.5));
    assert.ok(hit);
});
