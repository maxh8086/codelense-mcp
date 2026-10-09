import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS } from '../../src/langs.js';
import { parseSource } from '../../src/parser.js';
import { extractTree, extractLite } from '../../src/extract.js';
import { buildFile, NameIndex, linkRefs, resolveImports } from '../../src/linker.js';

const ts = async (file, src) => {
  const t = await parseSource(LANGS.typescript, src);
  return buildFile('proj', file, extractTree(t, src, LANGS.typescript), { lang: 'typescript' });
};
const indexOf = (...files) => {
  const idx = new NameIndex();
  for (const f of files) for (const n of f.nodes) idx.add({ ...n, owner: n.qualified_name.split('.').slice(-2, -1)[0] });
  return idx;
};

test('structure: folder/file/symbol nodes and DEFINES edges', async () => {
  const f = await ts('src/a.ts', 'class Foo { run() {} }\nfunction helper() {}\n');
  const qn = f.nodes.map((n) => n.qualified_name);
  assert.ok(qn.includes('proj.src.a.ts'));
  assert.ok(qn.includes('proj.src.a.Foo'));
  assert.ok(qn.includes('proj.src.a.Foo.run'));
  assert.ok(f.edges.some((e) => e.type === 'DEFINES_METHOD' && e.to === 'proj.src.a.Foo.run'));
  assert.ok(f.edges.some((e) => e.type === 'CONTAINS_FILE'));
});

test('unique call resolves to CALLS; duplicate names become USAGE', async () => {
  const a = await ts('src/a.ts', 'function helper() {}\nfunction caller() { helper(); other(); }\n');
  const b = await ts('src/b.ts', 'function other() {}\n');
  const c = await ts('src/c.ts', 'function other() {}\n');
  const edges = linkRefs([...a.pending], indexOf(a, b, c));
  assert.ok(edges.some((e) => e.type === 'CALLS' && e.to === 'proj.src.a.helper'));
  assert.ok(edges.filter((e) => e.type === 'USAGE' && e.ambiguous).length === 2);
});

test('heritage and type references', async () => {
  const a = await ts('src/a.ts', 'class Bar {}\nclass Foo extends Bar { m(p: Baz) {} }\ninterface Baz {}\n');
  const edges = linkRefs(a.pending, indexOf(a));
  assert.ok(edges.some((e) => e.type === 'INHERITS' && e.to === 'proj.src.a.Bar'));
  assert.ok(edges.some((e) => e.type === 'USES_TYPE' && e.to === 'proj.src.a.Baz'));
});

test('relative imports resolve to indexed files only', () => {
  const known = new Set(['src/a.ts', 'src/util/index.ts']);
  const r = resolveImports('src/main.ts', ["import x from './a'", "import y from './util'", "import z from 'lodash'"], known);
  assert.deepEqual(r.sort(), ['src/a.ts', 'src/util/index.ts']);
});

test('terraform: variable reference links to the variable', () => {
  const src = 'variable "region" { default = "x" }\nresource "aws_s3_bucket" "logs" {\n  bucket = var.region\n}\n';
  const x = extractLite(src, LANGS.terraform);
  const f = buildFile('infra', 'main.tf', x, { lang: 'terraform' });
  assert.ok(f.nodes.some((n) => n.label === 'Resource'), 'Variable maps to Resource');
  assert.ok(f.nodes.some((n) => n.name.includes('aws_s3_bucket')));
});
