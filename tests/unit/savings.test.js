import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from '../../src/mcp.js';
import { Store } from '../../src/store.js';
import { Llm } from '../../src/llm.js';
import { savingsSummary } from '../../src/savings.js';

// Project "p" has a 4000-char file (1000 tokens) and a 2000-char file (500 tokens).
function setup(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-'));
  const root = path.join(dir, 'repo'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.js'), 'x'.repeat(4000));
  fs.writeFileSync(path.join(root, 'b.js'), 'y'.repeat(2000));
  const store = new Store(dir);
  store.set('projects', { 'u1/p': { root } });
  const db = {
    async run(cy) {
      if (/RETURN f\.file_path AS file_path/.test(cy)) return [{ file_path: 'a.js' }, { file_path: 'b.js' }];
      if (/properties\(n\) AS n/.test(cy) && /qualified_name:\$q/.test(cy)) return rows.node ? [{ n: rows.node }] : [];
      return rows.list ?? [];
    },
  };
  return { ctx: { db, store, llm: new Llm(store), cfg: {}, tenant: { user_id: 'u1' } }, store };
}

test('tracked MCP calls record response, baseline (distinct files) and saved', async () => {
  const { ctx, store } = setup({ list: [{ qualified_name: 'a1', file_path: 'a.js' }, { qualified_name: 'a2', file_path: 'a.js' }, { qualified_name: 'b1', file_path: 'b.js' }] });
  const out = await runTool(ctx, 'search_graph', { project: 'p' }, { track: true });
  const s = savingsSummary(store);
  assert.equal(s.calls, 1);
  assert.equal(s.baseline, 1500); // a.js counted once
  assert.equal(s.response, Math.ceil(JSON.stringify(out).length / 4));
  assert.equal(s.saved, Math.max(0, 1500 - s.response));
  assert.equal(s.by_tool.search_graph.calls, 1);
});

test('get_architecture baseline is every indexed file', async () => {
  const { ctx, store } = setup({});
  await runTool(ctx, 'get_architecture', { project: 'p' }, { track: true });
  assert.equal(savingsSummary(store).by_tool.get_architecture.baseline, 1500);
});

test('saved never goes negative', async () => {
  const { ctx, store } = setup({ list: [{ qualified_name: 'z', file_path: 'missing.js', name: 'z'.repeat(500) }] });
  await runTool(ctx, 'search_graph', { project: 'p' }, { track: true });
  const s = savingsSummary(store);
  assert.equal(s.baseline, 0);
  assert.equal(s.saved, 0);
  assert.equal(s.calls, 1);
});

test('failed calls and untracked callers are not counted', async () => {
  const { ctx, store } = setup({});
  await assert.rejects(runTool(ctx, 'get_code_snippet', { project: 'p', qualified_name: 'nope' }, { track: true }), (e) => e.status === 404);
  await runTool(ctx, 'search_graph', { project: 'p' }); // REST / UI path: no track option
  await runTool(ctx, 'get_usage', {}, { track: true }); // not a tracked tool
  assert.equal(savingsSummary(store).calls, 0);
});

test('get_code_snippet baseline is the whole file; get_usage exposes savings', async () => {
  const { ctx } = setup({ node: { qualified_name: 'a1', file_path: 'a.js', start_line: 1, end_line: 2, label: 'Function' } });
  await runTool(ctx, 'get_code_snippet', { project: 'p', qualified_name: 'a1' }, { track: true });
  const u = await runTool(ctx, 'get_usage', {});
  assert.equal(u.savings.baseline, 1000);
  assert.equal(u.savings.calls, 1);
  assert.ok('tokens_used' in u && 'by_tool' in u.savings && u.savings.history.length === 1);
});
