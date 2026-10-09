import path from 'node:path';
import { CALLABLE_KINDS, TYPE_KINDS } from './constants.js';

const posix = (p) => p.split(path.sep).join('/');
const MAX_AMBIGUOUS = 3;
const CALLABLE = new Set(CALLABLE_KINDS);
const TYPES = new Set(TYPE_KINDS);

// Pass 1: turn one file's extraction into nodes plus structural edges.
// Nodes carry a qualified_name of the form <project>.<path parts>.<symbol>; collisions get a ~line suffix.
export function buildFile(project, filePath, extraction, { lang = '' } = {}) {
  const rel = posix(filePath);
  const parts = rel.split('/');
  const fileName = parts.pop();
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const addNode = (n) => { if (!seen.has(n.qualified_name)) { seen.add(n.qualified_name); nodes.push(n); } return n.qualified_name; };

  let parentQn = project;
  addNode({ qualified_name: project, label: 'Project', name: project, file_path: '' });
  let acc = project;
  for (const seg of parts) {
    acc = `${acc}.${seg}`;
    addNode({ qualified_name: acc, label: 'Folder', name: seg, file_path: '' });
    edges.push({ type: 'CONTAINS_FOLDER', from: parentQn, to: acc });
    parentQn = acc;
  }
  const fileQn = `${acc}.${fileName}`;
  addNode({ qualified_name: fileQn, label: 'File', name: fileName, file_path: rel, language: lang });
  edges.push({ type: 'CONTAINS_FILE', from: parentQn, to: fileQn });

  const base = fileName.replace(/\.[^.]+$/, '');
  const root = `${acc}.${base}`;
  const symQn = [];
  const used = new Set();
  const syms = extraction.symbols ?? [];
  syms.forEach((s, i) => {
    const parent = s.parent >= 0 ? symQn[s.parent] : root;
    let qn = `${parent}.${s.name}`;
    if (used.has(qn)) qn = `${qn}~${s.start}`;
    used.add(qn);
    symQn[i] = qn;
    const parentSym = s.parent >= 0 ? syms[s.parent] : null;
    const label = s.kind === 'Function' && parentSym && TYPES.has(parentSym.kind) ? 'Method' : s.kind;
    addNode({
      qualified_name: qn, label, name: s.name, file_path: rel, start_line: s.start, end_line: s.end,
      signature: (s.signature ?? '').slice(0, 300), docstring: (s.doc ?? '').slice(0, 500), language: lang,
    });
    if (parentSym) {
      edges.push({ type: label === 'Method' ? 'DEFINES_METHOD' : 'DEFINES', from: symQn[s.parent], to: qn });
      edges.push({ type: 'MEMBER_OF', from: qn, to: symQn[s.parent] });
    } else {
      edges.push({ type: 'DEFINES', from: fileQn, to: qn });
    }
  });

  routes: for (const r of extraction.routes ?? []) {
    const qn = `${root}.route.${r.method}.${r.path}`;
    if (seen.has(qn)) continue routes;
    addNode({ qualified_name: qn, label: 'Route', name: `${r.method} ${r.path}`, file_path: rel, start_line: r.line, end_line: r.line });
    edges.push({ type: 'DEFINES', from: fileQn, to: qn });
    edges.push({ type: 'HANDLES', from: qn, to: fileQn, handler: r.handler ?? null });
  }

  const pending = (extraction.refs ?? []).map((r) => ({
    ...r, fromQn: r.from >= 0 ? symQn[r.from] : fileQn, filePath: rel,
  }));
  return { fileQn, nodes, edges, pending, imports: extraction.imports ?? [], filePath: rel };
}

// Candidate lookup by simple name. `rows` are {qualified_name,label,name,file_path,owner?}.
export class NameIndex {
  constructor(rows = []) { this.by = new Map(); rows.forEach((r) => this.add(r)); }
  add(r) { const k = r.name; if (!this.by.has(k)) this.by.set(k, []); this.by.get(k).push(r); }
  find(name) { return this.by.get(name) ?? []; }
}

const EXTS = ['', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '/index.js', '/index.ts', '/__init__.py'];

// Resolve relative import strings to indexed file paths. Non-relative imports are external and skipped.
export function resolveImports(filePath, imports, knownFiles) {
  const dir = path.posix.dirname(filePath);
  const out = new Set();
  for (const text of imports) {
    for (const m of text.matchAll(/['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(dir, m[1]));
      for (const e of EXTS) if (knownFiles.has(target + e)) { out.add(target + e); break; }
    }
  }
  return [...out];
}

// Pass 2: resolve refs to edges. Heuristic by design: unique name -> typed edge, ambiguous -> USAGE.
export function linkRefs(pending, index) {
  const edges = [];
  const push = (type, from, to, line, extra = {}) => { if (from !== to) edges.push({ type, from, to, line, ...extra }); };
  for (const r of pending) {
    const all = index.find(r.name);
    if (!all.length) continue;
    const want = r.kind === 'call' ? CALLABLE : TYPES;
    let cands = r.exact ? all : all.filter((c) => want.has(c.label));
    if (!cands.length) continue;
    const local = cands.filter((c) => c.file_path === r.filePath);
    if (local.length) cands = local;
    if (r.recv && r.recv !== 'this' && r.recv !== 'self') {
      const owned = cands.filter((c) => c.owner === r.recv);
      if (owned.length) cands = owned;
    }
    if (r.exact) { cands.slice(0, MAX_AMBIGUOUS).forEach((c) => push('USAGE', r.fromQn, c.qualified_name, r.line)); continue; }
    if (cands.length > 1) { cands.slice(0, MAX_AMBIGUOUS).forEach((c) => push('USAGE', r.fromQn, c.qualified_name, r.line, { ambiguous: true })); continue; }
    const c = cands[0];
    if (r.kind === 'call') push(r.recv && r.recv !== 'this' && r.recv !== 'self' && c.owner !== r.recv ? 'CALL_REFERENCE' : 'CALLS', r.fromQn, c.qualified_name, r.line);
    else if (r.kind === 'heritage') push(r.rel === 'IMPLEMENTS' ? 'IMPLEMENTS' : 'INHERITS', r.fromQn, c.qualified_name, r.line);
    else push('USES_TYPE', r.fromQn, c.qualified_name, r.line);
  }
  return dedupe(edges);
}

export function dedupe(edges) {
  const m = new Map();
  for (const e of edges) { const k = `${e.type}|${e.from}|${e.to}`; if (!m.has(k)) m.set(k, e); }
  return [...m.values()];
}
