import fs from 'node:fs/promises';
import path from 'node:path';
import { estimateTokens } from './llm.js';

// "Tokens saved" is an ESTIMATE of the files an agent would open without the graph.
//   response = estimateTokens(JSON of the tool result)
//   baseline = estimated tokens (~4 chars/token, from file size) of the distinct files the result touches
//   saved    = max(0, baseline - response)
// Only successful MCP tool calls are recorded; failures never reach record().

const day = () => new Date().toISOString().slice(0, 10);
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

// Which repo-relative files would an agent have read to answer this call?
const FILES = {
  get_code_snippet: async (_ctx, _a, out) => [out?.file_path],
  search_graph: async (_ctx, _a, out) => (out?.results ?? []).map((r) => r.file_path),
  trace_path: async (_ctx, _a, out) => (out?.nodes ?? []).map((r) => r.file_path),
  get_architecture: async (ctx, a) => (await ctx.db.run(
    'MATCH (f:File {user_id:$u, repo_name:$r}) RETURN f.file_path AS file_path', { u: ctx.tenant.user_id, r: a.project })).map((r) => r.file_path),
};
export const TRACKED = Object.keys(FILES);

async function fileTokens(root, rel) {
  const full = path.resolve(root, rel);
  if (full !== path.resolve(root) && !full.startsWith(path.resolve(root) + path.sep)) return 0;
  try { return Math.ceil((await fs.stat(full)).size / 4); } catch { return 0; }
}

export async function measure(ctx, name, args, out) {
  const pick = FILES[name];
  if (!pick) return null;
  const root = ctx.store.get('projects', {})[`${ctx.tenant.user_id}/${args.project}`]?.root;
  let baseline = 0;
  if (root) {
    const files = uniq(await pick(ctx, args, out));
    baseline = (await Promise.all(files.map((f) => fileTokens(root, f)))).reduce((s, n) => s + n, 0);
  }
  const response = estimateTokens(JSON.stringify(out));
  return { response, baseline, saved: Math.max(0, baseline - response) };
}

export function record(ctx, name, m, d = day()) {
  ctx.store.update('token_savings', (all) => {
    const t = ((all[d] ??= {})[name] ??= { calls: 0, response: 0, baseline: 0, saved: 0 });
    t.calls += 1; t.response += m.response; t.baseline += m.baseline; t.saved += m.saved;
    return all;
  });
}

// Measurement must never break a tool call.
export async function track(ctx, name, args, out) {
  try { const m = await measure(ctx, name, args, out); if (m) record(ctx, name, m); } catch { /* estimate only */ }
}

const total = (by) => Object.values(by).reduce((s, t) => ({
  calls: s.calls + t.calls, response: s.response + t.response, baseline: s.baseline + t.baseline, saved: s.saved + t.saved,
}), { calls: 0, response: 0, baseline: 0, saved: 0 });

export function savingsSummary(store, d = day(), history = 14) {
  const all = store.get('token_savings', {});
  const by_tool = all[d] ?? {};
  return {
    day: d, ...total(by_tool), by_tool,
    estimate: 'files an agent would open without the graph (~4 chars/token)',
    history: Object.keys(all).sort().slice(-history).map((k) => ({ day: k, ...total(all[k]) })),
  };
}
