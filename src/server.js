import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer, runTool } from './mcp.js';
import { indexFiles } from './indexer.js';
import { setMeta } from './tools.js';

// Edges that describe runtime flow; structural edges (DEFINES, MEMBER_OF…) would only clutter a trace.
const FLOW_EDGES = ['CALLS', 'CALL_REFERENCE', 'USAGE', 'IMPLEMENTS', 'INHERITS', 'USES_TYPE'];
const HERE =path.dirname(fileURLToPath(import.meta.url));

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Directory-name listing for the UI folder picker. Read-only, confined to workspace_root.
export async function listDirs(workspaceRoot, requested) {
  const root = await fs.realpath(path.resolve(workspaceRoot));
  const want = requested ? path.resolve(requested) : root;
  let real;
  try { real = await fs.realpath(want); } catch { const e = new Error('path not found'); e.status = 404; throw e; }
  const rel = path.relative(root, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { const e = new Error('path is outside workspace_root'); e.status = 403; throw e; }
  const ents = await fs.readdir(real, { withFileTypes: true });
  const dirs = [];
  for (const d of ents) {
    if (!d.isDirectory() || d.name.startsWith('.') && d.name !== '.git') continue;
    if (d.name === '.git' || d.name === 'node_modules') continue;
    const full = path.join(real, d.name);
    const repo = await fs.stat(path.join(full, '.git')).then(() => true, () => false);
    dirs.push({ name: d.name, path: full, repo });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return { path: real, sep: path.sep, parent: real === root ? null : path.dirname(real), roots: [root], dirs };
}

export function createApp(ctx) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Optional bearer auth: when CODELENSE_TOKEN is set every API and MCP route requires it.
  const guard = (req, res, next) => {
    if (!ctx.cfg.token) return next();
    const h = req.get('authorization') ?? '';
    if (h.startsWith('Bearer ') && safeEqual(h.slice(7), ctx.cfg.token)) return next();
    res.status(401).json({ error: 'missing or invalid bearer token' });
  };
  app.get('/healthz', async (_req, res) => res.json({ ok: true, db: await ctx.db.ping().then(() => true, () => false) }));

  const api = express.Router();
  api.use(guard);
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) { res.status(e.status ?? 500).json({ error: e.message, ...(e.extra ?? {}) }); }
  };
  const tool = (name, pick = (r) => ({ ...r.query, ...r.body })) => wrap((r) => runTool(ctx, name, pick(r)));
  const num = (v) => (v === undefined ? undefined : Number(v));

  api.get('/projects', tool('list_projects'));
  api.get('/graph', wrap(async (r) => {
    const { project, depth, qualified_name } = r.query;
    if (qualified_name) return runTool(ctx, 'trace_path', { project, qualified_name, depth: num(depth) ?? 2 });
    return runTool(ctx, 'search_graph', { project, limit: 100 });
  }));
  api.get('/snippet', tool('get_code_snippet'));
  api.get('/architecture', tool('get_architecture'));
  // Trace in the shape the UI draws: { nodes:[{id,name,file,kind,lane}], edges:[{from,to,type}] }.
  // `symbol` may be a qualified name or a plain name; the first match is the root.
  api.get('/trace', wrap(async (r) => {
    const { project, symbol, qualified_name } = r.query;
    const want = qualified_name ?? symbol;
    if (!project || !want) throw Object.assign(new Error('project and symbol are required'), { status: 400 });
    const u = ctx.tenant.user_id;
    const [start] = await ctx.db.run(
      'MATCH (s:CodeNode {user_id:$u, repo_name:$r}) WHERE s.qualified_name = $q OR s.name = $q RETURN s.qualified_name AS qn, s.name AS name, labels(s) AS labels, s.file_path AS file ORDER BY s.qualified_name = $q DESC LIMIT 1',
      { u, r: project, q: want });
    if (!start) throw Object.assign(new Error(`symbol “${want}” not found in ${project}`), { status: 404 });
    const near = (await runTool(ctx, 'trace_path', { project, qualified_name: start.qn, edge_types: FLOW_EDGES, depth: Math.min(num(r.query.depth) ?? 2, 5) })).nodes;
    const laneOf = (f = '') => (/auth|session|guard|middleware/i.test(f) ? 'CONTROL' : /db|repo|store|model|schema|cache/i.test(f) ? 'PERSISTENCE' : /log|metric|audit|trace/i.test(f) ? 'OBSERVABILITY' : 'ENTRYPOINT');
    const kindOf = (labels = []) => labels.find((l) => l !== 'CodeNode') ?? 'Function';
    const nodes = [start, ...near.filter((n) => n.qualified_name !== start.qn && !n.labels?.includes('File'))].map((n) => {
      const qn = n.qn ?? n.qualified_name; const file = n.file ?? n.file_path ?? '';
      return { id: qn, name: n.name, file, kind: kindOf(n.labels), lane: laneOf(file) };
    });
    const ids = nodes.map((n) => n.id);
    const rows = await ctx.db.run(
      'MATCH (a:CodeNode {user_id:$u, repo_name:$r})-[e]->(b:CodeNode {user_id:$u, repo_name:$r}) WHERE a.qualified_name IN $ids AND b.qualified_name IN $ids AND type(e) IN $types RETURN a.qualified_name AS from, b.qualified_name AS to, type(e) AS type LIMIT 1000',
      { u, r: project, ids, types: FLOW_EDGES });
    return { nodes, edges: rows };
  }));
  api.post('/adr', tool('manage_adr'));
  api.post('/query', tool('query_graph'));
  api.post('/summary', tool('summarize_symbol'));
  api.post('/chat', tool('ask_flow'));
  api.get('/settings', tool('get_llm_settings'));
  api.put('/settings', tool('set_llm_settings'));
  api.post('/settings/test', wrap(async () => ctx.llm.test()));
  api.get('/usage', tool('get_usage'));
  api.post('/projects/delete', tool('delete_project'));
  api.post('/projects/keep', tool('snooze_project'));
  api.post('/annotations', tool('annotate_element'));
  api.get('/annotations', tool('get_annotations'));
  api.get('/sync/status', tool('detect_changes'));
  api.post('/sync/force', tool('index_repository', (r) => ({ ...r.body, force: true })));
  api.post('/sync/auto', tool('index_repository'));
  api.get('/erd/connections', tool('erd_list_connections'));
  api.post('/erd/connections', tool('erd_save_connection'));
  api.post('/erd/connections/delete', tool('erd_delete_connection'));
  api.post('/erd/connections/test', tool('erd_test_connection'));
  api.post('/erd/model', tool('erd_get_model'));
  api.post('/erd/export', tool('erd_export'));
  api.post('/erd/ai', tool('erd_ai_generate'));
  api.post('/erd/save', tool('erd_save_to_index'));
  api.get('/erd/saved', tool('list_db_schemas'));
  api.post('/erd/saved', tool('get_db_schema'));
  api.post('/erd/saved/delete', tool('delete_db_schema'));
  api.post('/erd/saved/table', tool('get_table_relationships'));
  api.get('/fs/list',wrap(async (r) => listDirs(ctx.cfg.workspaceRoot ?? process.cwd(), r.query.path)));

  // Push-sync used by codelense-client: pre-parsed AST for one file.
  api.post('/sync', wrap(async (r) => {
    const { user_id, repo_name, file_path, sha256: hash, ast_json } = r.body ?? {};
    if (!repo_name || !file_path || !ast_json) { const e = new Error('repo_name, file_path and ast_json are required'); e.status = 400; throw e; }
    if (user_id && user_id !== ctx.tenant.user_id) { const e = new Error('user_id does not match token tenant'); e.status = 403; throw e; }
    if (file_path.includes('..') || path.isAbsolute(file_path)) { const e = new Error('file_path must be repo-relative'); e.status = 400; throw e; }
    const ast = typeof ast_json === 'string' ? JSON.parse(ast_json) : ast_json;
    const t = { user_id: ctx.tenant.user_id, repo_name };
    const stats = await indexFiles(ctx.db, t, repo_name, [{ rel: file_path, source: undefined, ast, hash }], { force: false });
    setMeta(ctx, repo_name, { last_sync: Date.now() });
    return stats;
  }));
  // Push-sync of raw source (codelense-client default): the server parses; `deleted` purges one file.
  api.post('/index-file', wrap(async (r) => {
    const { repo_name, file_path, sha256: hash, source, deleted } = r.body ?? {};
    if (!repo_name || !file_path) { const e = new Error('repo_name and file_path are required'); e.status = 400; throw e; }
    if (file_path.includes('..') || path.isAbsolute(file_path)) { const e = new Error('file_path must be repo-relative'); e.status = 400; throw e; }
    const t = { user_id: ctx.tenant.user_id, repo_name };
    if (deleted) { await ctx.db.deleteFile(t, file_path); return { removed: 1 }; }
    if (typeof source !== 'string') { const e = new Error('source is required'); e.status = 400; throw e; }
    const stats = await indexFiles(ctx.db, t, repo_name, [{ rel: file_path, source, hash }], { force: false, grammarsDir: ctx.cfg.grammarsDir });
    setMeta(ctx, repo_name, { last_sync: Date.now() });
    return stats;
  }));
  app.use('/api/v1', api);

  // MCP over SSE.
  const sessions = new Map();
  app.get('/sse', guard, async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    sessions.set(transport.sessionId, transport);
    res.on('close', () => sessions.delete(transport.sessionId));
    await createMcpServer(ctx).connect(transport);
  });
  app.post('/messages', guard, async (req, res) => {
    const t = sessions.get(String(req.query.sessionId));
    if (!t) return res.status(400).json({ error: 'unknown session' });
    await t.handlePostMessage(req, res, req.body);
  });

  // Built admin UI (npm run build in ui/ → src/ui).
  app.use('/ui', express.static(path.join(HERE, 'ui', 'dist')));
  app.get('/', (_req, res) => res.redirect('/ui/'));
  return app;
}
