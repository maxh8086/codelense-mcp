// Compact text renderers for MCP tool output. No dependencies.

const SCALAR_TYPES = new Set(['string', 'number', 'boolean']);

function isScalar(v) {
  return SCALAR_TYPES.has(typeof v);
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function sanitize(s) {
  return s.replace(/[\t\r\n]/g, ' ');
}

export function cell(v) {
  let s;
  if (v === null || v === undefined) s = '';
  else if (Array.isArray(v)) s = v.map((x) => cell(x)).join(',');
  else if (isPlainObject(v)) s = JSON.stringify(v);
  else s = String(v);
  return sanitize(s);
}

export function tsv(rows) {
  if (!rows || rows.length === 0) return '(0 rows)';
  const header = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        header.push(key);
      }
    }
  }
  const lines = [header.join('\t')];
  for (const row of rows) {
    lines.push(header.map((key) => cell(row[key])).join('\t'));
  }
  return lines.join('\n');
}

function isTabularRow(row) {
  if (!isPlainObject(row)) return false;
  return Object.values(row).every(
    (v) => v === null || isScalar(v) || (Array.isArray(v) && v.every(isScalar)),
  );
}

export function renderQueryGraph(out) {
  const rows = out.rows ?? [];
  if (rows.every(isTabularRow)) {
    return tsv(rows) + (out.truncated ? '\n# truncated at 500 rows' : '');
  }
  return JSON.stringify(out);
}

export function renderSearchGraph(out) {
  const body = tsv(
    (out.results ?? []).map((r) => ({
      qualified_name: r.qualified_name,
      labels: r.labels,
      file_path: r.file_path,
      start_line: r.start_line,
    })),
  );
  return out.has_more ? body + `\n# has_more offset=${out.offset + out.limit}` : body;
}

export function renderTrace(out) {
  return tsv(
    (out.nodes ?? []).map((n) => ({
      hops: n.hops,
      qualified_name: n.qualified_name,
      labels: n.labels,
      file_path: n.file_path,
      start_line: n.start_line,
    })),
  );
}

export function renderSearchCode(out) {
  const matches = out.matches ?? [];
  if (matches.length === 0) return '0 matches';
  const lines = matches.map((m) => `${m.file}:${m.line}:${m.text}`);
  let body = lines.join('\n');
  if (out.truncated) body += '\n# truncated, raise limit or narrow pattern';
  return body;
}

export function renderSnippet(out) {
  return `${out.file_path}:${out.start_line}-${out.end_line}\n${out.code}`;
}

export function renderChanges(out) {
  const added = out.added ?? [];
  const modified = out.modified ?? [];
  const removed = out.removed ?? [];
  const gitDirty = out.git_dirty ?? [];

  if (out.clean && gitDirty.length === 0) {
    return 'clean' + (out.head_sha ? ' @' + out.head_sha.slice(0, 7) : '');
  }

  const lines = [];
  for (const p of added) lines.push('A ' + p);
  for (const p of modified) lines.push('M ' + p);
  for (const p of removed) lines.push('D ' + p);
  const listed = new Set([...added, ...modified, ...removed]);
  for (const p of gitDirty) {
    if (!listed.has(p)) lines.push('G ' + p);
  }
  if (out.stale) lines.push('# index is behind: run index_repository');
  return lines.join('\n');
}
