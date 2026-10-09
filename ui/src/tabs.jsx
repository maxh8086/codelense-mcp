import React, { useEffect, useMemo, useState } from 'react';
import './tabs.css';
import { DeleteDialog, StaleReminder, useStale } from './repos.jsx';
import { FolderPicker, AgentCommands, baseName } from './picker.jsx';
import { ConnectionsPanel } from './connections.jsx';

const api = async (path, opts) => {
  const r = await fetch(`/api/v1${path}`, opts);
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json();
};
const post = (path, body) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const DEMO_ARCH = {
  files: 42, symbols: 318, edges: 902, languages: { javascript: 24, typescript: 11, terraform: 4, yaml: 3 },
  labels: { Function: 140, Method: 76, Class: 31, Interface: 18, Type: 29, Route: 12, Resource: 12 },
  edgeTypes: { CALLS: 412, USAGE: 188, IMPORTS: 150, USES_TYPE: 74, INHERITS: 28, IMPLEMENTS: 20, CALL_REFERENCE: 30 },
  packages: [
    { name: 'api', symbols: 96, dependsOn: ['service', 'models'] },
    { name: 'service', symbols: 118, dependsOn: ['db', 'models'] },
    { name: 'db', symbols: 54, dependsOn: ['models'] },
    { name: 'models', symbols: 50, dependsOn: [] },
  ],
  entrypoints: [{ name: 'main', file: 'src/server.js' }, { name: 'POST /orders', file: 'src/api/orders.js' }],
  hotspots: [{ name: 'getConnection', file: 'src/db/pool.js', callers: 31 }, { name: 'validate', file: 'src/service/validate.js', callers: 22 }, { name: 'logger.info', file: 'src/log.js', callers: 19 }],
  adrs: [{ id: 'ADR-001', title: 'Use Neo4j as the graph store' }],
};

function Bars({ data }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return entries.map(([k, v]) => (
    <div className="row" key={k}>
      <span style={{ width: 120 }}>{k}</span>
      <span className="barwrap"><div className="bar" style={{ width: `${(v / max) * 100}%` }} /></span>
      <b>{v}</b>
    </div>
  ));
}

// The server returns arrays of {label,count}; the tab renders keyed maps and tolerates missing sections.
const toMap = (v, k, n) => (Array.isArray(v) ? Object.fromEntries(v.map((x) => [x[k], x[n]])) : v || {});
const sum = (o) => Object.values(o).reduce((s, x) => s + (Number(x) || 0), 0);
function normalizeArch(d) {
  const languages = toMap(d.languages, 'language', 'files');
  const labels = toMap(d.labels, 'label', 'count');
  const edgeTypes = toMap(d.edgeTypes || d.edges, 'type', 'count');
  const structural = new Set(['File', 'Folder', 'Project']);
  return {
    files: d.files ?? labels.File ?? sum(languages),
    symbols: d.symbols ?? sum(Object.fromEntries(Object.entries(labels).filter(([k]) => !structural.has(k)))),
    edges: typeof d.edges === 'number' ? d.edges : sum(edgeTypes),
    languages, labels, edgeTypes,
    packages: (d.packages || []).map((p) => ({ ...p, dependsOn: p.dependsOn || [] })),
    entrypoints: d.entrypoints || [], hotspots: d.hotspots || [], adrs: d.adrs || [],
  };
}

export function ArchitectureTab({ project }) {
  const [a, setA] = useState(DEMO_ARCH);
  const [live, setLive] = useState(false);
  useEffect(() => {
    api(`/architecture?project=${encodeURIComponent(project)}`).then((d) => { setA(normalizeArch(d)); setLive(true); }).catch(() => { setA(DEMO_ARCH); setLive(false); });
  }, [project]);
  return (
    <div className="tab">
      <div className="grid">
        <div className="panel"><h4>Files</h4><div className="stat">{a.files}</div></div>
        <div className="panel"><h4>Symbols</h4><div className="stat">{a.symbols}</div></div>
        <div className="panel"><h4>Edges</h4><div className="stat">{a.edges}</div></div>
        <div className="panel"><h4>Data</h4><div className="stat" style={{ fontSize: 16 }}>{live ? 'live' : 'demo'}</div></div>
      </div>
      <div className="grid" style={{ marginTop: 12 }}>
        <div className="panel"><h4>Languages (files)</h4><Bars data={a.languages} /></div>
        <div className="panel"><h4>Node labels</h4><Bars data={a.labels} /></div>
        <div className="panel"><h4>Edge types</h4><Bars data={a.edgeTypes} /></div>
      </div>
      <div className="grid" style={{ marginTop: 12 }}>
        <div className="panel">
          <h4>Layers / packages</h4>
          <table className="t"><thead><tr><th>Package</th><th>Symbols</th><th>Depends on</th></tr></thead>
            <tbody>{a.packages.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.symbols}</td><td>{p.dependsOn.join(', ') || '—'}</td></tr>)}</tbody></table>
        </div>
        <div className="panel">
          <h4>Entrypoints &amp; routes</h4>
          {a.entrypoints.map((e) => <div className="row" key={e.name}><span>{e.name}</span><span className="muted">{e.file}</span></div>)}
        </div>
        <div className="panel">
          <h4>Hotspots (most callers)</h4>
          {a.hotspots.map((h) => <div className="row" key={h.name}><span>{h.name}<br /><small className="muted">{h.file}</small></span><b>{h.callers}</b></div>)}
        </div>
        <div className="panel">
          <h4>Architecture decisions</h4>
          {a.adrs.map((d) => <div className="row" key={d.id}><span>{d.id}</span><span>{d.title}</span></div>)}
        </div>
      </div>
    </div>
  );
}

export function GraphTab({ trace, laneColor = {}, edgeColor = {}, Swatch }) {
  const lc = (l) => laneColor[l] ?? '#4dd0e1';
  const ec = (t) => edgeColor[t] ?? '#b0b6c3';
  const kinds = useMemo(() => [...new Set(trace.nodes.map((n) => n.kind))], [trace]);
  const types = useMemo(() => [...new Set(trace.edges.map((e) => e.type))], [trace]);
  const lanes = useMemo(() => [...new Set(trace.nodes.map((n) => n.lane))], [trace]);
  const [kindOn, setKindOn] = useState(null);
  const [typeOn, setTypeOn] = useState(null);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const ko = kindOn ?? new Set(kinds);
  const to = typeOn ?? new Set(types);
  const flip = (set, base, setter, v) => { const s = new Set(set); s.has(v) ? s.delete(v) : s.add(v); setter(s); void base; };
  const edges = trace.edges.filter((e) => to.has(e.type));
  const deg = (id) => ({ out: edges.filter((e) => e.from === id).length, inn: edges.filter((e) => e.to === id).length });
  const nodes = trace.nodes.filter((n) => ko.has(n.kind) && n.name.toLowerCase().includes(q.toLowerCase()));
  const byId = new Map(trace.nodes.map((n) => [n.id, n]));
  const neigh = sel ? edges.filter((e) => e.from === sel || e.to === sel) : [];
  return (
    <div className="tab">
      <div className="chips" role="group" aria-label="Filter by node kind">
        {kinds.map((k) => <button key={k} aria-pressed={ko.has(k)} className={`chipbtn ${ko.has(k) ? 'on' : ''}`} onClick={() => flip(ko, kinds, setKindOn, k)}>{k}</button>)}
      </div>
      <div className="chips" role="group" aria-label="Filter by edge type">
        {types.map((k) => <button key={k} aria-pressed={to.has(k)} className={`chipbtn legend ${to.has(k) ? 'on' : ''}`} style={{ '--c': ec(k) }} onClick={() => flip(to, types, setTypeOn, k)}>{Swatch ? <Swatch type={k} /> : <i />}{k}</button>)}
      </div>
      <div className="chips hint" aria-label="Lane legend">
        {lanes.map((l) => <span key={l} className="lane-key" style={{ '--c': lc(l) }}><i />{l}</span>)}
      </div>
      <input type="text" placeholder="Filter nodes" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }} />
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="panel">
          <table className="t"><thead><tr><th>Name</th><th>Kind</th><th>File</th><th>In</th><th>Out</th></tr></thead>
            <tbody>{nodes.map((n) => { const d = deg(n.id); return (
              <tr key={n.id} className={`click ${sel === n.id ? 'sel' : ''}`} onClick={() => setSel(sel === n.id ? null : n.id)}>
                <td><span className="dot" style={{ background: lc(n.lane) }} />{n.name}</td><td>{n.kind}</td><td className="muted">{n.file}</td><td>{d.inn}</td><td>{d.out}</td>
              </tr>); })}</tbody></table>
        </div>
        <div className="panel">
          <h4>Relationships</h4>
          {!sel && <span className="hint">Select a node to see its edges.</span>}
          {neigh.map((e, i) => (
            <div className="row" key={i}>
              <span>{byId.get(e.from)?.name} → {byId.get(e.to)?.name}</span><span className="chip" style={{ borderColor: ec(e.type), color: ec(e.type) }}>{e.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const WRITE_RE = /\b(create|merge|delete|detach|set|remove|drop|call\s+\{?\s*apoc|load\s+csv|foreach)\b/i;
const DEMO_ROWS = [{ name: 'getConnection', callers: 31 }, { name: 'validate', callers: 22 }];

export function QueryTab({ project }) {
  const [cy, setCy] = useState('MATCH (f:Function {repo_name: $repo})<-[:CALLS]-(c)\nRETURN f.name AS name, count(c) AS callers\nORDER BY callers DESC LIMIT 10');
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const run = async () => {
    setErr(''); setOut(null);
    if (WRITE_RE.test(cy)) { setErr('403 Forbidden — query_graph is read-only. Write clauses are rejected.'); return; }
    try { setOut(await post('/query', { project, cypher: cy })); }
    catch (e) {
      if (e.status === 403) setErr('403 Forbidden — query_graph is read-only.');
      else setOut({ demo: true, rows: DEMO_ROWS });
    }
  };
  return (
    <div className="tab">
      <div className="field">Read-only Cypher (tenant filters are applied by the server)
        <textarea className="code" value={cy} onChange={(e) => setCy(e.target.value)} />
      </div>
      <button className="btn" onClick={run}>Run query</button>
      <span className="hint" style={{ marginLeft: 10 }}>Try “CREATE (n)” to see the 403 guard.</span>
      {err && <p className="err">{err}</p>}
      {out && <pre className="out">{out.demo ? '// demo data (server not reachable)\n' : ''}{JSON.stringify(out.rows ?? out, null, 2)}</pre>}
    </div>
  );
}

export function ChatTab({ project }) {
  const [msgs, setMsgs] = useState([{ role: 'bot', text: `Ask anything about ${project}. Answers come from the graph via your configured LLM.` }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim(); if (!t || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: t }]); setText(''); setBusy(true);
    let reply;
    try { reply = (await post('/chat', { project, message: t })).reply; }
    catch { reply = '(demo) The server is not reachable, so no LLM answered. When live, this uses the graph tools and your LLM settings.'; }
    setMsgs((m) => [...m, { role: 'bot', text: reply }]); setBusy(false);
  };
  return (
    <div className="tab">
      <div className="chat">{msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text}</div>)}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="text" value={text} placeholder="e.g. who calls getConnection?" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="btn" disabled={busy} onClick={send}>{busy ? '…' : 'Send'}</button>
      </div>
    </div>
  );
}

export const DEMO_SYNC = [
  { project: 'sample-project', files: 42, indexed: 42, status: 'up to date', last: '2 min ago', days_since_sync: 1 },
  { project: 'infra-terraform', files: 11, indexed: 9, status: 'syncing', last: 'now', days_since_sync: 0 },
  { project: 'legacy-billing', files: 87, indexed: 87, status: 'up to date', last: '4 months ago', days_since_sync: 128 },
];

export function SyncTab({ rows, onDeleted }) {
  const [log, setLog] = useState([]);
  const [del, setDel] = useState(null);
  const { stale, snooze } = useStale(rows);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [auto, setAuto] = useState(true);
  const [pick, setPick] = useState(false);
  const [openBanner, setOpenBanner] = useState(() => { try { return localStorage.getItem('cl.addnew') !== '0'; } catch { return true; } });
  const toggleBanner = () => setOpenBanner((v) => { try { localStorage.setItem('cl.addnew', v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  const add =(l) => setLog((x) => [`${new Date().toLocaleTimeString()}  ${l}`, ...x].slice(0, 30));
  const act = async (p, body, label) => {
    add(`${label}…`);
    try { await post(p, body); add(`${label}: ok`); } catch { add(`${label}: server not reachable (demo)`); }
  };
  return (
    <div className="tab">
      <StaleReminder stale={stale} onDelete={setDel}
        onKeep={(p, m) => { snooze(p, m); add(`Keeping ${p} for ${m} more months`); }} />
      {del && <DeleteDialog row={del} onClose={() => setDel(null)}
        onDeleted={(p, demo) => { setDel(null); add(`Deleted index of ${p}${demo ? ' (demo)' : ''}; source repo untouched`); onDeleted(p); }} />}
      <div className="panel addnew">
        <button className="addnew-head" aria-expanded={openBanner} onClick={toggleBanner}>
          <span>{openBanner ? '▾' : '▸'}</span> <strong>Add new</strong> <span className="chipbtn">Claude</span> <span className="chipbtn">Codex</span>
          <span className="muted" style={{ marginLeft: 'auto' }}>{openBanner ? 'Collapse' : 'Expand'}</span>
        </button>
        {openBanner && (
          <div className="addnew-body">
            <p className="hint">Indexing runs as MCP tools, so ask Claude Code or Codex to do it. Fill in the folder to get ready-to-paste commands (nothing is indexed from this page).</p>
            <div className="field">Folder on the server
              <span className="pathrow">
                <input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/workspace/my-repo" />
                <button className="btn ghost" onClick={() => setPick(true)}>Browse…</button>
              </span></div>
            <div className="field">Project name<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-repo" /></div>
            <AgentCommands path={path} name={name} open />
            {pick && <FolderPicker value={path} onClose={() => setPick(false)}
              onPick={(p) => { setPath(p); if (!name) setName(baseName(p)); setPick(false); }} />}
            <p className="hint">Or run <code>codelense-client</code> next to your code to sync changes automatically.</p>
            <label className="row"><span>Auto-sync (watch daemon)</span>
              <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); act('/sync/auto', { enabled: e.target.checked }, `Auto-sync ${e.target.checked ? 'on' : 'off'}`); }} /></label>
          </div>)}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr', marginTop: 12 }}>
        <div className="panel">
          <h4>Projects</h4>
          <table className="t"><thead><tr><th>Project</th><th>Indexed</th><th>Status</th><th>Last sync</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.project}><td>{r.project}</td><td>{r.indexed}/{r.files}</td>
                <td className={r.status === 'up to date' ? 'ok' : ''}>{r.status}{stale.includes(r) && <span className="chipbtn" style={{ marginLeft: 6 }}>stale</span>}</td><td className="muted">{r.last}</td>
                <td><button className="btn ghost" onClick={() => act('/sync/force', { project: r.project }, `Force re-index ${r.project}`)}>Force</button>{' '}
                  <button className="btn ghost danger-text" onClick={() => setDel(r)}>Delete</button></td></tr>))}
              {!rows.length && <tr><td colSpan="5" className="hint">No repositories indexed. Use "Add new" above.</td></tr>}</tbody></table>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <h4>Activity</h4>
        <div className="log">{log.length ? log.map((l, i) => <div key={i}>{l}</div>) : <span className="hint">No activity yet.</span>}</div>
      </div>
    </div>
  );
}

const GUARDS = [
  ['confirm_tokens', 'Ask before sending more than (tokens)'],
  ['max_input_tokens', 'Hard limit per request (tokens)'],
  ['daily_token_budget', 'Daily token budget'],
  ['max_calls_per_minute', 'Max calls per minute'],
  ['timeout_s', 'Timeout (seconds)'],
];
const DEFAULT_SETTINGS = {
  provider: 'local', base_url: 'http://localhost:11434/v1', model: 'llama3.2:3b-16k',
  guardrails: { confirm_tokens: 50000, max_input_tokens: 100000, daily_token_budget: 500000, max_calls_per_minute: 6, timeout_s: 120 },
  api_key_set: false, local_ready: false,
};

export function SettingsTab() {
  const [s, setS] = useState(DEFAULT_SETTINGS);
  const [llmKey, setLlmKey] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api('/settings').then((r) => setS({ ...DEFAULT_SETTINGS, ...r, guardrails: { ...DEFAULT_SETTINGS.guardrails, ...(r.guardrails || {}) } })).catch(() => {});
  useEffect(() => { load(); }, []);
  const set = (k, v) => setS((o) => ({ ...o, [k]: v }));
  const setG = (k, v) => setS((o) => ({ ...o, guardrails: { ...o.guardrails, [k]: v } }));
  const save = async () => {
    try {
      const r = await api('/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: s.provider, base_url: s.base_url, model: s.model, guardrails: s.guardrails, api_key: llmKey || undefined }) });
      setLlmKey(''); await load();
      setMsg(r && r.local_ready === false && s.provider === 'local' ? 'Saved, but this endpoint is not local, so ERD auto-generation stays disabled.' : 'Saved.');
    } catch (e) { setMsg(`Not saved: ${e.message}`); }
  };
  const test = async () => {
    try { const r = await post('/settings/test', {}); setMsg(r.ok ? 'LLM reachable.' : `LLM test failed: ${r.error}`); }
    catch (e) { setMsg(`LLM test failed: ${e.message}`); }
  };
  return (
    <div className="tab" style={{ maxWidth: 720 }}>
      <ConnectionsPanel />
      <div className="panel" style={{ marginBottom: 12 }}>
        <h4>LLM (OpenAI-compatible) {s.local_ready ? <span className="ok">• local ready</span> : <span className="hint">• local LLM not configured</span>}</h4>
        <div className="field">Provider
          <select value={s.provider} onChange={(e) => set('provider', e.target.value)}>
            <option value="local">Local (Ollama / llama.cpp on this machine)</option><option value="api">API (hosted endpoint)</option></select></div>
        <div className="field">Base URL<input type="text" value={s.base_url} onChange={(e) => set('base_url', e.target.value)} /></div>
        <div className="field">Model<input type="text" value={s.model} onChange={(e) => set('model', e.target.value)} /></div>
        <div className="field">API key (write-only) {s.api_key_set && <span className="ok">• set</span>}
          <input type="password" value={llmKey} placeholder={s.api_key_set ? '••••••••' : 'optional for local Ollama'} onChange={(e) => setLlmKey(e.target.value)} /></div>
        <p className="hint">Database ERD auto-generation only runs against a Local provider, so schema details never leave this machine. Keys are stored encrypted and never read back.</p>
      </div>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h4>Token guardrails (paid sources only)</h4>
        <p className="hint">These limits apply only to a paid remote API (Claude, Codex or similar). They do not apply to a local LLM, or to Claude/Codex calls that generate annotations. Most calls arrive through MCP from the Claude or Codex chat; the same limits apply there. Defaults are conservative; edit freely.</p>
        {GUARDS.map(([k, label]) => <div className="field" key={k}>{label}
          <input type="number" min="1" value={s.guardrails[k]} onChange={(e) => setG(k, e.target.value)} /></div>)}
      </div>
      <button className="btn" onClick={save}>Save</button>{' '}
      <button className="btn ghost" onClick={test}>Test LLM</button>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
