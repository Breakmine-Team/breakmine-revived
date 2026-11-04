import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEndIslandSampler } from '../end-islands.mjs';

test('End island density is repeatable for signed 64-bit seeds and independent of query order', () => {
    const a = createEndIslandSampler('-9223372036854775808');
    const b = createEndIslandSampler('-9223372036854775808');
    const points = [[0,0,0], [1024,64,-1024], [32000,80,26000], [-25000000,20,25000000]];
    const expected = points.map(point => a.outerIslands(...point));
    assert.deepEqual(points.map(point => b.outerIslands(...point)), expected);
    assert.deepEqual([...points].reverse().map(point => a.outerIslands(...point)).reverse(), expected);
});

test('End island sampler validates seeds and Java int coordinates', () => {
    assert.throws(() => createEndIslandSampler(9007199254740992), RangeError);
    assert.throws(() => createEndIslandSampler('9223372036854775808'), RangeError);
    assert.throws(() => createEndIslandSampler('not-a-seed'), TypeError);
    const sampler = createEndIslandSampler(0n);
    assert.throws(() => sampler.outerIslands(2147483648,0,0), RangeError);
    assert.throws(() => sampler.outerIslands(0,0,NaN), RangeError);
});
