import React, { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutTrace } from './layout.js';
import { download } from './export.js';

const api = async (path, opts) => {
  const r = await fetch(`/api/v1${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { extra: j });
  return j;
};
const post = (p, b) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

const NODE_W = 240, HEAD = 30, ROW = 22, GAP = 30;
const heightOf = (t) => HEAD + t.columns.length * ROW + 8;

function layoutModel(model) {
  const { pos, width } = layoutTrace(model.tables.map((t) => ({ id: t.id })),
    model.relationships.map((r) => ({ from: r.from, to: r.to })));
  const colY = new Map();
  const out = new Map();
  for (const t of model.tables) {
    const p = pos.get(t.id);
    const y = colY.get(p.x) ?? 40;
    out.set(t.id, { x: p.x, y });
    colY.set(p.x, y + heightOf(t) + GAP);
  }
  return { pos: out, width, height: Math.max(...colY.values()) + 20 };
}

function TableNode({ data }) {
  const t = data.table;
  return (
    <div className={`erd-table${data.dim ? ' dim' : ''}${data.sel ? ' sel' : ''}`} style={{ width: NODE_W }}>
      <Handle type="target" position={Position.Left} />
      <div className="erd-head" title={t.description || undefined}>{t.id}{t.domain && <span className="erd-domain">{t.domain}</span>}</div>
      {t.columns.map((c) => (
        <div className="erd-col" key={c.name} title={c.nullable ? 'nullable' : 'not null'}>
          <span className="erd-badges">{c.pk && <b className="pk">PK</b>}{c.fk && <b className="fk">FK</b>}</span>
          <span className="erd-name">{c.name}</span>
          <span className="erd-type">{c.type}</span>
        </div>
      ))}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function RelEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style }) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      <EdgeLabelRenderer>
        <div className="erd-edge-label" style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}>
          {data.inferred && <i title="inferred by the local LLM">AI </i>}{data.cardinality} · {data.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
const nodeTypes = { table: TableNode };
const edgeTypes = { rel: RelEdge };

function svgOf(model, lay) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const W = lay.width + NODE_W, H = lay.height;
  const edges = model.relationships.map((r) => {
    const a = lay.pos.get(r.from), b = lay.pos.get(r.to);
    const ta = model.tables.find((t) => t.id === r.from);
    if (!a || !b) return '';
    const x1 = a.x + NODE_W, y1 = a.y + heightOf(ta) / 2, x2 = b.x, y2 = b.y + 15;
    const mx = (x1 + x2) / 2;
    return `<g class="edge"><path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#8b7bff" stroke-width="1.5"${r.inferred ? ' stroke-dasharray="6 4"' : ''}/><text x="${mx}" y="${(y1 + y2) / 2 - 4}" font-size="10" fill="#8b7bff" text-anchor="middle">${r.inferred ? 'AI ' : ''}${esc(r.cardinality)} ${esc(r.name || '')}</text></g>`;
  }).join('');
  const nodes = model.tables.map((t) => {
    const p = lay.pos.get(t.id);
    const rows = t.columns.map((c, i) => `<text x="${p.x + 8}" y="${p.y + HEAD + 15 + i * ROW}" font-size="12" fill="#e6edf3">${c.pk ? '🔑 ' : ''}${c.fk ? '↗ ' : ''}${esc(c.name)} <tspan fill="#8b949e">${esc(c.type)}</tspan></text>`).join('');
    return `<g class="table" id="t-${esc(t.id)}"><rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${heightOf(t)}" rx="6" fill="#161b22" stroke="#30363d"/><rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${HEAD}" rx="6" fill="#21262d"/><text x="${p.x + 8}" y="${p.y + 20}" font-size="13" font-weight="600" fill="#ff7a4d">${esc(t.id)}</text>${rows}</g>`;
  }).join('');
  // grouped layers so the SVG is editable: edges, tables
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif"><rect width="100%" height="100%" fill="#0d1117"/><g id="edges">${edges}</g><g id="tables">${nodes}</g></svg>`;
}

// Saved snapshot (graph shape) -> the shape the canvas draws.
const fromSaved = (s) => ({
  tables: s.tables,
  relationships: (s.relationships ?? []).map((r, i) => ({
    id: `${r.from}->${r.to}:${i}`, from: r.from, to: r.to, cardinality: r.cardinality ?? '', name: r.name ?? '',
    columns: r.columns ?? [], inferred: String(r.origin ?? '').startsWith('inferred'),
  })),
});

function Canvas({ model, onMermaid, onCsv }) {
  const [sel, setSel] = useState(null);
  const lay = useMemo(() => layoutModel(model), [model]);
  const linked = useMemo(() => {
    if (!sel) return null;
    const s = new Set([sel]);
    model.relationships.forEach((r) => { if (r.from === sel) s.add(r.to); if (r.to === sel) s.add(r.from); });
    return s;
  }, [sel, model]);
  const nodes = model.tables.map((t) => ({
    id: t.id, type: 'table', position: lay.pos.get(t.id), draggable: false,
    data: { table: t, sel: sel === t.id, dim: linked && !linked.has(t.id) },
  }));
  const edges = model.relationships.map((r) => ({
    id: r.id, source: r.from, target: r.to, type: 'rel',
    data: { cardinality: r.cardinality, label: r.columns.map((c) => c.from).join(','), inferred: r.inferred },
    style: { stroke: '#8b7bff', ...(r.inferred ? { strokeDasharray: '6 4' } : {}), strokeWidth: sel && (r.from === sel || r.to === sel) ? 2.5 : 1.3, opacity: sel && r.from !== sel && r.to !== sel ? 0.2 : 1 },
  }));
  const stat = sel && model.tables.find((t) => t.id === sel);
  const exportSvg = () => download(new Blob([svgOf(model, lay)], { type: 'image/svg+xml' }), 'erd.svg');
  const exportPng = () => {
    const url = URL.createObjectURL(new Blob([svgOf(model, lay)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width * 2; c.height = img.height * 2;
      const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0);
      c.toBlob((b) => download(b, 'erd.png')); URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  return (
    <div className="erd-canvas">
      <div className="erd-toolbar" role="group" aria-label="Export">
        <button className="btn ghost" onClick={exportSvg}>SVG</button>
        <button className="btn ghost" onClick={exportPng}>PNG</button>
        <button className="btn ghost" onClick={onMermaid}>Mermaid</button>
        <button className="btn ghost" onClick={onCsv}>CSV</button>
      </div>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView minZoom={0.2}
        nodesConnectable={false} onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)}>
        <Background /><Controls showInteractive={false} />
      </ReactFlow>
      {stat && (
        <div className="neon-box erd-stats">
          <b>{stat.id}</b> · {stat.columns.length} cols · {stat.columns.filter((c) => c.pk).length} PK ·
          {' '}{model.relationships.filter((r) => r.from === stat.id).length} FK out ·
          {' '}{model.relationships.filter((r) => r.to === stat.id).length} referenced by
        </div>
      )}
    </div>
  );
}

export function ErdTab() {
  const [conns, setConns] = useState(null);
  const [connId, setConnId] = useState('');
  const [localReady, setLocalReady] = useState(false);
  const [model, setModel] = useState(null);
  const [msg, setMsg] = useState('');
  const [approval, setApproval] = useState(null);
  const [busy, setBusy] = useState(false);
  const [authDel, setAuthDel] = useState(false);
  const src = () => ({ connection_id: connId });

  useEffect(() => {
    api('/erd/connections').then((l) => { setConns(l); setConnId((cur) => cur || l[0]?.id || ''); }).catch(() => setConns([]));
    api('/settings').then((s) => setLocalReady(Boolean(s.local_ready))).catch(() => setLocalReady(false));
  }, []);

  // Local-LLM auto-ERD: only table/column names + types go to the model, and the server refuses non-local endpoints.
  const auto = async (extra = {}) => {
    setBusy(true); setMsg('Asking the local LLM…'); setApproval(null);
    try {
      const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('The local LLM did not answer in time. Check that it is running and reachable (Settings → LLM).')), 150_000));
      const r = await Promise.race([post('/erd/ai', { ...src(), ...extra }), slow]);
      if (r.needs_approval) { setApproval(r); setMsg(`Needs approval: about ${r.estimated_tokens.toLocaleString()} tokens (${r.tier}).`); return; }
      if (r.ok === false) { setMsg(r.error); return; }
      setModel(r.model);
      setMsg(`${r.model.tables.length} tables, ${r.model.relationships.length} relationships (${r.inferred_relationships} inferred by local LLM, ${r.domains} domains). Sent to local model only.${r.warning ? ` ${r.warning}.` : ''}${await persist(r.model)}`);
    } catch (e) {
      setMsg(e.extra?.local_llm_required ? `Local LLM required: ${e.message}` : e.message);
    } finally { setBusy(false); }
  };
  const [saved, setSaved] = useState(null);
  // Selecting a connection loads its saved snapshot (history) from the index, if one exists.
  useEffect(() => {
    setSaved(null); setModel(null); setApproval(null); setMsg(''); setAuthDel(false);
    if (!connId) return undefined;
    let live = true;
    post('/erd/saved', { connection_id: connId })
      .then((s) => {
        if (!live) return;
        setModel(fromSaved(s));
        setSaved({ connection_id: connId, tables: s.tables.length, saved_at: s.saved_at, nosql: s.nosql });
        setMsg(`Loaded saved schema: ${s.tables.length} tables.`);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [connId]);
  // Sync up: re-read the live catalog (read-only, no LLM). The result is saved to the index.
  const syncUp = async () => {
    setBusy(true); setMsg('Reading the database catalog…'); setApproval(null);
    try {
      const m = await post('/erd/model', { ...src() });
      setModel(m);
      setMsg(`Synced ${m.tables.length} tables, ${m.relationships.length} relationships from the database.${await persist(m)}`);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const removeSaved = async () => {
    setBusy(true);
    try {
      await post('/erd/saved/delete', { connection_id: connId });
      setSaved(null); setModel(null); setAuthDel(false); setMsg('Saved schema deleted from the index.');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  // Persists the generated schema in the synaptree index (never the source DB) so agents can read it over MCP.
  // Runs automatically after every Sync up / Generate; returns a short status suffix for the message line.
  const persist = async (m) => {
    try {
      const r = await post('/erd/save', { connection_id: connId, model: m });
      setSaved({ connection_id: connId, tables: r.tables, saved_at: r.saved_at, nosql: r.nosql });
      return ` Saved to the index.${r.truncated ? ' NoSQL schema was depth-capped (best effort).' : ''}`;
    } catch (e) { return ` Not saved to the index: ${e.message}`; }
  };
  const exportServer = async (format) => {
    try { const r = await post('/erd/export', { ...src(), format }); download(new Blob([r.content], { type: 'text/plain' }), `erd.${format === 'mermaid' ? 'mmd' : 'csv'}`); }
    catch (e) { setMsg(e.message); }
  };

  return (
    <div className="tab erd-tab">
      <div className="erd-bar">
        <div className="erd-bar-left">
          <select aria-label="Database connection" value={connId} onChange={(e) => setConnId(e.target.value)} disabled={!conns?.length}>
            {!conns?.length && <option value="">{conns ? 'No saved connections' : 'Loading…'}</option>}
            {(conns ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} ({c.kind})</option>)}
          </select>
          <button className="btn ghost" onClick={syncUp} disabled={busy || !connId}
            title="Re-read tables and relationships from the database (read-only, no LLM).">Sync up</button>
          <button className="btn" onClick={() => auto()} disabled={busy || !localReady || !connId}
            title={localReady ? 'Infers missing relationships, domains and descriptions. Local LLM only; no data leaves your machine.' : 'Configure a local LLM (Settings → provider "local", e.g. Ollama) to enable this.'}>
            Generate</button>
        </div>
        <div className="erd-bar-right">
          <span className="del-note">Removes only the saved schema in the synaptree index; your database and repos are not touched.</span>
          <label className="del-auth"><input type="checkbox" checked={authDel} disabled={!saved || busy} onChange={(e) => setAuthDel(e.target.checked)} /> I authorize deletion</label>
          <button className="btn ghost danger" onClick={removeSaved} disabled={busy || !saved || !authDel}
            title="Delete the saved schema from the synaptree index.">Delete</button>
        </div>
      </div>
      <div className="erd-status">
        {conns && !conns.length && <span className="hint">Add a read-only connection under Settings → Database connections, then reload. </span>}
        {saved && <span className="hint">Saved {saved.tables} tables{saved.nosql ? ' (NoSQL, sampled)' : ''} · {String(saved.saved_at).slice(0, 19).replace('T', ' ')}. </span>}
        {approval && <span className="hint">
          <button className="btn" onClick={() => auto({ approval_id: approval.approval_id, send_anyway: approval.tier === 'strong' })}>
            {approval.tier === 'strong' ? 'Send anyway' : 'Approve'}</button>
          {approval.suggested_narrowing && <> {approval.suggested_narrowing[1]}. </>}</span>}
        {msg && <span className="hint">{msg}</span>}
      </div>
      <div className="erd-main">
        {model ? <ReactFlowProvider><Canvas model={model} onMermaid={() => exportServer('mermaid')} onCsv={() => exportServer('csv')} /></ReactFlowProvider>
          : <div className="hint" style={{ padding: 24 }}>Pick a connection: a saved schema loads automatically. Otherwise Sync up (read the database) or Generate (local LLM); the result is saved to the index automatically. Click a table to highlight its relationships.</div>}
      </div>
    </div>
  );
}
