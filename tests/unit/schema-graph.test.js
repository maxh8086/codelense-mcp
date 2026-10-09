import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from '../../src/mcp.js';
import { Store } from '../../src/store.js';
import { Llm } from '../../src/llm.js';
import { modelToGraph, inferMongoModel, nosqlLimits, digest } from '../../src/schema-graph.js';

const sqlModel = {
  tables: [
    { id: 'public.users', schema: 'public', name: 'users', columns: [{ name: 'id', type: 'int', pk: true }, { name: 'email', type: 'text' }] },
    { id: 'public.orders', schema: 'public', name: 'orders', columns: [{ name: 'id', type: 'int', pk: true }, { name: 'user_id', type: 'int', fk: true }] },
  ],
  relationships: [{ id: 'r1', name: 'fk_orders_user', from: 'public.orders', to: 'public.users', columns: [{ from: 'user_id', to: 'id' }], cardinality: 'N:1' }],
};

test('modelToGraph: tables, columns, HAS_COLUMN and REFERENCES with origin', () => {
  const g = modelToGraph(sqlModel, { source_kind: 'postgres' });
  assert.equal(g.nodes.filter((n) => n.label === 'Table').length, 2);
  assert.equal(g.nodes.filter((n) => n.label === 'Column').length, 4);
  assert.equal(g.edges.filter((e) => e.type === 'HAS_COLUMN').length, 4);
  const ref = g.edges.find((e) => e.type === 'REFERENCES');
  assert.deepEqual([ref.from, ref.to, ref.origin, ref.from_columns, ref.to_columns], ['public.orders', 'public.users', 'declared', ['user_id'], ['id']]);
});

test('modelToGraph drops relationships to unknown tables', () => {
  const g = modelToGraph({ tables: sqlModel.tables, relationships: [{ from: 'x', to: 'public.users', columns: [] }] });
  assert.equal(g.edges.some((e) => e.type === 'REFERENCES'), false);
});

test('nosqlLimits clamps', () => {
  assert.equal(nosqlLimits({ sample_size: 9999 }).sample, 200);
  assert.equal(nosqlLimits({ max_depth: 99 }).maxDepth, 4);
  assert.equal(nosqlLimits({}).maxDepth, 2);
});

test('inferMongoModel: depth cap, truncation flag, name-based references', () => {
  const samples = {
    users: [{ _id: 1, name: 'a', profile: { address: { geo: { lat: 1 } } } }],
    orders: [{ _id: 2, user_id: 1, items: [{ sku: 's', tags: ['x'] }] }],
  };
  const m = inferMongoModel(samples, { sample: 50, maxDepth: 1, maxFields: 60, maxCollections: 200 });
  assert.equal(m.nosql, true);
  assert.equal(m.truncated, true);
  assert.ok(!m.tables[0].columns.some((c) => c.name.includes('geo')));
  const r = m.relationships.find((x) => x.from === 'orders');
  assert.deepEqual([r.to, r.origin], ['users', 'inferred_name']);
});

test('inferMongoModel: field and collection caps', () => {
  const doc = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}`, i]));
  const m = inferMongoModel({ a: [doc], b: [doc], c: [doc] }, { sample: 5, maxDepth: 2, maxFields: 3, maxCollections: 2 });
  assert.equal(m.tables.length, 2);
  assert.equal(m.tables[0].columns.length, 3);
  assert.equal(m.truncated, true);
});

test('digest lists tables and relationships', () => {
  const d = digest(sqlModel);
  assert.match(d, /table public\.users/);
  assert.match(d, /public\.orders\(user_id\) -> public\.users\(id\) N:1 \[declared\]/);
});

test('tools: save, list, get and relationships over an in-memory stub db', async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'cl-sg-')));
  const file = path.join(os.tmpdir(), `cl-sg-${Date.now()}.sql`);
  fs.writeFileSync(file, '');
  let saved = null;
  const db = {
    async run() { return []; },
    async replaceSchema(t, nodes, edges) { saved = { t, nodes, edges }; },
    async readSchema() {
      return {
        tables: saved.nodes.filter((n) => n.label === 'Table'),
        columns: saved.nodes.filter((n) => n.label === 'Column'),
        relationships: saved.edges.filter((e) => e.type === 'REFERENCES').map((e) => ({ from: e.from, to: e.to, p: e })),
      };
    },
    async listSchemas() { return [{ repo_name: 'db:main', tables: 2, saved_at: 'now', source_kind: 'sqlite', nosql: false }]; },
    async purgeProject() { return 0; },
  };
  const ctx = { db, store, llm: new Llm(store), cfg: { workspaceRoot: os.tmpdir() }, tenant: { user_id: 'u1' } };
  store.update('erd_conns:u1', (all) => { all.main = { public: { kind: 'sqlite', file }, secret: store.seal('{}') }; return all; });
  // stub the model source by passing DDL is not supported for save (needs connection); use sqlite file with DDL tables
  const sqlite = await import('node:sqlite').catch(() => null);
  if (!sqlite) return;
  const dbf = path.join(os.tmpdir(), `cl-sg-${Date.now()}.db`);
  const h = new sqlite.DatabaseSync(dbf);
  h.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT); CREATE TABLE orders(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));');
  h.close();
  store.update('erd_conns:u1', (all) => { all.main = { public: { kind: 'sqlite', file: dbf }, secret: store.seal('{}') }; return all; });
  const r = await runTool(ctx, 'erd_save_to_index', { connection_id: 'main' });
  assert.equal(r.tables, 2);
  assert.equal(r.relationships, 1);
  assert.equal(saved.t.repo_name, 'db:main');
  assert.equal((await runTool(ctx, 'list_db_schemas', {}))[0].connection_id, 'main');
  const s = await runTool(ctx, 'get_db_schema', { connection_id: 'main' });
  assert.equal(s.tables.length, 2);
  const d = await runTool(ctx, 'get_db_schema', { connection_id: 'main', format: 'digest' });
  assert.match(d.digest, /orders/);
  const rel = await runTool(ctx, 'get_table_relationships', { connection_id: 'main', table: 'users' });
  assert.equal(rel.referenced_by.length, 1);
  assert.equal(rel.references.length, 0);
});
