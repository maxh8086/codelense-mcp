// Database schema as graph data, so LLM agents can read tables/collections, their structure and
// relationships over MCP. This lives beside the code graph under its own root label (DbSchema) and never
// touches the source database or the user's repo. Only names, types and flags are stored, never row values.

export const SCHEMA_ROOT = 'DbSchema';
export const SCHEMA_LABELS = ['Table', 'Column'];
export const SCHEMA_EDGES = ['HAS_COLUMN', 'REFERENCES'];

// NoSQL schemas are inferred from samples and keep changing, so visibility is deliberately bounded.
export const NOSQL_LIMITS = { sample: 50, maxDepth: 2, maxFields: 60, maxCollections: 200 };

const s = (v, n = 200) => String(v ?? '').slice(0, n);
const clamp = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Math.trunc(+v))) : d);

export function nosqlLimits(conn = {}) {
  return {
    sample: clamp(conn.sample_size, 1, 200, NOSQL_LIMITS.sample),
    maxDepth: clamp(conn.max_depth, 1, 4, NOSQL_LIMITS.maxDepth),
    maxFields: NOSQL_LIMITS.maxFields,
    maxCollections: NOSQL_LIMITS.maxCollections,
  };
}

// ---------- ERD model -> graph rows ----------

export function modelToGraph(model, info = {}) {
  const saved_at = new Date().toISOString();
  const nosql = !!model.nosql;
  const nodes = [];
  const edges = [];
  const ids = new Set();
  for (const t of (model.tables ?? []).slice(0, 2000)) {
    const id = s(t.id, 300);
    if (!id) continue;
    ids.add(id);
    const cols = (t.columns ?? []).slice(0, 400);
    nodes.push({
      label: 'Table', qualified_name: id, name: s(t.name, 200), schema: t.schema ? s(t.schema) : null,
      kind: nosql ? 'collection' : 'table', description: t.description ? s(t.description, 240) : null, domain: t.domain ? s(t.domain, 60) : null,
      column_count: cols.length, source_kind: s(info.source_kind, 20), nosql, saved_at,
    });
    for (const c of cols) {
      const qn = `${id}.${s(c.name, 200)}`;
      nodes.push({
        label: 'Column', qualified_name: qn, name: s(c.name, 200), type: s(c.type, 120), nullable: !!c.nullable, pk: !!c.pk, fk: !!c.fk,
        depth: nosql ? String(c.name).split('.').length - 1 : 0, table: id, saved_at,
      });
      edges.push({ type: 'HAS_COLUMN', from: id, to: qn });
    }
  }
  for (const r of (model.relationships ?? []).slice(0, 5000)) {
    if (!ids.has(r.from) || !ids.has(r.to)) continue;
    edges.push({
      type: 'REFERENCES', from: r.from, to: r.to, name: r.name ? s(r.name, 120) : null,
      from_columns: (r.columns ?? []).map((m) => s(m.from)), to_columns: (r.columns ?? []).map((m) => s(m.to)),
      cardinality: s(r.cardinality, 12), origin: r.inferred ? (r.origin ?? 'inferred_llm') : 'declared',
    });
  }
  return { nodes, edges, saved_at };
}

// ---------- MongoDB: bounded schema inference from samples ----------

const typeOf = (v) => {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  if (typeof v === 'object') return v._bsontype ? String(v._bsontype).toLowerCase() : 'object';
  return typeof v;
};

const singular = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('ses') ? w.slice(0, -2) : w.endsWith('s') ? w.slice(0, -1) : w);
const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');

function inspectCollection(docs, limits) {
  const acc = new Map();
  let truncated = false;
  const note = (path, t) => {
    let e = acc.get(path);
    if (!e) {
      if (acc.size >= limits.maxFields) { truncated = true; return null; }
      e = { types: new Map(), count: 0 }; acc.set(path, e);
    }
    e.types.set(t, (e.types.get(t) ?? 0) + 1);
    e.count += 1;
    return e;
  };
  const walk = (obj, prefix, depth) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      const t = typeOf(v);
      if (t === 'array') {
        const kinds = new Set(v.slice(0, 5).map(typeOf));
        note(path, `array<${[...kinds].slice(0, 2).join('|') || 'empty'}>`);
        if (kinds.has('object')) {
          if (depth < limits.maxDepth) for (const el of v.slice(0, 3)) if (typeOf(el) === 'object') walk(el, `${path}[]`, depth + 1);
          else truncated = true;
        }
      } else {
        note(path, t);
        if (t === 'object') { if (depth < limits.maxDepth) walk(v, path, depth + 1); else truncated = true; }
      }
    }
  };
  for (const d of docs) if (d && typeof d === 'object') walk(d, '', 0);
  const columns = [...acc.entries()].map(([name, e]) => ({
    name,
    type: [...e.types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t).join('|'),
    nullable: e.count < docs.length || e.types.has('null'),
    pk: name === '_id', fk: false,
  })).sort((a, b) => (a.name === '_id' ? -1 : b.name === '_id' ? 1 : a.name.localeCompare(b.name)));
  return { columns, truncated };
}

/** samples: { collectionName: [doc, ...] } -> ERD-shaped model with inferred (name-based) references. */
export function inferMongoModel(samples, limits = NOSQL_LIMITS) {
  const names = Object.keys(samples).slice(0, limits.maxCollections);
  const tables = [];
  let truncated = Object.keys(samples).length > names.length;
  for (const name of names) {
    const { columns, truncated: tr } = inspectCollection(samples[name] ?? [], limits);
    if (tr) truncated = true;
    tables.push({ id: name, schema: null, name, kind: 'collection', columns });
  }
  const lookup = new Map();
  for (const t of tables) { lookup.set(norm(t.name), t.id); lookup.set(norm(singular(t.name)), t.id); }
  const relationships = [];
  const seen = new Set();
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.pk) continue;
      const seg = c.name.split('.').pop();
      const m = /^(.*?)(?:_?ids?|_?refs?)$/i.exec(seg);
      const isRefName = !!m && m[1];
      const looksRef = /objectid/.test(c.type);
      const base = isRefName ? m[1] : looksRef ? seg : null;
      if (!base) continue;
      const target = lookup.get(norm(base)) ?? lookup.get(norm(singular(base)));
      if (!target || target === t.id) continue;
      const key = `${t.id}|${c.name}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      c.fk = true;
      relationships.push({
        id: `${t.id}->${target}:${c.name}`, name: `ref_${c.name}`, from: t.id, to: target, columns: [{ from: c.name, to: '_id' }],
        cardinality: /^array/.test(c.type) ? 'N:M' : 'N:1', inferred: true, origin: 'inferred_name',
      });
    }
  }
  return { tables, relationships, nosql: true, truncated, limits: { sample: limits.sample, max_depth: limits.maxDepth, max_fields: limits.maxFields } };
}

/** Compact, LLM-friendly text digest of a stored/loaded model. */
export function digest(model, maxCols = 25) {
  const lines = [];
  for (const t of model.tables) {
    const cols = t.columns.slice(0, maxCols).map((c) => `${c.name}:${c.type || '?'}${c.pk ? ' PK' : ''}${c.fk ? ' FK' : ''}`).join(', ');
    lines.push(`${t.kind === 'collection' ? 'collection' : 'table'} ${t.id}${t.description ? ` - ${t.description}` : ''}: ${cols}${t.columns.length > maxCols ? ', …' : ''}`);
  }
  for (const r of model.relationships) {
    lines.push(`${r.from}(${(r.columns ?? []).map((c) => c.from).join(',')}) -> ${r.to}(${(r.columns ?? []).map((c) => c.to).join(',')}) ${r.cardinality ?? ''} [${r.origin ?? 'declared'}]`);
  }
  return lines.join('\n');
}
