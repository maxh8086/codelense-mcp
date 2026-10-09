import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from '../../src/mcp.js';
import { Store } from '../../src/store.js';
import { Llm } from '../../src/llm.js';

function makeCtx() {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'cl-ask-')));
  return { db: { async run() { return []; } }, store, llm: new Llm(store), cfg: {}, tenant: { user_id: 'u1' } };
}

test('annotations: save, read back, empty note deletes', async () => {
  const ctx = makeCtx();
  await runTool(ctx, 'annotate_element', { project: 'p', element: 'a.b', note: 'hot path' });
  assert.deepEqual((await runTool(ctx, 'get_annotations', { project: 'p' })).annotations, { 'a.b': 'hot path' });
  await runTool(ctx, 'annotate_element', { project: 'p', element: 'a.b', note: '  ' });
  assert.deepEqual((await runTool(ctx, 'get_annotations', { project: 'p' })).annotations, {});
});

test('gate: confirm tier needs a matching single-use approval; strong also needs send_anyway', () => {
  const { llm } = makeCtx();
  const g = llm.gate('s', 60_000, {});
  assert.equal(g.needs_approval, true);
  assert.equal(llm.gate('s', 60_000, { approval_id: g.approval_id }).ok, true);
  assert.equal(llm.gate('s', 60_000, { approval_id: g.approval_id }).needs_approval, true);
  const h = llm.gate('s', 150_000, {});
  assert.equal(h.tier, 'strong');
  assert.equal(llm.gate('s', 150_000, { approval_id: h.approval_id }).needs_approval, true);
});
