import React, { useEffect, useState } from 'react';

const api = async (path, opts) => {
  const r = await fetch(`/api/v1${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { extra: j });
  return j;
};
const post = (p, b) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

const KINDS = [
  ['postgres', 'PostgreSQL'], ['mysql', 'MySQL / MariaDB'], ['oracle', 'Oracle'],
  ['odbc', 'ODBC (DSN or connection string)'], ['mongodb', 'MongoDB (sampled, best effort)'], ['sqlite', 'SQLite file'],
];
const DEFAULT_PORT = { postgres: 5432, mysql: 3306, oracle: 1521, mongodb: 27017 };
const EMPTY = { sample_size: '', max_depth: '', id: '', kind: 'postgres', host: '', port: '', database: '', user: '', password: '', service_name: '', connect_string: '', dsn: '', connection_string: '', dialect: 'sqlserver', file: '' };

// Saved connections for ERDs. Passwords are write-only; the server never returns them.
export function ConnectionsPanel() {
  const [list, setList] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api('/erd/connections').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));

  const body = () => {
    const out = { id: f.id.trim(), kind: f.kind };
    const put = (k) => { if (String(f[k]).trim()) out[k] = f[k]; };
    if (['postgres', 'mysql'].includes(f.kind)) ['host', 'database', 'user', 'password'].forEach(put);
    if (f.kind === 'oracle') ['host', 'service_name', 'connect_string', 'user', 'password'].forEach(put);
    if (f.kind === 'odbc') { ['dsn', 'connection_string', 'user', 'password'].forEach(put); out.dialect = f.dialect; }
    if (f.kind === 'sqlite') put('file');
    if (f.kind === 'mongodb') {
      ['host', 'database', 'user', 'password', 'connection_string'].forEach(put);
      if (f.sample_size) out.sample_size = Number(f.sample_size);
      if (f.max_depth) out.max_depth = Number(f.max_depth);
    }
    if (f.port && DEFAULT_PORT[f.kind]) out.port = Number(f.port);
    return out;
  };
  const valid = /^[A-Za-z0-9_-]{1,40}$/.test(f.id.trim()) && (
    (['postgres', 'mysql'].includes(f.kind) && f.host && f.user) ||
    (f.kind === 'oracle' && f.user && (f.connect_string || (f.host && f.service_name))) ||
    (f.kind === 'odbc' && (f.dsn || f.connection_string)) ||
    (f.kind === 'mongodb' && (f.host || f.connection_string) && f.database) ||
    (f.kind === 'sqlite' && f.file));

  const save = async (andTest) => {
    setBusy(true); setMsg('');
    try {
      const b = body();
      await post('/erd/connections', b);
      setF(EMPTY); await load();
      if (andTest) await test(b.id, 'Saved. ');
      else setMsg(`Saved “${b.id}”.`);
    } catch (e) { setMsg(`Could not save: ${e.message}`); } finally { setBusy(false); }
  };
  const test = async (id, prefix = '') => {
    setBusy(true);
    try {
      const r = await post('/erd/connections/test', { id });
      setMsg(r.ok ? `${prefix}“${id}” OK — ${r.tables} tables, ${r.relationships} declared relationships.` : `${prefix}“${id}” failed: ${r.error}`);
    } catch (e) { setMsg(`${prefix}“${id}” failed: ${e.message}`); } finally { setBusy(false); }
  };
  const del = async (id) => {
    if (!window.confirm(`Forget connection “${id}”? The database itself is not touched.`)) return;
    try { await post('/erd/connections/delete', { id }); await load(); setMsg(`Removed “${id}”.`); } catch (e) { setMsg(e.message); }
  };

  const text = (k, label, ph, type = 'text') => <div className="field">{label}<input type={type} value={f[k]} placeholder={ph} autoComplete="off" onChange={(e) => set(k, e.target.value)} /></div>;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <h4>Database connections (read-only)</h4>
      <p className="hint">Used by the ERD tab. Codelense only runs fixed catalog queries inside read-only sessions. As per industry best practice and the AI governance lifecycle, we recommend providing read-only credentials only (a database user with SELECT / catalog rights). Passwords are stored encrypted and never shown again.</p>
      {list === null ? <p className="hint">Loading…</p> : list.length === 0 ? <p className="hint">No saved connections yet.</p> : (
        <div className="conn-list">
          {list.map((c) => (
            <div className="conn-row" key={c.id}>
              <span><b>{c.id}</b> <span className="hint">{c.kind}{c.host ? ` · ${c.host}` : ''}{c.dsn ? ` · DSN ${c.dsn}` : ''}{c.file ? ` · ${c.file}` : ''}{c.has_password ? ' · password set' : ''}</span></span>
              <span><button className="btn ghost" disabled={busy} onClick={() => test(c.id)}>Test</button> <button className="btn ghost" onClick={() => del(c.id)}>Remove</button></span>
            </div>
          ))}
        </div>
      )}
      <h4 style={{ marginTop: 14 }}>Add a connection</h4>
      {text('id', 'Name', 'sales-readonly')}
      <div className="field">Type
        <select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {['postgres', 'mysql'].includes(f.kind) && <>
        {text('host', 'Host', 'db.internal')}
        {text('port', 'Port', String(DEFAULT_PORT[f.kind]))}
        {text('database', 'Database', 'sales')}
      </>}
      {f.kind === 'oracle' && <>
        {text('host', 'Host', 'db.internal')}
        {text('port', 'Port', '1521')}
        {text('service_name', 'Service name', 'FREEPDB1')}
        {text('connect_string', 'or full connect string (optional)', 'host:1521/SERVICE')}
      </>}
      {f.kind === 'odbc' && <>
        {text('dsn', 'DSN', 'MyOdbcDsn')}
        {text('connection_string', 'or full connection string (optional)', 'Driver={ODBC Driver 18 for SQL Server};Server=…')}
        <div className="field">SQL dialect behind the DSN
          <select value={f.dialect} onChange={(e) => set('dialect', e.target.value)}>
            <option value="sqlserver">SQL Server</option><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="oracle">Oracle</option></select></div>
      </>}
      {f.kind === 'mongodb' && <>
        {text('host', 'Host', 'mongo.internal')}
        {text('port', 'Port', '27017')}
        {text('database', 'Database', 'sales')}
        {text('connection_string', 'or full URI (optional, write-only)', 'mongodb://…')}
        {text('max_depth', 'Max nested depth (1–4, default 2)', '2', 'number')}
        {text('sample_size', 'Documents sampled per collection (1–200, default 50)', '50', 'number')}
        <p className="hint">NoSQL schemas change constantly, so codelense samples a few documents and records field names and types down to the depth limit only. Treat it as a guide, not an exhaustive schema.</p>
      </>}
      {f.kind === 'sqlite' && text('file', 'File (inside the server workspace)', 'data/app.db')}
      {f.kind !== 'sqlite' && <>
        {text('user', 'Read-only user', 'readonly_user')}
        {text('password', 'Password (write-only)', '', 'password')}
      </>}
      <button className="btn" disabled={!valid || busy} onClick={() => save(true)}>Save &amp; test</button>{' '}
      <button className="btn ghost" disabled={!valid || busy} onClick={() => save(false)}>Save</button>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
