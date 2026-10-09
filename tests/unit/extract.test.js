import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS } from '../../src/langs.js';
import { parseSource } from '../../src/parser.js';
import { extractTree, extractLite } from '../../src/extract.js';

const run = async (lang, src) => {
  const cfg = LANGS[lang];
  const tree = await parseSource(cfg, src);
  assert.ok(tree, `grammar for ${lang} loads`);
  return extractTree(tree, src, cfg);
};
const names = (r) => r.symbols.map((s) => `${s.kind}:${s.name}`);

test('javascript: functions, classes, methods, calls, imports', async () => {
  const r = await run('javascript', `import { a } from './a.js';
class Foo extends Bar { run() { helper(); this.go(); } }
function helper() { return a(); }
const arrow = () => helper();
`);
  const n = names(r);
  assert.ok(n.includes('Class:Foo'));
  assert.ok(n.includes('Method:run'));
  assert.ok(n.includes('Function:helper'));
  assert.ok(n.includes('Function:arrow'));
  assert.ok(r.refs.some((x) => x.kind === 'call' && x.name === 'helper'));
  assert.ok(r.refs.some((x) => x.kind === 'heritage' && x.name === 'Bar'));
  assert.ok(r.imports.length >= 1);
});

test('python: classes, methods, inheritance, calls', async () => {
  const r = await run('python', `class A(Base):
    def m(self):
        helper()

def helper():
    pass
`);
  const n = names(r);
  assert.ok(n.includes('Class:A'));
  assert.ok(n.includes('Method:m'));
  assert.ok(n.includes('Function:helper'));
  assert.ok(r.refs.some((x) => x.kind === 'heritage' && x.name === 'Base'));
  assert.ok(r.refs.some((x) => x.kind === 'call' && x.name === 'helper'));
});

test('go: methods are owned by their receiver type', async () => {
  const r = await run('go', `package p
type S struct{}
func (s S) Do() { helper() }
func helper() {}
`);
  const n = names(r);
  assert.ok(n.includes('Method:Do') || n.includes('Function:Do'));
  assert.ok(n.includes('Function:helper'));
});

test('terraform (regex lite): resources, variables, references', () => {
  const src = `variable "region" { default = "us-east-1" }
resource "aws_s3_bucket" "logs" {
  bucket = var.region
}
module "net" { source = "./net" }
`;
  const r = extractLite(src, LANGS.terraform);
  const n = names(r);
  assert.ok(n.some((x) => x.endsWith('aws_s3_bucket.logs')), n.join());
  assert.ok(n.some((x) => x.includes('region')));
});
