// Times core operations against a running server and prints Operation | Time | Notes rows.
// usage (repo root): node Benchmark/perf.mjs <origin> <project[=/container/root]> ...   (token via BENCH_TOKEN)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const [origin = 'http://127.0.0.1:8787', ...projects] = process.argv.slice(2);
const token = process.env.BENCH_TOKEN;
const hdr = token ? { authorization: `Bearer ${token}` } : null;
const opts = hdr ? { requestInit: { headers: hdr }, eventSourceInit: { fetch: (u, i) => fetch(u, { ...i, headers: { ...i?.headers, ...hdr } }) } } : {};
const client = new Client({ name: 'perf', version: '1' });
await client.connect(new SSEClientTransport(new URL('/sse', origin), opts));
const call = async (name, args) => (await client.callTool({ name, arguments: args })).content?.[0]?.text ?? '';
const fmt = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const rows = [];
async function time(op, notes, fn) {
  const s = performance.now();
  const out = await fn();
  rows.push([op, fmt(performance.now() - s), typeof notes === 'function' ? notes(out) : notes]);
}

for (const spec of projects) {
  const [project, root_path] = spec.split('=');
  const rootArg = root_path ? { root_path } : {};
  const t0 = performance.now();
  const idx = await call('index_repository', { project, force: true, ...rootArg });
  const fullMs = performance.now() - t0;
  if (process.env.DEBUG) console.error(project, idx.slice(0, 150));
  if (idx.startsWith('{"error"')) throw new Error(`${project}: ${idx}`);
  const arch = JSON.parse(await call('get_architecture', { project }));
  const nodes = (arch.labels ?? []).reduce((n, l) => n + l.count, 0);
  const edges = (arch.edges ?? []).reduce((n, e) => n + e.count, 0);
  const tag = `${project} (${nodes} nodes, ${edges} edges)`;
  if (!nodes) { console.error(`${project}: nothing indexed: ${idx.slice(0, 200)}`); continue; }
  rows.push(['Full index (force)', fmt(fullMs), tag]);
  await time('Fast index (nothing changed)', tag, () => call('index_repository', { project }));
  await time('Cypher: count Functions', tag, () => call('query_graph', { project, cypher: 'MATCH (n:Function {user_id:$user_id, repo_name:$repo_name}) RETURN count(n) AS n' }));
  await time('Name search (regex)', 'search_code, pattern "async|await", limit 50', () => call('search_code', { project, pattern: 'async|await', limit: 50 }));
  await time('Dead-code detection', 'Functions with no incoming CALLS, limit 100', () => call('query_graph', { project, cypher: 'MATCH (f:Function {user_id:$user_id, repo_name:$repo_name}) WHERE NOT ()-[:CALLS]->(f) RETURN f.qualified_name LIMIT 100' }));
  const top = (await call('query_graph', { project, cypher: 'MATCH (s:Function {user_id:$user_id, repo_name:$repo_name})-[e:CALLS]-() RETURN s.qualified_name AS qn, count(e) AS d ORDER BY d DESC LIMIT 1' })).split(String.fromCharCode(10))[1]?.split(String.fromCharCode(9))[0];
  const qn = top;
  if (qn) await time('trace_path depth 5', `most-connected function, both directions, capped at 200 rows`, () => call('trace_path', { project, qualified_name: qn, depth: 5, direction: 'both' }));
  rows.push(['', '', '']);
}
console.log('| Operation | Time | Notes |\n| --- | --- | --- |');
for (const r of rows) if (r[0]) console.log(`| ${r.join(' | ')} |`);
await client.close();
