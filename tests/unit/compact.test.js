import test from 'node:test';
import assert from 'node:assert/strict';
import { cell, tsv, renderQueryGraph, renderSearchGraph, renderTrace, renderSearchCode, renderSnippet, renderChanges } from '../../src/compact.js';

test('cell: null and undefined become empty string', () => {
  assert.equal(cell(null), '');
  assert.equal(cell(undefined), '');
});

test('cell: scalars use String()', () => {
  assert.equal(cell('abc'), 'abc');
  assert.equal(cell(42), '42');
  assert.equal(cell(true), 'true');
});

test('cell: arrays join with comma', () => {
  assert.equal(cell(['Function', 'Method']), 'Function,Method');
  assert.equal(cell([]), '');
});

test('cell: plain objects become JSON', () => {
  assert.equal(cell({ a: 1, b: 'x' }), '{"a":1,"b":"x"}');
});

test('cell: tabs, CR and LF are replaced with a single space', () => {
  assert.equal(cell('a\tb\r\nc\nd'), 'a b  c d');
});

test('tsv: escapes tab/CR/LF in values', () => {
  const out = tsv([{ k: 'x\ty', v: 'l1\nl2\r' }]);
  assert.equal(out, 'k\tv\nx y\tl1 l2 ');
});

test('tsv: empty rows return (0 rows)', () => {
  assert.equal(tsv([]), '(0 rows)');
});

test('tsv: header is union of keys in first-seen order', () => {
  const out = tsv([
    { b: 1, a: 2 },
    { c: 3, a: 4 },
  ]);
  assert.equal(out, 'b\ta\tc\n1\t2\t\n\t4\t3');
});

test('tsv: missing keys render as empty cells', () => {
  const out = tsv([{ x: 'one' }, { x: 'two', y: null }]);
  assert.equal(out, 'x\ty\none\t\ntwo\t');
});

test('renderQueryGraph: tabular rows render as TSV', () => {
  const out = renderQueryGraph({ rows: [{ name: 'f', tags: ['a', 'b'], n: null }], truncated: false });
  assert.equal(out, 'name\ttags\tn\nf\ta,b\t');
});

test('renderQueryGraph: truncation marker appended', () => {
  const out = renderQueryGraph({ rows: [{ n: 1 }], truncated: true });
  assert.equal(out, 'n\n1\n# truncated at 500 rows');
});

test('renderQueryGraph: non-scalar row falls back to JSON', () => {
  const out = { rows: [{ nested: { a: 1 } }], truncated: false };
  assert.equal(renderQueryGraph(out), JSON.stringify(out));
});

test('renderQueryGraph: array containing objects falls back to JSON', () => {
  const out = { rows: [{ list: [{ a: 1 }] }], truncated: false };
  assert.equal(renderQueryGraph(out), JSON.stringify(out));
});

test('renderSearchGraph: renders selected columns and no marker when has_more is false', () => {
  const out = renderSearchGraph({
    results: [{ qualified_name: 'a.b', labels: ['Function'], file_path: 'a.js', start_line: 3, extra: 'ignored' }],
    offset: 0,
    limit: 10,
    has_more: false,
  });
  assert.equal(out, 'qualified_name\tlabels\tfile_path\tstart_line\na.b\tFunction\ta.js\t3');
});

test('renderSearchGraph: has_more appends offset marker', () => {
  const out = renderSearchGraph({
    results: [{ qualified_name: 'q', labels: [], file_path: 'f', start_line: 1 }],
    offset: 20,
    limit: 10,
    has_more: true,
  });
  assert.ok(out.endsWith('\n# has_more offset=30'));
});

test('renderTrace: renders hops first as TSV', () => {
  const out = renderTrace({
    nodes: [
      { hops: 1, qualified_name: 'x', labels: ['Function'], file_path: 'x.js', start_line: 5 },
    ],
  });
  assert.equal(out, 'hops\tqualified_name\tlabels\tfile_path\tstart_line\n1\tx\tFunction\tx.js\t5');
});

test('renderSearchCode: no matches returns 0 matches', () => {
  assert.equal(renderSearchCode({ matches: [] }), '0 matches');
});

test('renderSearchCode: lines are file:line:text', () => {
  const out = renderSearchCode({
    matches: [
      { file: 'a.js', line: 1, text: 'const x' },
      { file: 'b.js', line: 7, text: 'return x' },
    ],
  });
  assert.equal(out, 'a.js:1:const x\nb.js:7:return x');
});

test('renderSearchCode: truncated appends marker', () => {
  const out = renderSearchCode({ matches: [{ file: 'a.js', line: 1, text: 't' }], truncated: true });
  assert.equal(out, 'a.js:1:t\n# truncated, raise limit or narrow pattern');
});

test('renderSnippet: formats header and code', () => {
  const out = renderSnippet({ file_path: 'src/a.js', start_line: 10, end_line: 12, code: 'function f() {}' });
  assert.equal(out, 'src/a.js:10-12\nfunction f() {}');
});

test('renderChanges: clean tree with head sha', () => {
  const out = renderChanges({
    added: [],
    modified: [],
    removed: [],
    git_dirty: [],
    clean: true,
    index_sha: 'abcdef1234',
    head_sha: 'abcdef1234567890',
    stale: false,
  });
  assert.equal(out, 'clean @abcdef1');
});

test('renderChanges: clean with null git_dirty and no head sha', () => {
  const out = renderChanges({ clean: true, git_dirty: null, stale: false });
  assert.equal(out, 'clean');
});

test('renderChanges: dirty output lists A, M, D, then G for unlisted git entries', () => {
  const out = renderChanges({
    added: ['new.js'],
    modified: ['mod.js'],
    removed: ['gone.js'],
    git_dirty: ['new.js', 'mod.js', 'gone.js', 'untracked.txt'],
    clean: false,
    head_sha: 'abc',
    stale: false,
  });
  assert.equal(out, 'A new.js\nM mod.js\nD gone.js\nG untracked.txt');
});

test('renderChanges: G lines do not duplicate A/M/D entries', () => {
  const out = renderChanges({
    added: ['a.js'],
    git_dirty: ['a.js'],
    clean: false,
  });
  assert.equal(out, 'A a.js');
});

test('renderChanges: stale appends warning line', () => {
  const out = renderChanges({ modified: ['m.js'], clean: false, stale: true });
  assert.equal(out, 'M m.js\n# index is behind: run index_repository');
});

test('renderChanges: missing arrays default to empty', () => {
  assert.equal(renderChanges({ clean: false }), '');
});
