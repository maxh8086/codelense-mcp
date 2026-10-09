// Smoke test: calls every MCP tool over SSE against a running server and prints pass/fail per tool.
// usage: node scripts/smoke.mjs http://127.0.0.1:8799 <project> <root_path> [token]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const [origin, project, root, token] = process.argv.slice(2);
const opts = token ? { requestInit: { headers: { authorization: `Bearer ${token}` } }, eventSourceInit: { fetch: (u, i) => fetch(u, { ...i, headers: { ...i?.headers, authorization: `Bearer ${token}` } }) } } : {};
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(new SSEClientTransport(new URL('/sse', origin), opts));

const listed = (await client.listTools()).tools.map((t) => t.name);
const call = async (name, args, check = (r) => !r.isError) => {
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? '';
    const ok = check(r, text);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + text.slice(0, 160)}`);
    return ok ? text : null;
  } catch (e) { console.log(`FAIL  ${name}  -> ${e.message.slice(0, 160)}`); return null; }
};
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };

await call('index_repository', { project, root_path: root });
await call('list_projects', {}, (r, t) => json(t)?.projects?.some((p) => p.name === project));
const found = json(await call('search_graph', { project, query: 'indexFiles', limit: 5 }, (r, t) => json(t)?.results?.length > 0));
const qn = found?.results?.find((x) => x.name === 'indexFiles')?.qualified_name ?? found?.results?.[0]?.qualified_name;
await call('get_architecture', { project }, (r, t) => json(t)?.labels?.length > 0);
await call('trace_path', { project, qualified_name: qn, depth: 2 });
await call('get_code_snippet', { project, qualified_name: qn }, (r, t) => t.length > 20);
await call('search_code', { project, pattern: 'purgeProject' });
await call('get_graph_schema', { project }, (r, t) => json(t)?.populated_edge_types?.length > 0);
await call('index_status', { project });
await call('query_graph', { project, cypher: 'MATCH (n:CodeNode {user_id: $user_id, repo_name: $repo_name}) RETURN count(n) AS c' }, (r, t) => json(t)?.rows?.length > 0 || t.includes('"c"'));
await call('query_graph', { project, cypher: 'MATCH (n:CodeNode {user_id: $user_id, repo_name: $repo_name}) DETACH DELETE n' }, (r, t) => r.isError === true && t.includes('403'));
await call('query_graph', { project, cypher: 'MATCH (n:CodeNode) RETURN count(n) AS c' }, (r, t) => r.isError === true && t.includes('403'));
await call('detect_changes', { project }, (r, t) => json(t)?.clean !== undefined);
await call('manage_adr', { project, action: 'set', id: 'smoke', title: 'Smoke', content: 'smoke ADR' });
await call('manage_adr', { project, action: 'get', id: 'smoke' }, (r, t) => t.includes('smoke'));
await call('manage_adr', { project, action: 'delete', id: 'smoke' });
await call('ingest_traces', { project, edges: [{ from: qn, to: qn, count: 1 }] });
await call('annotate_element', { project, element: qn, note: 'smoke note' });
await call('get_annotations', { project }, (r, t) => t.includes('smoke note'));
await call('annotate_element', { project, element: qn, note: '' });
await call('estimate_cost', { project, qualified_name: qn }, (r, t) => json(t)?.estimated_tokens > 0);
await call('get_llm_settings', {}, (r, t) => !/sk-|api_key"\s*:\s*"[^*"]{8,}/.test(t));
await call('get_usage', {});
await call('snooze_project', { project, months: 3 });
// delete_project guardrails (never actually deletes): dry run, then wrong name / no token must be refused.
await call('delete_project', { project, dry_run: true }, (r, t) => !!json(t)?.delete_token);
await call('delete_project', { project, confirm_name: 'wrong', confirm_phrase: 'yes, delete my repo', delete_token: 'bogus' }, (r) => r.isError === true);
for (const n of ['summarize_symbol', 'ask_flow', 'set_llm_settings']) console.log(`INFO  ${n}  listed=${listed.includes(n)} (needs an LLM; not called)`);
console.log(`\n${listed.length} tools listed: ${listed.join(', ')}`);
await client.close();
