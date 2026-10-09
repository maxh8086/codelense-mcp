import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDepth } from '../../src/tools.js';

test('chooseDepth: narrows to the deepest depth under the limit when depth 3 is over budget', async () => {
  const sizes = { 3: 80_000, 2: 40_000, 1: 10_000 };
  const probed = [];
  const depth = await chooseDepth(3, 50_000, async (d) => { probed.push(d); return sizes[d]; });
  assert.equal(depth, 2);
  assert.deepEqual(probed, [3, 2]);
});

test('chooseDepth: keeps the requested depth when it already fits', async () => {
  assert.equal(await chooseDepth(3, 50_000, async () => 10_000), 3);
});

test('chooseDepth: falls back to depth 1 when even depth 1 is over the limit', async () => {
  assert.equal(await chooseDepth(3, 50_000, async () => 90_000), 1);
});
