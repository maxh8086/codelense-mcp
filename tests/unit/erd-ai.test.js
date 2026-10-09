import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalEndpoint, Llm } from '../../src/llm.js';
import { parseDdl } from '../../src/erd.js';
import { applyEnrichment, buildPrompt } from '../../src/erd-ai.js';

const DDL = 'CREATE TABLE customers (id INT PRIMARY KEY, name VARCHAR(50)); CREATE TABLE orders (id INT PRIMARY KEY, customer_id INT);';

test('isLocalEndpoint accepts local hosts and rejects cloud hosts', () => {
  for (const u of ['http://localhost:11434/v1', 'http://127.0.0.1:1234', 'http://192.168.1.5/v1', 'http://10.0.0.2', 'http://ollama:11434/v1', 'http://[::1]:11434/v1', 'http://host.docker.internal:11434']) assert.ok(isLocalEndpoint(u), u);
  for (const u of ['https://api.openai.com/v1', 'https://api.anthropic.com', 'http://8.8.8.8', 'http://172.32.0.1', 'not a url']) assert.ok(!isLocalEndpoint(u), u);
});

const fakeStore = (settings) => ({ get: (k, d) => (k === 'llm_settings' ? settings : d), set() {}, update() {}, seal: (s) => s, open: (s) => s });

test('assertLocal refuses api provider and remote endpoints', () => {
  assert.throws(() => new Llm(fakeStore({ provider: 'api' })).assertLocal(), (e) => e.status === 409);
  assert.throws(() => new Llm(fakeStore({ provider: 'local', base_url: 'https://api.openai.com/v1' })).assertLocal(), (e) => e.status === 409);
  assert.doesNotThrow(() => new Llm(fakeStore({})).assertLocal());
});

test('local_ready needs saved settings pointing at a local model', () => {
  assert.equal(new Llm(fakeStore({})).publicSettings().local_ready, false);
  assert.equal(new Llm(fakeStore({ model: 'llama3.2:3b-16k' })).publicSettings().local_ready, true);
  assert.equal(new Llm(fakeStore({ provider: 'api' })).publicSettings().local_ready, false);
  assert.equal(new Llm(fakeStore({ base_url: 'https://api.openai.com/v1' })).publicSettings().local_ready, false);
});

test('applyEnrichment adds only valid inferred relationships and domains', () => {
  const m = parseDdl(DDL);
  const ids = m.tables.map((t) => t.id);
  const orders = ids.find((i) => /orders$/i.test(i)), cust = ids.find((i) => /customers$/i.test(i));
  const reply = 'Sure!\n' + JSON.stringify({
    relationships: [
      { from: orders, to: cust, from_column: 'customer_id', to_column: 'id' },
      { from: orders, to: 'nope.table', from_column: 'x', to_column: 'y' },
      { from: orders, to: cust, from_column: 'missing', to_column: 'id' },
    ],
    domains: { Sales: [orders, cust] },
    descriptions: { [cust]: 'People who buy things' },
  });
  const r = applyEnrichment(m, reply);
  assert.equal(r.added, 1);
  assert.equal(r.model.relationships.length, 1);
  assert.equal(r.model.relationships[0].inferred, true);
  assert.equal(r.model.tables.find((t) => t.id === cust).domain, 'Sales');
  assert.ok(r.model.tables.find((t) => t.id === orders).columns.find((c) => c.name === 'customer_id').fk);
  assert.equal(m.relationships.length, 0, 'input model is not mutated');
});

test('applyEnrichment tolerates garbage and prompt carries no row data', () => {
  const m = parseDdl(DDL);
  assert.ok(applyEnrichment(m, 'no json here').warning);
  assert.match(buildPrompt(m), /customers/i);
});
