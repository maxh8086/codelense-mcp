import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from '../../src/mcp.js';
import { Store } from '../../src/store.js';
import { Llm } from '../../src/llm.js';
import { createApp } from '../../src/server.js';
import { EDGE_TYPES, PRODUCED_EDGE_TYPES } from '../../src/constants.js';

function makeCtx(rows = () => []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  const calls = [];
  const db = {
    async run(cy, params) { calls.push({ cy, params }); return rows(cy, params); },
    async importGraph(t, nodes, edges) { calls.push({ imported: { t, nodes, edges } }); },
    async ping() { return true; },
  };
  const store = new Store(dir);
  return { ctx: { db, store, llm: new Llm(store), cfg: {}, tenant: { user_id: 'u1' } }, calls };
}

async function serve(ctx) {
  const server = createApp(ctx).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('auth: bearer token required on /api when CODELENSE_TOKEN is set', async () => {
  const { ctx } = makeCtx();
  ctx.cfg.token = 'tok-123';
  const s = await serve(ctx);
  try {
    assert.equal((await fetch(`${s.base}/healthz`)).status, 200);
    const url = `${s.base}/api/v1/projects`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer tok-123' } })).status, 200);
  } finally { s.close(); }
});

test('sync: rejects bad payloads, foreign tenants and path escapes', async () => {
  const { ctx } = makeCtx();
  const s = await serve(ctx);
  const post = (body) => fetch(`${s.base}/api/v1/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ repo_name: 'r' })).status, 400);
    assert.equal((await post({ repo_name: 'r', file_path: 'a.js', ast_json: {}, user_id: 'someone-else' })).status, 403);
    assert.equal((await post({ repo_name: 'r', file_path: '../x.js', ast_json: {} })).status, 400);
    assert.equal((await post({ repo_name: 'r', file_path: '/abs.js', ast_json: {} })).status, 400);
  } finally { s.close(); }
});

test('LLM settings: api key is write-only and guardrails validate', async () => {
  const { ctx } = makeCtx();
  const saved = await runTool(ctx, 'set_llm_settings', { provider: 'api', base_url: 'https://api.example.com/v1', api_key: 'sk-secret' });
  assert.equal(saved.api_key_set, true);
  assert.ok(!JSON.stringify(await runTool(ctx, 'get_llm_settings', {})).includes('sk-secret'));
  await assert.rejects(runTool(ctx, 'set_llm_settings', { guardrails: { confirm_tokens: 999_999_999 } }), (e) => e.status === 400);
  const u = await runTool(ctx, 'get_usage', {});
  assert.equal(u.tokens_used, 0);
});

test('LLM gate: paid sources need approval, local sources and annotations do not', async () => {
  const { ctx } = makeCtx();
  assert.equal(ctx.llm.gate('s', 60_000).exempt, true); // default provider is local
  await runTool(ctx, 'set_llm_settings', { provider: 'api', base_url: 'https://api.example.com/v1' });
  const first = ctx.llm.gate('s', 60_000);
  assert.equal(first.needs_approval, true);
  assert.equal(ctx.llm.gate('s', 60_000, { approval_id: first.approval_id }).ok, true);
  assert.equal(ctx.llm.gate('s', 60_000, { purpose: 'annotation' }).exempt, true);
});

test('estimate_cost / ask_flow / summarize_symbol report unknown symbols as 404', async () => {
  const { ctx } = makeCtx();
  for (const [tool, args] of [['estimate_cost', {}], ['ask_flow', { question: 'why?' }], ['summarize_symbol', {}]]) {
    await assert.rejects(runTool(ctx, tool, { project: 'p', qualified_name: 'nope', ...args }), (e) => e.status === 404);
  }
});

test('search_graph offset pages the result and reports has_more', async () => {
  const { ctx, calls } = makeCtx(() => [{ n: { name: 'a' } }, { n: { name: 'b' } }]);
  const out = await runTool(ctx, 'search_graph', { project: 'p', limit: 2, offset: 4 });
  assert.equal(out.offset, 4);
  assert.equal(out.has_more, true);
  assert.equal(calls.at(-1).params.off, 4);
});

test('get_graph_schema separates produced from reserved edge types', async () => {
  const { ctx } = makeCtx();
  const s = await runTool(ctx, 'get_graph_schema', { project: 'p' });
  assert.deepEqual(s.produced_edge_types, PRODUCED_EDGE_TYPES);
  assert.equal(s.produced_edge_types.length + s.reserved_edge_types.length, EDGE_TYPES.length);
  assert.ok(PRODUCED_EDGE_TYPES.every((e) => EDGE_TYPES.includes(e)));
});

test('export_graph / import_graph round-trip annotations and validate input', async () => {
  const { ctx, calls } = makeCtx((cy) => (/RETURN properties/.test(cy) ? [{ p: { user_id: 'u1', repo_name: 'p', qualified_name: 'p.f', name: 'f', embedding: [1] }, l: ['CodeNode', 'Function'] }] : []));
  await runTool(ctx, 'annotate_element', { project: 'p', element: 'p.f', note: 'hello' });
  const dump = await runTool(ctx, 'export_graph', { project: 'p' });
  assert.equal(dump.nodes[0].label, 'Function');
  assert.ok(!('embedding' in dump.nodes[0]) && !('user_id' in dump.nodes[0]));
  assert.deepEqual(dump.annotations, { 'p.f': 'hello' });

  const target = makeCtx();
  const res = await runTool(target.ctx, 'import_graph', { project: 'q', data: dump });
  assert.equal(res.imported.nodes, 1);
  assert.deepEqual((await runTool(target.ctx, 'get_annotations', { project: 'q' })).annotations, { 'p.f': 'hello' });
  assert.equal(target.calls.at(-1).imported.t.repo_name, 'q');

  const bad = { ...dump, nodes: [{ label: 'Nope', qualified_name: 'x' }] };
  await assert.rejects(runTool(target.ctx, 'import_graph', { project: 'q', data: bad }), (e) => e.status === 400);
  const badEdge = { ...dump, edges: [{ from: 'a', to: 'b', type: 'NOT_AN_EDGE' }] };
  await assert.rejects(runTool(target.ctx, 'import_graph', { project: 'q', data: badEdge }));
  assert.ok(calls.length > 0);
});
