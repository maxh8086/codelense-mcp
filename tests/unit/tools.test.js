import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from '../../src/mcp.js';
import { Store } from '../../src/store.js';
import { Llm } from '../../src/llm.js';
import { listDirs } from '../../src/server.js';

function makeCtx(nodes = 10) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  const calls = [];
  const db = {
    async run(cy, params) { calls.push({ cy, params }); return /count\(n\) AS c\b/.test(cy) ? [{ c: nodes }] : []; },
    async purgeProject(t) { calls.push({ purge: t }); return nodes; },
  };
  const store = new Store(dir);
  return { ctx: { db, store, llm: new Llm(store), cfg: {}, tenant: { user_id: 'u1' } }, calls, dir };
}
const PHRASE = 'yes, delete my repo';

test('erd connections: save hides password, test reports counts, delete removes', async () => {
  const { ctx, dir } = makeCtx();
  const file = path.join(dir, 'app.db');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id));');
  db.close();
  ctx.cfg.workspaceRoot = dir;
  await runTool(ctx, 'erd_save_connection', { id: 'lite', kind: 'sqlite', file });
  await runTool(ctx, 'erd_save_connection', { id: 'pg', kind: 'postgres', host: 'h', user: 'u', password: 'topsecret' });
  const list = await runTool(ctx, 'erd_list_connections', {});
  assert.equal(list.length, 2);
  assert.ok(!JSON.stringify(list).includes('topsecret'));
  assert.deepEqual(await runTool(ctx, 'erd_test_connection', { id: 'lite' }), { ok: true, tables: 2, relationships: 1 });
  await assert.rejects(runTool(ctx, 'erd_test_connection', { id: 'nope' }), (e) => e.status === 404);
  await runTool(ctx, 'erd_delete_connection', { id: 'lite' });
  assert.equal((await runTool(ctx, 'erd_list_connections', {})).length, 1);
});

test('query_graph rejects write clauses with 403', async () => {
  const { ctx } = makeCtx();
  for (const q of ['MATCH (n) WHERE n.user_id=$user_id DETACH DELETE n', 'CREATE (n:X {user_id:$user_id})', 'MATCH (n {user_id:$user_id}) SET n.x=1']) {
    await assert.rejects(runTool(ctx, 'query_graph', { project: 'p', cypher: q }), (e) => e.status === 403);
  }
});

test('query_graph requires tenant filter and passes tenant params', async () => {
  const { ctx, calls } = makeCtx();
  await assert.rejects(runTool(ctx, 'query_graph', { project: 'p', cypher: 'MATCH (n) RETURN n' }), (e) => e.status === 403);
  await runTool(ctx, 'query_graph', { project: 'p', cypher: 'MATCH (n {user_id:$user_id, repo_name:$repo_name}) RETURN n' });
  assert.deepEqual(calls.at(-1).params, { user_id: 'u1', repo_name: 'p' });
});

test('delete_project: dry run, wrong name, wrong phrase, reuse all refuse', async () => {
  const { ctx, calls } = makeCtx();
  const dry = await runTool(ctx, 'delete_project', { project: 'p', dry_run: true });
  assert.match(dry.notice, /index only/);
  await assert.rejects(runTool(ctx, 'delete_project', { project: 'p', delete_token: dry.delete_token, confirm_name: 'x', confirm_phrase: PHRASE }), /confirm_name/);
  // token is single-use, even after a failed attempt
  await assert.rejects(runTool(ctx, 'delete_project', { project: 'p', delete_token: dry.delete_token, confirm_name: 'p', confirm_phrase: PHRASE }), /invalid or expired/);
  const d2 = await runTool(ctx, 'delete_project', { project: 'p', dry_run: true });
  await assert.rejects(runTool(ctx, 'delete_project', { project: 'p', delete_token: d2.delete_token, confirm_name: 'p', confirm_phrase: 'yes' }), /confirm_phrase/);
  assert.equal(calls.some((c) => c.purge), false);
});

test('delete_project: full flow purges once and clears store entries', async () => {
  const { ctx, calls } = makeCtx();
  ctx.store.set('projects', { 'u1/p': { root: '/x' } });
  const dry = await runTool(ctx, 'delete_project', { project: 'p', dry_run: true });
  const out = await runTool(ctx, 'delete_project', { project: 'p', delete_token: dry.delete_token, confirm_name: 'p', confirm_phrase: PHRASE });
  assert.equal(out.deleted, true);
  assert.equal(calls.filter((c) => c.purge).length, 1);
  assert.equal(ctx.store.get('projects', {})['u1/p'], undefined);
});

test('delete_project: expired token is refused', async () => {
  const { ctx } = makeCtx();
  const dry = await runTool(ctx, 'delete_project', { project: 'p', dry_run: true });
  ctx.deleteTokens.get(dry.delete_token).exp = Date.now() - 1;
  await assert.rejects(runTool(ctx, 'delete_project', { project: 'p', delete_token: dry.delete_token, confirm_name: 'p', confirm_phrase: PHRASE }), /invalid or expired/);
});

test('snooze_project accepts only 3 or 6 months and sets keep_until', async () => {
  const { ctx } = makeCtx();
  await assert.rejects(runTool(ctx, 'snooze_project', { project: 'p', months: 4 }), (e) => e.status === 400);
  const r = await runTool(ctx, 'snooze_project', { project: 'p', months: 6 });
  assert.ok(r.keep_until > Date.now() + 170 * 86_400_000);
});

test('llm gate tiers', () => {
  const { ctx } = makeCtx();
  assert.equal(ctx.llm.tier(1000), 'auto');
  assert.equal(ctx.llm.tier(60_000), 'confirm');
  assert.equal(ctx.llm.tier(150_000), 'strong');
});

test('store seals and opens secrets', () => {
  const { ctx } = makeCtx();
  const sealed = ctx.store.seal('rg_secret');
  assert.notEqual(sealed, 'rg_secret');
  assert.equal(ctx.store.open(sealed), 'rg_secret');
});

test('listDirs confines browsing to workspace_root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  fs.mkdirSync(path.join(root, 'a', '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'));
  const out = await listDirs(root, '');
  assert.deepEqual(out.dirs.map((d) => [d.name, d.repo]), [['a', true]]);
  await assert.rejects(listDirs(root, path.join(root, '..')), (e) => e.status === 403);
});
