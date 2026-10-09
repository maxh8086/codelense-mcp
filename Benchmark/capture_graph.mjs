// Calls each task's synaptree tool over SSE and stores the raw response text an agent would receive.
// usage (from repo root): node Benchmark/capture_graph.mjs <origin> <project> [token]
// A `name` arg is resolved to a qualified_name via search_graph first.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [origin = 'http://127.0.0.1:8787', project, token] = process.argv.slice(2);
if (!project) {
  console.error('usage: node Benchmark/capture_graph.mjs <origin> <project> [token]');
  process.exit(2);
}
const hdr = token ? { authorization: `Bearer ${token}` } : null;
const opts = hdr
  ? { requestInit: { headers: hdr }, eventSourceInit: { fetch: (u, i) => fetch(u, { ...i, headers: { ...i?.headers, ...hdr } }) } }
  : {};
const client = new Client({ name: 'bench', version: '1' });
await client.connect(new SSEClientTransport(new URL('/sse', origin), opts));
const call = async (name, args) =>
  (await client.callTool({ name, arguments: { project, ...args } })).content?.[0]?.text ?? '';

const outDir = path.join(here, 'results', 'graph');
fs.mkdirSync(outDir, { recursive: true });
for (const t of JSON.parse(fs.readFileSync(path.join(here, 'tasks.json'), 'utf8'))) {
  const { tool, args } = t.graph_call;
  const a = { ...args };
  if (a.name) {
    const found = JSON.parse(await call('search_graph', { query: a.name, limit: 10, format: 'json' })).results ?? [];
    const hit = found.find((x) => x.name === a.name || x.qualified_name.endsWith(`.${a.name}`)) ?? found[0];
    delete a.name;
    a.qualified_name = hit?.qualified_name;
  }
  const text = await call(tool, a);
  fs.writeFileSync(path.join(outDir, t.graph_file), text);
  console.log(`${t.id} ${tool} ${text.length} chars`);
}
await client.close();
