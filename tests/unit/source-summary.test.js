import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS } from '../../src/langs.js';
import { parseSource } from '../../src/parser.js';
import { extractTree } from '../../src/extract.js';
import { buildFile } from '../../src/linker.js';
import { summarizeEnabled, summarizeMissing } from '../../src/summarize.js';
import { loadConfig } from '../../src/config.js';

const build = async (src, opts) => {
  const t = await parseSource(LANGS.typescript, src);
  return buildFile('proj', 'a.ts', extractTree(t, src, LANGS.typescript), { lang: 'typescript', ...opts });
};

test('symbol nodes store sliced source, capped by maxSource', async () => {
  const src = 'function a() {\n  return 1;\n}\nfunction b() { return 2; }\n';
  const f = await build(src, { source: src });
  const a = f.nodes.find((n) => n.qualified_name === 'proj.a.a');
  assert.ok(a.source.includes('return 1'));
  assert.ok(!a.source.includes('return 2'));
  const capped = await build(src, { source: src, maxSource: 5 });
  assert.equal(capped.nodes.find((n) => n.qualified_name === 'proj.a.a').source.length, 5);
});

test('no source supplied leaves source empty', async () => {
  const f = await build('function a() {}\n', {});
  assert.equal(f.nodes.find((n) => n.qualified_name === 'proj.a.a').source, '');
});

test('summarize is off by default and enabled by env', () => {
  assert.equal(summarizeEnabled(loadConfig({})), false);
  assert.equal(summarizeEnabled(loadConfig({ SYNAPTREE_SUMMARIZE_ON_INDEX: '1' })), true);
});

test('summarizeMissing stores local-only summaries and counts failures', async () => {
  const writes = [];
  const ctx = {
    tenant: { user_id: 'u' },
    db: { run: async (q, p) => (q.startsWith('MATCH (n:') && q.includes('RETURN') ? [{ qn: 'x', src: 'code' }, { qn: 'y', src: 'bad' }] : (writes.push(p), [])) },
    llm: { complete: async (prompt, o) => { assert.equal(o.localOnly, true); if (prompt.includes('bad')) throw new Error('x'); return { text: ' does a thing ' }; } },
  };
  const r = await summarizeMissing(ctx, 'p', { limit: 5 });
  assert.deepEqual(r, { summarized: 1, failed: 1, candidates: 2 });
  assert.equal(writes[0].s, 'does a thing');
});
