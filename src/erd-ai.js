// Local-LLM ERD enrichment. Only schema metadata (table/column names and types) is sent to the model:
// never row data, never credentials. The caller must use a local LLM (Llm.assertLocal).

export const ERD_SYSTEM_PROMPT =
  'You are a database modelling assistant. You receive only table and column names with types. ' +
  'Reply with ONE JSON object and nothing else, shaped as: ' +
  '{"relationships":[{"from":"SCHEMA.TABLE","to":"SCHEMA.TABLE","from_column":"col","to_column":"col"}],' +
  '"domains":{"Domain name":["SCHEMA.TABLE"]},"descriptions":{"SCHEMA.TABLE":"one short sentence"}}. ' +
  'Only propose relationships that are NOT already declared and are strongly implied by naming ' +
  '(for example orders.customer_id -> customers.id). Use table ids exactly as given.';

// Compact text digest of the model; this is the only thing that leaves the process (to the local model).
export function schemaDigest(model) {
  return model.tables.map((t) => {
    const cols = t.columns.map((c) => `${c.name} ${c.type ?? ''}${c.pk ? ' PK' : ''}${c.fk ? ' FK' : ''}`.trim()).join(', ');
    return `${t.id}: ${cols}`;
  }).join('\n');
}

export function buildPrompt(model) {
  const declared = model.relationships.map((r) => `${r.from} -> ${r.to}`).join('\n') || '(none)';
  return `Tables:\n${schemaDigest(model)}\n\nAlready declared relationships:\n${declared}\n\nReturn the JSON object.`;
}

function extractJson(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// Merge the model's answer into the real model. Anything that does not match real tables/columns is dropped,
// so a small local model cannot invent structure.
export function applyEnrichment(model, text) {
  const out = { ...model, tables: model.tables.map((t) => ({ ...t, columns: t.columns.map((c) => ({ ...c })) })), relationships: [...model.relationships] };
  const parsed = extractJson(text);
  if (!parsed) return { model: out, added: 0, domains: 0, warning: 'model reply was not valid JSON; showing the plain ERD' };
  const byId = new Map(out.tables.map((t) => [t.id.toLowerCase(), t]));
  const find = (id) => byId.get(String(id ?? '').toLowerCase());
  const colOf = (t, name) => t.columns.find((c) => c.name.toLowerCase() === String(name ?? '').toLowerCase());
  const seen = new Set(out.relationships.map((r) => `${r.from}|${r.to}|${r.columns.map((c) => `${c.from}:${c.to}`).join(',')}`.toLowerCase()));
  let added = 0;
  for (const r of Array.isArray(parsed.relationships) ? parsed.relationships.slice(0, 200) : []) {
    const from = find(r?.from), to = find(r?.to);
    if (!from || !to || from === to) continue;
    const fc = colOf(from, r.from_column), tc = colOf(to, r.to_column);
    if (!fc || !tc) continue;
    const key = `${from.id}|${to.id}|${fc.name}:${tc.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fc.fk = true;
    out.relationships.push({ id: `ai_${from.id}_${fc.name}_${to.id}`, name: `inferred_${fc.name}`, from: from.id, to: to.id, columns: [{ from: fc.name, to: tc.name }], cardinality: 'many-to-one', inferred: true });
    added += 1;
  }
  let domains = 0;
  if (parsed.domains && typeof parsed.domains === 'object') {
    for (const [name, ids] of Object.entries(parsed.domains)) {
      if (!Array.isArray(ids)) continue;
      domains += 1;
      for (const id of ids) { const t = find(id); if (t) t.domain = String(name).slice(0, 60); }
    }
  }
  if (parsed.descriptions && typeof parsed.descriptions === 'object') {
    for (const [id, d] of Object.entries(parsed.descriptions)) { const t = find(id); if (t && typeof d === 'string') t.description = d.slice(0, 240); }
  }
  return { model: out, added, domains };
}
