// ERD: build an entity-relationship model from a live database (read-only) or pasted DDL.
// Safety: only the fixed metadata queries below are ever executed; callers cannot supply SQL.
// Drivers (pg, mysql2, oracledb, odbc) are optional dependencies loaded on demand.
import path from 'node:path';
import { nosqlLimits, inferMongoModel } from './schema-graph.js';

export class ErdError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const IDENT = /^[A-Za-z0-9_$#]+$/;

// ---------- model assembly (shared by every source) ----------

const key = (schema, table) => (schema ? `${schema}.${table}` : table);
const truthyNullable = (v) => v === true || v === 1 || /^(y|yes|true|1)$/i.test(String(v ?? ''));

/** raw = { columns:[{sch,tbl,col,typ,nul,pos}], pks:[{sch,tbl,col,pos}], fks:[{fk_name,sch,tbl,col,rsch,rtbl,rcol,pos}] } */
export function assemble(raw) {
  const tables = new Map();
  const get = (sch, tbl) => {
    const id = key(sch, tbl);
    if (!tables.has(id)) tables.set(id, { id, schema: sch ?? null, name: tbl, columns: [] });
    return tables.get(id);
  };
  for (const c of [...raw.columns].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))) {
    get(c.sch, c.tbl).columns.push({ name: c.col, type: c.typ ?? '', nullable: truthyNullable(c.nul), pk: false, fk: false });
  }
  const col = (t, name) => t?.columns.find((x) => x.name === name);
  for (const p of raw.pks) { const c = col(tables.get(key(p.sch, p.tbl)), p.col); if (c) { c.pk = true; c.nullable = false; } }
  const groups = new Map();
  for (const f of [...raw.fks].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))) {
    const gid = `${key(f.sch, f.tbl)}|${f.fk_name ?? ''}|${key(f.rsch, f.rtbl)}`;
    if (!groups.has(gid)) groups.set(gid, { from: key(f.sch, f.tbl), to: key(f.rsch, f.rtbl), name: f.fk_name ?? null, columns: [] });
    groups.get(gid).columns.push({ from: f.col, to: f.rcol });
  }
  const relationships = [];
  for (const g of groups.values()) {
    if (!tables.has(g.from) || !tables.has(g.to)) continue; // reference leaves the selected schemas
    const child = tables.get(g.from);
    for (const m of g.columns) { const c = col(child, m.from); if (c) c.fk = true; }
    const allPk = g.columns.every((m) => col(child, m.from)?.pk) && child.columns.filter((c) => c.pk).length === g.columns.length;
    relationships.push({ id: `${g.from}->${g.to}:${g.name ?? relationships.length}`, name: g.name, from: g.from, to: g.to, columns: g.columns, cardinality: allPk ? '1:1' : 'N:1' });
  }
  return { tables: [...tables.values()].sort((a, b) => a.id.localeCompare(b.id)), relationships };
}

// ---------- Mermaid ----------

const mm = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
export function toMermaid(model) {
  const out = ['erDiagram'];
  for (const t of model.tables) {
    out.push(`  ${mm(t.id)} {`);
    for (const c of t.columns) out.push(`    ${mm(c.type || 'unknown')} ${mm(c.name)}${c.pk ? ' PK' : c.fk ? ' FK' : ''}`);
    out.push('  }');
  }
  for (const r of model.relationships) {
    const right = r.cardinality === '1:1' ? '|o' : 'o{';
    out.push(`  ${mm(r.to)} ||--${right} ${mm(r.from)} : "${(r.name ?? r.columns.map((c) => c.from).join(',')).replace(/"/g, '')}"`);
  }
  return out.join('\n');
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function toCsv(model) {
  const rows = [['table', 'column', 'type', 'nullable', 'pk', 'fk', 'references']];
  for (const t of model.tables) {
    for (const c of t.columns) {
      const r = model.relationships.find((x) => x.from === t.id && x.columns.some((m) => m.from === c.name));
      const ref = r ? `${r.to}.${r.columns.find((m) => m.from === c.name).to}` : '';
      rows.push([t.id, c.name, c.type, c.nullable ? 'Y' : 'N', c.pk ? 'Y' : '', c.fk ? 'Y' : '', ref]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

// ---------- DDL parser (Postgres / MySQL / SQLite / Oracle flavours) ----------

function tokenize(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const toks = [];
  const re = /\s+|'(?:[^']|'')*'|"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_$#][\w$#]*)|(\d+(?:\.\d+)?)|(.)/gy;
  let m;
  while ((m = re.exec(src))) {
    if (/^\s/.test(m[0])) continue;
    if (m[0][0] === "'") toks.push({ t: 'str', v: m[0] });
    else if (m[1] ?? m[2] ?? m[3]) toks.push({ t: 'id', v: m[1] ?? m[2] ?? m[3] });
    else if (m[4]) toks.push({ t: 'word', v: m[4], u: m[4].toUpperCase() });
    else if (m[5]) toks.push({ t: 'num', v: m[5] });
    else toks.push({ t: 'p', v: m[6] });
  }
  return toks;
}

const isP = (t, v) => t?.t === 'p' && t.v === v;
const isW = (t, ...ws) => t?.t === 'word' && ws.includes(t.u);

function splitStatements(toks) {
  const out = [];
  let cur = [];
  let depth = 0;
  for (const t of toks) {
    if (isP(t, '(')) depth++;
    else if (isP(t, ')')) depth--;
    if (depth <= 0 && (isP(t, ';') || isP(t, '/'))) { if (cur.length) out.push(cur); cur = []; depth = 0; } else cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

function readName(toks, i) {
  const parts = [];
  while (toks[i] && (toks[i].t === 'id' || toks[i].t === 'word')) {
    parts.push(toks[i].v); i++;
    if (isP(toks[i], '.')) i++; else break;
  }
  return { schema: parts.length > 1 ? parts[parts.length - 2] : null, name: parts[parts.length - 1], next: i };
}

function readList(toks, i) {
  const names = [];
  if (!isP(toks[i], '(')) return { names, next: i };
  i++;
  let depth = 1;
  let expectName = true;
  while (toks[i] && depth > 0) {
    const t = toks[i];
    if (isP(t, '(')) depth++;
    else if (isP(t, ')')) depth--;
    else if (depth === 1 && isP(t, ',')) expectName = true;
    else if (depth === 1 && expectName && (t.t === 'id' || t.t === 'word')) { names.push(t.v); expectName = false; }
    i++;
  }
  return { names, next: i };
}

function splitTop(toks) {
  const items = [];
  let cur = [];
  let depth = 0;
  for (const t of toks) {
    if (isP(t, '(')) depth++;
    else if (isP(t, ')')) depth--;
    if (depth === 0 && isP(t, ',')) { items.push(cur); cur = []; } else cur.push(t);
  }
  if (cur.length) items.push(cur);
  return items;
}

const TYPE_STOP = new Set(['NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'CHECK', 'GENERATED', 'COLLATE', 'ENABLE', 'DISABLE', 'IDENTITY', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'COMMENT', 'ON', 'VISIBLE', 'INVISIBLE']);

function readReference(toks, i) {
  const n = readName(toks, i);
  const l = readList(toks, n.next);
  return { schema: n.schema, table: n.name, columns: l.names, next: l.next };
}

/** Parse DDL into the same model as a live introspection. Unresolvable references are dropped. */
export function parseDdl(text) {
  const raw = { columns: [], pks: [], fks: [] };
  const pending = [];
  for (const st of splitStatements(tokenize(text))) {
    if (isW(st[0], 'CREATE')) {
      let i = 1;
      while (st[i] && !isW(st[i], 'TABLE')) { if (isW(st[i], 'VIEW', 'INDEX', 'SEQUENCE', 'TRIGGER', 'PROCEDURE', 'FUNCTION', 'TYPE', 'PACKAGE')) { i = -1; break; } i++; }
      if (i < 0 || !st[i]) continue;
      i++;
      if (isW(st[i], 'IF')) i += 3; // IF NOT EXISTS
      const tn = readName(st, i);
      i = tn.next;
      if (!isP(st[i], '(')) continue;
      let depth = 0; let end = i;
      for (; end < st.length; end++) { if (isP(st[end], '(')) depth++; else if (isP(st[end], ')') && --depth === 0) break; }
      const body = splitTop(st.slice(i + 1, end));
      let pos = 0;
      const pkCols = [];
      for (const item of body) {
        let j = 0;
        let cname = null;
        if (isW(item[j], 'CONSTRAINT')) { cname = item[j + 1]?.v ?? null; j += 2; }
        if (isW(item[j], 'PRIMARY')) { pkCols.push(...readList(item, j + 2).names); continue; }
        if (isW(item[j], 'FOREIGN')) {
          const cols = readList(item, j + 2);
          let k = cols.next;
          if (!isW(item[k], 'REFERENCES')) continue;
          const ref = readReference(item, k + 1);
          cols.names.forEach((c, n) => pending.push({ fk_name: cname, sch: tn.schema, tbl: tn.name, col: c, rsch: ref.schema, rtbl: ref.table, rcol: ref.columns[n], pos: n + 1 }));
          continue;
        }
        if (isW(item[j], 'UNIQUE', 'CHECK', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL', 'EXCLUDE', 'PERIOD')) continue;
        if (cname) continue;
        // column definition
        const col = item[j];
        if (!col || (col.t !== 'id' && col.t !== 'word')) continue;
        let k = j + 1;
        let type = '';
        while (item[k] && !(item[k].t === 'word' && TYPE_STOP.has(item[k].u))) {
          if (isP(item[k], '(')) {
            const parts = [];
            let d = 1; k++;
            while (item[k] && d > 0) { if (isP(item[k], '(')) d++; else if (isP(item[k], ')')) { d--; if (!d) break; } parts.push(item[k].v); k++; }
            type += `(${parts.join('').replace(/,/g, ',')})`.replace(/(\d)(CHAR|BYTE)/gi, '$1 $2');
            k++;
          } else { type += (type && !type.endsWith(')') ? ' ' : type ? ' ' : '') + item[k].v; k++; }
        }
        let nullable = true; let pk = false;
        for (; k < item.length; k++) {
          const t = item[k];
          if (isW(t, 'NOT') && isW(item[k + 1], 'NULL')) { nullable = false; k++; }
          else if (isW(t, 'PRIMARY')) { pk = true; k++; }
          else if (isW(t, 'CONSTRAINT')) { cname = item[k + 1]?.v ?? null; k++; }
          else if (isW(t, 'REFERENCES')) {
            const ref = readReference(item, k + 1);
            pending.push({ fk_name: cname, sch: tn.schema, tbl: tn.name, col: col.v, rsch: ref.schema, rtbl: ref.table, rcol: ref.columns[0], pos: 1 });
            k = ref.next - 1;
          } else if (isP(t, '(')) { let d = 1; while (item[++k] && d > 0) { if (isP(item[k], '(')) d++; else if (isP(item[k], ')')) d--; } }
        }
        raw.columns.push({ sch: tn.schema, tbl: tn.name, col: col.v, typ: type, nul: nullable ? 'Y' : 'N', pos: ++pos });
        if (pk) pkCols.push(col.v);
      }
      pkCols.forEach((c, n) => raw.pks.push({ sch: tn.schema, tbl: tn.name, col: c, pos: n + 1 }));
    } else if (isW(st[0], 'ALTER') && isW(st[1], 'TABLE')) {
      let i = 2;
      if (isW(st[i], 'ONLY')) i++;
      const tn = readName(st, i);
      i = tn.next;
      for (; i < st.length; i++) {
        if (!isW(st[i], 'ADD')) continue;
        let j = i + 1;
        let cname = null;
        if (isW(st[j], 'CONSTRAINT')) { cname = st[j + 1]?.v ?? null; j += 2; }
        if (isW(st[j], 'PRIMARY')) readList(st, j + 2).names.forEach((c, n) => raw.pks.push({ sch: tn.schema, tbl: tn.name, col: c, pos: n + 1 }));
        else if (isW(st[j], 'FOREIGN')) {
          const cols = readList(st, j + 2);
          if (!isW(st[cols.next], 'REFERENCES')) continue;
          const ref = readReference(st, cols.next + 1);
          cols.names.forEach((c, n) => pending.push({ fk_name: cname, sch: tn.schema, tbl: tn.name, col: c, rsch: ref.schema, rtbl: ref.table, rcol: ref.columns[n], pos: n + 1 }));
        }
      }
    }
  }
  // Resolve case-insensitively and fill in the default schema of the referenced table (Oracle/PG are not case-consistent in DDL).
  const byLower = new Map();
  for (const c of raw.columns) byLower.set(`${(c.sch ?? '').toLowerCase()}|${c.tbl.toLowerCase()}`, { sch: c.sch, tbl: c.tbl });
  const nameOf = (obj, sch, tbl) => byLower.get(`${(sch ?? obj.sch ?? '').toLowerCase()}|${tbl.toLowerCase()}`) ?? [...byLower.entries()].find(([k]) => k.endsWith(`|${tbl.toLowerCase()}`) && (!sch || k.startsWith(sch.toLowerCase())))?.[1];
  const fixCol = (t, name) => raw.columns.find((c) => c.sch === t.sch && c.tbl === t.tbl && c.col.toLowerCase() === (name ?? '').toLowerCase())?.col ?? name;
  for (const f of pending) {
    const parent = nameOf(f, f.rsch, f.rtbl);
    if (!parent) continue;
    // a column-level REFERENCES without a column list points at the parent's primary key
    const rcol = f.rcol ?? raw.pks.find((p) => p.sch === parent.sch && p.tbl === parent.tbl && p.pos === f.pos)?.col;
    raw.fks.push({ ...f, rsch: parent.sch, rtbl: parent.tbl, rcol: fixCol(parent, rcol), col: fixCol(f, f.col) });
  }
  if (!raw.columns.length) throw new ErdError(400, 'No CREATE TABLE statements found in the DDL');
  return assemble(raw);
}

// ---------- fixed metadata SQL (never user-supplied) ----------

const DIALECTS = ['postgres', 'mysql', 'sqlserver', 'oracle'];

function schemaFilter(dialect, col, schemas) {
  for (const s of schemas) if (!IDENT.test(s)) throw new ErdError(400, `invalid schema name: ${s}`);
  if (schemas.length) return `${col} IN (${schemas.map((s) => `'${s}'`).join(',')})`;
  if (dialect === 'postgres') return `${col} NOT IN ('pg_catalog','information_schema') AND ${col} NOT LIKE 'pg\\_toast%'`;
  if (dialect === 'mysql') return `${col} = DATABASE()`;
  if (dialect === 'sqlserver') return `${col} NOT IN ('sys','INFORMATION_SCHEMA')`;
  return `${col} = SYS_CONTEXT('USERENV','CURRENT_SCHEMA')`;
}

export function metadataSql(dialect, schemas = []) {
  if (!DIALECTS.includes(dialect)) throw new ErdError(400, `unsupported dialect: ${dialect}`);
  const f = (c) => schemaFilter(dialect, c, schemas);
  if (dialect === 'oracle') {
    return {
      columns: `SELECT c.OWNER AS sch, c.TABLE_NAME AS tbl, c.COLUMN_NAME AS col,
        CASE WHEN c.DATA_TYPE = 'NUMBER' AND c.DATA_PRECISION IS NOT NULL THEN 'NUMBER(' || c.DATA_PRECISION || CASE WHEN NVL(c.DATA_SCALE,0) > 0 THEN ',' || c.DATA_SCALE END || ')'
             WHEN c.DATA_TYPE IN ('VARCHAR2','NVARCHAR2','CHAR','NCHAR') THEN c.DATA_TYPE || '(' || NVL(c.CHAR_LENGTH, c.DATA_LENGTH) || ')'
             ELSE c.DATA_TYPE END AS typ,
        c.NULLABLE AS nul, c.COLUMN_ID AS pos
        FROM ALL_TAB_COLUMNS c JOIN ALL_TABLES t ON t.OWNER = c.OWNER AND t.TABLE_NAME = c.TABLE_NAME WHERE ${f('c.OWNER')}`,
      pks: `SELECT cc.OWNER AS sch, cc.TABLE_NAME AS tbl, cc.COLUMN_NAME AS col, cc.POSITION AS pos
        FROM ALL_CONSTRAINTS k JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = k.OWNER AND cc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.CONSTRAINT_TYPE = 'P' AND ${f('k.OWNER')}`,
      fks: `SELECT k.CONSTRAINT_NAME AS fk_name, cc.OWNER AS sch, cc.TABLE_NAME AS tbl, cc.COLUMN_NAME AS col,
        rc.OWNER AS rsch, rc.TABLE_NAME AS rtbl, rc.COLUMN_NAME AS rcol, cc.POSITION AS pos
        FROM ALL_CONSTRAINTS k
        JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = k.OWNER AND cc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        JOIN ALL_CONS_COLUMNS rc ON rc.OWNER = k.R_OWNER AND rc.CONSTRAINT_NAME = k.R_CONSTRAINT_NAME AND rc.POSITION = cc.POSITION
        WHERE k.CONSTRAINT_TYPE = 'R' AND ${f('k.OWNER')}`,
    };
  }
  if (dialect === 'mysql') {
    return {
      columns: `SELECT c.TABLE_SCHEMA AS sch, c.TABLE_NAME AS tbl, c.COLUMN_NAME AS col, c.COLUMN_TYPE AS typ, c.IS_NULLABLE AS nul, c.ORDINAL_POSITION AS pos
        FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
        WHERE ${f('c.TABLE_SCHEMA')}`,
      pks: `SELECT TABLE_SCHEMA AS sch, TABLE_NAME AS tbl, COLUMN_NAME AS col, ORDINAL_POSITION AS pos
        FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_NAME = 'PRIMARY' AND ${f('TABLE_SCHEMA')}`,
      fks: `SELECT CONSTRAINT_NAME AS fk_name, TABLE_SCHEMA AS sch, TABLE_NAME AS tbl, COLUMN_NAME AS col,
        REFERENCED_TABLE_SCHEMA AS rsch, REFERENCED_TABLE_NAME AS rtbl, REFERENCED_COLUMN_NAME AS rcol, ORDINAL_POSITION AS pos
        FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME IS NOT NULL AND ${f('TABLE_SCHEMA')}`,
    };
  }
  const colSql = `SELECT c.table_schema AS sch, c.table_name AS tbl, c.column_name AS col,
        CASE WHEN c.character_maximum_length IS NOT NULL AND c.character_maximum_length > 0 THEN c.data_type || '(' || c.character_maximum_length || ')'
             WHEN c.data_type IN ('numeric','decimal') AND c.numeric_precision IS NOT NULL THEN c.data_type || '(' || c.numeric_precision || ',' || COALESCE(c.numeric_scale,0) || ')'
             ELSE c.data_type END AS typ,
        c.is_nullable AS nul, c.ordinal_position AS pos
        FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE ${f('c.table_schema')}`;
  const pkSql = `SELECT kcu.table_schema AS sch, kcu.table_name AS tbl, kcu.column_name AS col, kcu.ordinal_position AS pos
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY' AND ${f('kcu.table_schema')}`;
  if (dialect === 'sqlserver') {
    return {
      columns: colSql.replace(/ \|\| /g, ' + ').replace(/c\.character_maximum_length > 0/, 'c.character_maximum_length > 0'),
      pks: pkSql,
      fks: `SELECT fk.name AS fk_name, SCHEMA_NAME(pt.schema_id) AS sch, pt.name AS tbl, pc.name AS col,
        SCHEMA_NAME(rt.schema_id) AS rsch, rt.name AS rtbl, rc.name AS rcol, fkc.constraint_column_id AS pos
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id
        JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
        JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
        JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE ${f('SCHEMA_NAME(pt.schema_id)')}`,
    };
  }
  // postgres: pg_constraint keeps composite keys ordered correctly (information_schema does not)
  return {
    columns: colSql,
    pks: pkSql,
    fks: `SELECT c.conname AS fk_name, ns.nspname AS sch, cl.relname AS tbl, a.attname AS col,
        fns.nspname AS rsch, fcl.relname AS rtbl, fa.attname AS rcol, k.ord AS pos
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        JOIN pg_class fcl ON fcl.oid = c.confrelid JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
        CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(att, fatt, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.att
        JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = k.fatt
        WHERE c.contype = 'f' AND ${f('ns.nspname')}`,
  };
}

// Defence in depth: refuse anything that is not a plain SELECT before it reaches a driver.
export function assertReadOnlySql(sql) {
  const s = sql.trim();
  if (!/^(select|with)\b/i.test(s) || /;\s*\S/.test(s) || /\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke|exec|call)\b/i.test(s.replace(/'[^']*'/g, ''))) {
    throw new ErdError(403, 'ERD only runs read-only metadata queries');
  }
}

// ---------- connections ----------

const lower = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), typeof v === 'bigint' ? Number(v) : v])));

async function load(pkg) {
  try { return await import(pkg); } catch { throw new ErdError(501, `Driver "${pkg}" is not installed. Run: npm install ${pkg}`); }
}

const braces = (v) => `{${String(v).replace(/}/g, '}}')}}`;

/** Open a read-only session. Returns { run(sql) -> rows[], close() }. Passwords are only ever used here. */
export async function openConnection(conn, { workspaceRoot = process.cwd() } = {}) {
  const need = (...ks) => { for (const k of ks) if (!conn[k]) throw new ErdError(400, `connection: ${k} is required`); };
  switch (conn.kind) {
    case 'postgres': {
      need('host', 'database', 'user');
      const pg = await load('pg');
      const client = new (pg.default ?? pg).Client({ host: conn.host, port: conn.port || 5432, database: conn.database, user: conn.user, password: conn.password, connectionTimeoutMillis: 10_000 });
      await client.connect();
      await client.query('BEGIN READ ONLY');
      return { run: async (sql) => (await client.query(sql)).rows, close: () => client.end() };
    }
    case 'mysql': {
      need('host', 'database', 'user');
      const my = await load('mysql2/promise');
      const c = await (my.default ?? my).createConnection({ host: conn.host, port: conn.port || 3306, database: conn.database, user: conn.user, password: conn.password, connectTimeout: 10_000 });
      await c.query('SET SESSION TRANSACTION READ ONLY');
      return { run: async (sql) => (await c.query(sql))[0], close: () => c.end() };
    }
    case 'oracle': {
      need('user');
      const connectString = conn.connect_string || (conn.host && conn.service_name ? `${conn.host}:${conn.port || 1521}/${conn.service_name}` : null);
      if (!connectString) throw new ErdError(400, 'connection: provide connect_string or host + service_name');
      const ora = await load('oracledb'); // Thin mode (no Oracle Client install needed)
      const o = ora.default ?? ora;
      const c = await o.getConnection({ user: conn.user, password: conn.password, connectString });
      await c.execute('SET TRANSACTION READ ONLY');
      return { run: async (sql) => (await c.execute(sql, [], { outFormat: o.OUT_FORMAT_OBJECT })).rows, close: () => c.close() };
    }
    case 'odbc': {
      const cs = conn.connection_string || (conn.dsn ? `DSN=${conn.dsn};${conn.user ? `UID=${braces(conn.user)};` : ''}${conn.password ? `PWD=${braces(conn.password)};` : ''}` : null);
      if (!cs) throw new ErdError(400, 'connection: provide connection_string or dsn');
      const odbc = await load('odbc');
      const c = await (odbc.default ?? odbc).connect(cs);
      return { run: async (sql) => [...(await c.query(sql))], close: () => c.close() };
    }
    case 'sqlite': {
      need('file');
      const root = path.resolve(workspaceRoot);
      const file = path.resolve(root, conn.file);
      if (file !== root && !file.startsWith(root + path.sep)) throw new ErdError(403, 'sqlite file must be inside the workspace root');
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(file, { readOnly: true });
      return { sqlite: db, run: async () => { throw new ErdError(400, 'sqlite uses pragmas'); }, close: () => db.close() };
    }
    case 'mongodb': {
      const uri = conn.connection_string || (conn.host ? `mongodb://${conn.user ? `${encodeURIComponent(conn.user)}:${encodeURIComponent(conn.password ?? '')}@` : ''}${conn.host}:${conn.port || 27017}/${conn.database ?? ''}` : null);
      if (!uri) throw new ErdError(400, 'connection: provide connection_string or host');
      const dbName = conn.database || new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.replace(/^\//, '');
      if (!dbName) throw new ErdError(400, 'connection: database is required');
      const mongo = await load('mongodb');
      const client = new (mongo.MongoClient ?? mongo.default.MongoClient)(uri, { serverSelectionTimeoutMS: 10_000, readPreference: 'secondaryPreferred' });
      await client.connect();
      const d = client.db(dbName);
      return {
        mongo: {
          names: async () => (await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')),
          sample: (name, n) => d.collection(name).aggregate([{ $sample: { size: n } }], { allowDiskUse: false }).toArray(),
        },
        run: async () => { throw new ErdError(400, 'mongodb is sampled, not queried with SQL'); },
        close: () => client.close(),
      };
    }
    default:
      throw new ErdError(400, `unsupported kind: ${conn.kind}`);
  }
}

// NoSQL: bounded, best-effort. Only $sample reads; names and types are kept, values are dropped immediately.
async function mongoModel(m, conn) {
  const limits = nosqlLimits(conn);
  const all = await m.names();
  const samples = {};
  for (const name of all.slice(0, limits.maxCollections)) samples[name] = await m.sample(name, limits.sample);
  const model = inferMongoModel(samples, limits);
  if (all.length > limits.maxCollections) model.truncated = true;
  return model;
}

function sqliteRaw(db) {
  const raw = { columns: [], pks: [], fks: [] };
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const { name } of tables) {
    const q = `"${name.replace(/"/g, '""')}"`;
    for (const c of db.prepare(`PRAGMA table_info(${q})`).all()) {
      raw.columns.push({ sch: null, tbl: name, col: c.name, typ: c.type, nul: c.notnull ? 'N' : 'Y', pos: c.cid + 1 });
      if (c.pk) raw.pks.push({ sch: null, tbl: name, col: c.name, pos: c.pk });
    }
    for (const f of db.prepare(`PRAGMA foreign_key_list(${q})`).all()) {
      raw.fks.push({ fk_name: `fk_${name}_${f.id}`, sch: null, tbl: name, col: f.from, rsch: null, rtbl: f.table, rcol: f.to, pos: f.seq + 1 });
    }
  }
  return raw;
}

/** Introspect a saved connection. `open` is injectable for tests. */
export async function introspect(conn, schemas = [], opts = {}) {
  const session = await (opts.open ?? openConnection)(conn, opts);
  try {
    if (session.mongo) return await mongoModel(session.mongo, conn);
    if (session.sqlite) return assemble(sqliteRaw(session.sqlite));
    const dialect = conn.kind === 'odbc' ? conn.dialect : conn.kind;
    const q = metadataSql(dialect, schemas);
    const raw = {};
    for (const k of ['columns', 'pks', 'fks']) { assertReadOnlySql(q[k]); raw[k] = lower(await session.run(q[k])); }
    return assemble(raw);
  } finally {
    await session.close?.();
  }
}

export const publicConnection = (c) => {
  const { password, secret, ...rest } = c;
  return { ...rest, has_password: rest.kind !== 'sqlite' && !!(password || secret) };
};
