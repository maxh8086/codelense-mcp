import test from 'node:test';
import assert from 'node:assert/strict';
import { indexFiles, sha256 } from '../../src/indexer.js';

// In-memory stand-in for Db: records writes so incremental behaviour can be asserted without Neo4j.
const fakeDb = () => {
  const files = new Map();
  const edges = [];
  return {
    files, edges,
    fileHashes: async () => new Map([...files].map(([p, v]) => [p, v.hash])),
    replaceFile: async (t, rel, nodes) => { files.set(rel, { hash: nodes.find((n) => n.label === 'File').sha256, nodes }); },
    nameIndex: async () => [...files.values()].flatMap((f) => f.nodes)
      .filter((n) => !['File', 'Folder', 'Project'].includes(n.label))
      .map((n) => ({ ...n, owner: n.qualified_name.split('.').slice(-2, -1)[0] })),
    writeEdges: async (t, e) => { edges.push(...e); },
  };
};
const T = { user_id: 'u', repo_name: 'proj' };

test('indexes new files, links calls across files, skips unchanged on re-run', async () => {
  const db = fakeDb();
  const src = [
    { rel: 'a.js', source: 'import { b } from "./b.js";\nexport function a() { b(); }\n' },
    { rel: 'b.js', source: 'export function b() {}\n' },
  ];
  const first = await indexFiles(db, T, 'proj', src);
  assert.equal(first.indexed, 2);
  assert.ok(db.edges.some((e) => e.type === 'CALLS' && e.to === 'proj.b.b'));
  assert.ok(db.edges.some((e) => e.type === 'IMPORTS' && e.to === 'proj.b.js'));

  const again = await indexFiles(db, T, 'proj', src);
  assert.equal(again.indexed, 0);
  assert.equal(again.skipped, 2);

  const changed = await indexFiles(db, T, 'proj', [{ rel: 'b.js', source: 'export function b() { return 1; }\n' }]);
  assert.equal(changed.indexed, 1);
});

test('sha256 is stable', () => { assert.equal(sha256('x'), sha256('x')); });
