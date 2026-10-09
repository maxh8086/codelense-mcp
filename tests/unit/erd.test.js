import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDdl, assemble, toMermaid, toCsv, assertReadOnlySql, introspect, publicConnection } from '../../src/erd.js';

const DDL = `
CREATE TABLE customers (
  id NUMBER(10) PRIMARY KEY,
  name VARCHAR2(100 CHAR) NOT NULL
);
CREATE TABLE orders (
  id NUMBER(10) NOT NULL,
  customer_id NUMBER(10) NOT NULL,
  total NUMBER(12,2),
  CONSTRAINT pk_orders PRIMARY KEY (id),
  CONSTRAINT fk_ord_cust FOREIGN KEY (customer_id) REFERENCES customers (id)
);
`;

test('parseDdl finds tables, PKs and FKs', () => {
  const m = parseDdl(DDL);
  assert.equal(m.tables.length, 2);
  const orders = m.tables.find((t) => t.name.toLowerCase() === 'orders');
  assert.ok(orders.columns.find((c) => c.name.toLowerCase() === 'id').pk);
  assert.ok(orders.columns.find((c) => c.name.toLowerCase() === 'customer_id').fk);
  assert.equal(m.relationships.length, 1);
});

test('parseDdl rejects text without tables', () => {
  assert.throws(() => parseDdl('select 1'), (e) => e.status === 400);
});

test('assemble builds relationships and drops FKs leaving the schema', () => {
  const m = assemble({
    columns: [
      { sch: 'S', tbl: 'A', col: 'ID', typ: 'NUMBER', nul: 'N', pos: 1 },
      { sch: 'S', tbl: 'B', col: 'ID', typ: 'NUMBER', nul: 'N', pos: 1 },
      { sch: 'S', tbl: 'B', col: 'A_ID', typ: 'NUMBER', nul: 'Y', pos: 2 },
    ],
    pks: [{ sch: 'S', tbl: 'A', col: 'ID', pos: 1 }, { sch: 'S', tbl: 'B', col: 'ID', pos: 1 }],
    fks: [
      { fk_name: 'F1', sch: 'S', tbl: 'B', col: 'A_ID', rsch: 'S', rtbl: 'A', rcol: 'ID', pos: 1 },
      { fk_name: 'F2', sch: 'S', tbl: 'B', col: 'A_ID', rsch: 'OTHER', rtbl: 'X', rcol: 'ID', pos: 1 },
    ],
  });
  assert.equal(m.tables.length, 2);
  assert.equal(m.relationships.length, 1);
  assert.equal(m.relationships[0].to, 'S.A');
});

test('exports mermaid and csv', () => {
  const m = parseDdl(DDL);
  assert.match(toMermaid(m), /erDiagram/);
  const csv = toCsv(m);
  assert.match(csv.split('\n')[0], /^table,column,type/);
  assert.ok(csv.split('\n').length > 4);
});

test('assertReadOnlySql refuses writes', () => {
  assert.doesNotThrow(() => assertReadOnlySql('SELECT 1 FROM dual'));
  assert.throws(() => assertReadOnlySql('DELETE FROM t'), (e) => e.status === 403);
  assert.throws(() => assertReadOnlySql('select 1; drop table t'), (e) => e.status === 403);
});

test('introspect runs only read-only SQL through an injected connection', async () => {
  const seen = [];
  const open = async () => ({
    query: async (sql) => {
      seen.push(sql);
      if (/CONS|FK/i.test(sql) && /R_CONSTRAINT|REFERENCES|r\./i.test(sql)) return [];
      return [];
    },
    close: async () => {},
  });
  await introspect({ kind: 'oracle' }, ['HR'], { open }).catch(() => {});
  for (const s of seen) assert.doesNotThrow(() => assertReadOnlySql(s));
});

test('publicConnection hides secrets', () => {
  const p = publicConnection({ kind: 'oracle', host: 'h', password: 'pw', secret: 's' });
  assert.equal(p.password, undefined);
  assert.equal(p.secret, undefined);
  assert.equal(p.has_password, true);
});
