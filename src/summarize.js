import { ROOT_LABEL } from './constants.js';

// Optional "summarize on index": one-paragraph summaries for symbols that have no docstring.
// Local LLM only (never a paid source), capped per run, stored as the node `summary` property.
export const summarizeEnabled = (cfg) => Boolean(cfg?.summarizeOnIndex?.enabled);

export async function summarizeMissing(ctx, project, { limit = 25 } = {}) {
  const rows = await ctx.db.run(
    `MATCH (n:${ROOT_LABEL} {user_id:$u, repo_name:$r}) WHERE n.source <> '' AND coalesce(n.docstring,'') = '' AND n.summary IS NULL AND (n:Function OR n:Method OR n:Class) RETURN n.qualified_name AS qn, n.source AS src LIMIT toInteger($lim)`,
    { u: ctx.tenant.user_id, r: project, lim: limit });
  let summarized = 0, failed = 0;
  for (const { qn, src } of rows) {
    try {
      const out = await ctx.llm.complete(`Summarize this code in one short paragraph.\n\n${src}`, { localOnly: true });
      const text = String(out.text ?? '').trim().slice(0, 500);
      if (!text) { failed++; continue; }
      await ctx.db.run(`MATCH (n:${ROOT_LABEL} {user_id:$u, repo_name:$r, qualified_name:$q}) SET n.summary = $s`, { u: ctx.tenant.user_id, r: project, q: qn, s: text });
      summarized++;
    } catch { failed++; }
  }
  return { summarized, failed, candidates: rows.length };
}
