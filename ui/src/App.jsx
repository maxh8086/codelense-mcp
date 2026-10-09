import React, { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath, MarkerType, ControlButton, useReactFlow,
} from '@xyflow/react';
import { DEMO_TRACE, makeBig } from './demo.js';
const BIG = Number(new URLSearchParams(location.search).get('big')) || 0;
const START = BIG ? makeBig(BIG) : DEMO_TRACE;
import { layoutTrace } from './layout.js';
import { toMermaid, toPng, toSvg, toCsv, download } from './export.js';
import { ErdTab } from './erd.jsx';
import { AskPanel } from './ask.jsx';
import { GraphTab, ArchitectureTab, QueryTab, ChatTab, SyncTab, SettingsTab, DEMO_SYNC } from './tabs.jsx';

const LANE_COLOR = {
  ENTRYPOINT: '#ff7a4d',
  CONTROL: '#ff9a3c',
  PERSISTENCE: '#8b7bff',
  OBSERVABILITY: '#3ddc97',
  BUILD: '#4dd0e1',
};
const EDGE_COLOR = {
  CALLS: '#ff7a4d',
  CALL_REFERENCE: '#4dd0e1',
  USAGE: '#8b7bff',
  IMPLEMENTS: '#3ddc97',
  INHERITS: '#3ddc97',
  USES_TYPE: '#b0b6c3',
};
// Distinct line patterns so edge types are told apart without relying on colour.
const EDGE_DASH = {
  CALLS: '6 6',
  CALL_REFERENCE: '2 5',
  USAGE: '10 4 2 4',
  IMPLEMENTS: '14 5',
  INHERITS: '0',
  USES_TYPE: '1 4',
};
const dashOf = (t) => EDGE_DASH[t] ?? '6 6';
const colorOf = (lane) => LANE_COLOR[lane] ?? '#4dd0e1';
const Swatch = ({ type }) => (
  <svg width="26" height="6" aria-hidden="true" style={{ flex: 'none' }}>
    <line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray={dashOf(type)} />
  </svg>
);

function CardNode({ data, selected }) {
  const c = colorOf(data.lane);
  return (
    <div className={`card${selected ? ' sel' : ''}`} style={{ '--c': c }}>
      <Handle type="target" position={Position.Left} />
      <div className="card-lane">{data.lane}</div>
      <div className="card-title">
        <span className="card-ico">{data.kind === 'Method' ? '◇' : '◆'}</span>
        {data.name}
      </div>
      <div className="card-sub">{data.file}</div>
      <span className="card-tag">{data.kind}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function LaneNode({ data }) {
  return (
    <div className="stage">
      <span className="stage-dot" />
      {data.label}
    </div>
  );
}

// Orthogonal edge with a dashed "marching" stroke plus a travelling dot, so
// direction of the call is visible at a glance.
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }) {
  const [path, lx, ly] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, offset: 0, centerX: sourceX + 40 + (data.lane % 4) * 14,
  });
  const color = EDGE_COLOR[data.type] ?? '#b0b6c3';
  const dur = `${data.dur}s`;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd}
        style={{ stroke: color, strokeWidth: 2, strokeDasharray: dashOf(data.type), animation: data.calm ? 'none' : `march ${data.dur / 2}s linear infinite`, opacity: data.dim ? 0.15 : 0.9 }} />
      {!data.dim && !data.calm && (
        <circle r="3.5" fill={color}>
          <animateMotion dur={dur} repeatCount="indefinite" path={path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        {data.showLabel && <div className="edge-label" style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`, borderColor: color, color }}>
          {data.type}
        </div>}
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { card: CardNode, lane: LaneNode };
const edgeTypes = { flow: FlowEdge };

function build(trace, selected, selEdge) {
  const { pos, width, height } = layoutTrace(trace.nodes, trace.edges);
  const related = new Set();
  if (selEdge != null && trace.edges[selEdge]) {
    related.add(trace.edges[selEdge].from); related.add(trace.edges[selEdge].to);
  } else if (selected) {
    related.add(selected);
    for (const e of trace.edges) if (e.from === selected || e.to === selected) { related.add(e.from); related.add(e.to); }
  }
  const focus = selected || selEdge != null;
  const nodes = [
    { id: 'stage', type: 'lane', position: { x: 0, y: 0 }, data: { label: trace.title },
      width, height, style: { width, height }, draggable: false, selectable: false, zIndex: -1 },
    ...trace.nodes.map((n) => ({
      id: n.id, type: 'card', position: pos.get(n.id), data: n, width: 220, height: 76,
      ariaLabel: `${n.kind} ${n.name}, ${n.lane}, ${n.file}. Enter to select, double-click to re-root.`,
      style: { opacity: focus && !related.has(n.id) ? 0.35 : 1 },
    })),
  ];
  const edges = trace.edges.map((e, i) => {
    const hot = selEdge != null ? i === selEdge : (!selected || e.from === selected || e.to === selected);
    return {
      id: `e${i}`, source: e.from, target: e.to, type: 'flow',
      ariaLabel: `${e.type} from ${trace.nodes.find((n) => n.id === e.from)?.name ?? e.from} to ${trace.nodes.find((n) => n.id === e.to)?.name ?? e.to}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR[e.type] ?? '#b0b6c3', width: 18, height: 18 },
      data: { type: e.type, dur: 2.4, dim: !hot, calm: !focus || !hot, lane: i, showLabel: focus && hot },
    };
  });
  return { nodes, edges };
}

// Clears any node/edge selection and re-fits the view; sits with the zoom controls.
function ResetButton({ onReset }) {
  const { fitView } = useReactFlow();
  return (
    <ControlButton onClick={() => { onReset(); fitView({ padding: 0.12, duration: 300 }); }} title="Reset selection and view" aria-label="Reset selection and view">
      <span style={{ fontSize: 14, lineHeight: 1 }}>⟲</span>
    </ControlButton>
  );
}

function countBy(list, key) {
  const m = {};
  for (const x of list) m[key(x)] = (m[key(x)] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

// Neon stats box shown on the right of the trace canvas for the selected node or edge.
function Inspector({ trace, selected, selEdge, onClose, onPick, onReroot, project, live }) {
  const [code, setCode] = useState(null);
  useEffect(() => { setCode(null); }, [selected, selEdge]);
  const byId = new Map(trace.nodes.map((n) => [n.id, n]));
  const edge = selEdge != null ? trace.edges[selEdge] : null;
  const node = !edge && selected ? byId.get(selected) : null;
  if (!edge && !node) return null;

  const viewCode = async () => {
    if (code) { setCode(null); return; }
    if (!live) { setCode(`// demo data: no backend connected.\n// Live mode shows the source of ${node.name} from ${node.file}.`); return; }
    setCode('Loading…');
    try {
      const r = await fetch(`/api/v1/snippet?project=${encodeURIComponent(project)}&symbol=${encodeURIComponent(node.id)}`);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      setCode(j.code ?? j.snippet ?? JSON.stringify(j, null, 2));
    } catch (e) { setCode(`Could not load snippet (${e.message})`); }
  };

  let color; let head; let sub; let rows; let stats;
  if (edge) {
    const a = byId.get(edge.from); const b = byId.get(edge.to);
    const parallel = trace.edges.filter((e) => e.from === edge.from && e.to === edge.to).length;
    color = EDGE_COLOR[edge.type] ?? '#b0b6c3';
    head = edge.type; sub = 'relationship';
    stats = [['Same-pair edges', parallel], ['Source fan-out', trace.edges.filter((e) => e.from === edge.from).length], ['Target fan-in', trace.edges.filter((e) => e.to === edge.to).length]];
    rows = [['from', a, edge.from], ['to', b, edge.to]];
  } else {
    const ins = trace.edges.filter((e) => e.to === node.id);
    const outs = trace.edges.filter((e) => e.from === node.id);
    color = colorOf(node.lane);
    head = node.name; sub = `${node.kind} · ${node.lane}`;
    stats = [['Callers (in)', ins.length], ['Callees (out)', outs.length], ['Connected', new Set([...ins.map((e) => e.from), ...outs.map((e) => e.to)]).size]];
    rows = [
      ...ins.map((e) => [`← ${e.type}`, byId.get(e.from), e.from]),
      ...outs.map((e) => [`→ ${e.type}`, byId.get(e.to), e.to]),
    ];
  }
  const kinds = countBy(edge ? [edge] : trace.edges.filter((e) => e.from === node.id || e.to === node.id), (e) => e.type);
  return (
    <aside className="inspector" style={{ '--c': color }} role="complementary" aria-label={`${sub}: ${head}`}>
      <button className="x" onClick={onClose} title="Close (Esc)" aria-label="Close inspector">×</button>
      <div className="ins-sub">{sub}</div>
      <div className="ins-head">{head}</div>
      {node && <div className="ins-file">{node.file}</div>}
      {node && (
        <div className="ins-actions">
          <button onClick={() => onReroot(node.id)} disabled={node.id === trace.rootId}>Re-root here</button>
          <button onClick={viewCode} aria-expanded={!!code}>{code ? 'Hide code' : 'View code'}</button>
        </div>
      )}
      {node && code && <pre className="ins-code">{code}</pre>}
      <div className="ins-stats">
        {stats.map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}
      </div>
      <div className="ins-sec">Edge types</div>
      <div className="ins-tags">
        {kinds.map(([t, c]) => <span key={t} style={{ '--t': EDGE_COLOR[t] ?? '#b0b6c3' }}>{t} ×{c}</span>)}
      </div>
      <div className="ins-sec">Relations</div>
      <ul className="ins-list">
        {rows.map(([label, n, id], i) => (
          <li key={i} onClick={() => onPick(id)}><em>{label}</em>{n?.name ?? id}<small>{n?.file}</small></li>
        ))}
      </ul>
      <AskPanel project={project} live={live} isNode={!!node}
        element={edge ? `${edge.from}->${edge.to}:${edge.type}` : node.id} />
      <div className="ins-foot">Flow: {trace.nodes.length} nodes · {trace.edges.length} edges in view</div>
    </aside>
  );
}

const TABS = ['Graph', 'Trace', 'Architecture', 'ERD', 'Query', 'Chat', 'Sync', 'Settings'];

// BFS from root, limited by depth, direction and a node cap (nearest nodes win).
// Also reports how many nodes the cap and the collapsed lanes left out.
const NODE_CAP = 60;
function subgraph(trace, rootId, depth, dir, cap, collapsed) {
  const laneOf = new Map(trace.nodes.map((n) => [n.id, n.lane]));
  const ok = (id) => id === rootId || !collapsed.has(laneOf.get(id));
  const keep = new Set([rootId]);
  let frontier = new Set([rootId]);
  let total = 1;
  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const e of trace.edges) {
      if (dir !== 'callers' && frontier.has(e.from) && !keep.has(e.to) && ok(e.to)) { total++; if (keep.size < cap) { keep.add(e.to); next.add(e.to); } }
      if (dir !== 'callees' && frontier.has(e.to) && !keep.has(e.from) && ok(e.from)) { total++; if (keep.size < cap) { keep.add(e.from); next.add(e.from); } }
    }
    frontier = next;
  }
  return {
    ...trace,
    hiddenByCap: Math.max(0, total - keep.size),
    nodes: trace.nodes.filter((n) => keep.has(n.id)),
    edges: trace.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

export default function App() {
  const [full, setFull] = useState(START);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selEdge, setSelEdge] = useState(null);
  const [tab, setTab] = useState(() => { const t = new URLSearchParams(location.search).get('tab'); return TABS.find((x) => x.toLowerCase() === (t ?? '').toLowerCase()) ?? 'Trace'; });
  const [project, setProject] = useState('sample-project');
  const [repos, setRepos] = useState(DEMO_SYNC);
  useEffect(() => {
    fetch('/api/v1/projects').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => setRepos((d.projects ?? []).map((p) => ({ project: p.name, files: p.files, indexed: p.files, status: p.stale ? 'stale' : 'up to date', last: p.days_since_sync === 0 ? 'today' : `${p.days_since_sync} days ago`, days_since_sync: p.days_since_sync })))).catch(() => {});
  }, []);
  const repoDeleted = (name) => setRepos((rs) => {
    const left = rs.filter((r) => r.project !== name);
    if (project === name) setProject(left[0]?.project ?? '');
    return left;
  });
  const [rootId, setRootId] = useState(START.nodes[0].id);
  const [depth, setDepth] = useState(2);
  const [dir, setDir] = useState('both');
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState('dark');
  const [showMap, setShowMap] = useState(() => window.innerWidth > 760);
  const [hidden, setHidden] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const toggleLane = (l) => setCollapsed((h) => { const n = new Set(h); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const [note, setNote] = useState('');
  const [hi, setHi] = useState(0);
  const toggleType = (t) => setHidden((h) => { const n = new Set(h); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const flash = (m) => { setNote(m); setTimeout(() => setNote(''), 1800); };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bannerOff, setBannerOff] = useState(false);
  const params = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return { p: q.get('project'), symbol: q.get('symbol') };
  }, []);
  const loadTrace = () => {
    if (params.p && !params.symbol) { setProject(params.p); setLive(true); return; }
    if (!params.p || !params.symbol) return;
    setProject(params.p);
    setLoading(true);
    setError('');
    fetch(`/api/v1/trace?project=${encodeURIComponent(params.p)}&symbol=${encodeURIComponent(params.symbol)}&depth=${depth}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`backend answered ${r.status}`))))
      .then((t) => { setFull(t); setRootId(t.nodes[0]?.id); setLive(true); })
      .catch((e) => { setLive(false); setError(e instanceof TypeError ? 'backend unreachable' : e.message); })
      .finally(() => setLoading(false));
  };
  useEffect(loadTrace, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const root = full.nodes.find((n) => n.id === rootId) ?? full.nodes[0] ?? { id: '', name: '(none)', file: '', kind: '', lane: '' };
  useEffect(() => {
    if (!live || !root.id) return;
    const t = setTimeout(() => {
      fetch(`/api/v1/trace?project=${encodeURIComponent(project)}&symbol=${encodeURIComponent(root.id)}&depth=${depth}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((t) => { if (t) setFull(t); })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [depth, rootId, live, project]); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = search
    ? full.nodes.filter((n) => n.name.toLowerCase().includes(search.toLowerCase()))
    : [];
  const types = useMemo(() => [...new Set(full.edges.map((e) => e.type))], [full]);
  const trace = useMemo(() => {
    const sg = subgraph(full, root.id, depth, dir, showAll ? Infinity : NODE_CAP, collapsed);
    return { ...sg, edges: sg.edges.filter((e) => !hidden.has(e.type)), title: `Trace · ${root.name}`, rootId: root.id };
  }, [full, root, depth, dir, hidden, showAll, collapsed]);
  const copyMermaid = async () => {
    try { await navigator.clipboard.writeText(toMermaid(trace)); flash('Mermaid copied'); } catch { flash('Copy blocked'); }
  };
  const saveCsv = () => {
    download(toCsv(trace), `${root.name}-trace.csv`);
    flash('CSV saved');
  };
  const saveSvg = () => {
    download(toSvg(trace, LANE_COLOR, EDGE_COLOR, theme === 'dark'), `${root.name}-trace.svg`);
    flash('SVG saved');
  };
  const savePng = async () => {
    download(await toPng(trace, LANE_COLOR, EDGE_COLOR, theme === 'dark'), `${root.name}-trace.png`);
    flash('PNG saved');
  };
  const { nodes, edges } = useMemo(() => build(trace, selected, selEdge), [trace, selected, selEdge]);
  const clearSel = () => { setSelected(null); setSelEdge(null); };
  const pick = (id) => { setRootId(id); clearSel(); setSearch(''); setTab('Trace'); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setSelected(null); setSelEdge(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header>
        <b className="brand">synaptree<span>-mcp</span></b>
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {repos.length === 0 && <option value="">no repositories</option>}
          {repos.map((r) => <option key={r.project} value={r.project}>{r.project}</option>)}
        </select>
        <span className="chip">user: demo-user</span>
        <div className="searchbox">
          <input placeholder="Search symbols" aria-label="Search symbols" value={search}
            onChange={(e) => { setSearch(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              const m = matches.slice(0, 8);
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, m.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter' && m[hi]) pick(m[hi].id);
              else if (e.key === 'Escape') setSearch('');
            }} />
          {matches.length > 0 && (
            <ul className="results">
              {matches.slice(0, 8).map((n, i) => (
                <li key={n.id} role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''}
                  onMouseEnter={() => setHi(i)} onClick={() => pick(n.id)}>
                  <span className="kind" style={{ '--k': colorOf(n.lane) }}>{n.kind}</span>
                  <b>{n.name}</b><small>{n.file}</small>
                </li>
              ))}
            </ul>
          )}
          {search && matches.length === 0 && <ul className="results"><li className="none">No symbols match “{search}”</li></ul>}
        </div>
        <span className={`pill ${live ? 'on' : ''}`}>{live ? 'live' : 'demo data'}</span>
        <button className="icon" title="Toggle theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>◐</button>
      </header>
      <nav className="tabs">
        {TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </nav>
      {loading && <div className="banner info" role="status"><span className="spin" />Loading trace for “{params.symbol}”…</div>}
      {!loading && error && (
        <div className="banner bad" role="alert">
          <span>Could not load “{params.symbol}” from {project}: {error}. Showing demo data.</span>
          <button className="icon" onClick={loadTrace}>Retry</button>
        </div>
      )}
      {!loading && !error && !live && !bannerOff && (
        <div className="banner warn" role="note">
          <span>Demo data — no backend connected. Open with <code>?project=&amp;symbol=</code> to load a real trace.</span>
          <button className="icon" onClick={() => setBannerOff(true)} aria-label="Dismiss">Dismiss</button>
        </div>
      )}
      {tab === 'Trace' && full.nodes.length === 0 ? (
        <div className="empty" role="status">
          <b>No trace to show</b>
          <span>{live ? `“${params.symbol}” has no callers or callees in ${project}.` : 'This project has no indexed symbols yet.'}</span>
          <span className="hint">Index it with <code>index_repository</code> or start synaptree-client, then reload.</span>
        </div>
      ) : tab === 'Trace' ? (
        <>
          <div className="toolbar">
            <span>Symbol <b>{root.name}</b></span>
            <label>Depth
              <input type="range" min="1" max="5" value={depth} onChange={(e) => setDepth(+e.target.value)} />
              <b>{depth}</b>
            </label>
            <select value={dir} onChange={(e) => setDir(e.target.value)}>
              <option value="both">callers + callees</option>
              <option value="callers">callers only</option>
              <option value="callees">callees only</option>
            </select>
            <div className="etypes" role="group" aria-label="Edge types">
              {types.map((t) => (
                <button key={t} className={`etype${hidden.has(t) ? ' off' : ''}`} aria-pressed={!hidden.has(t)}
                  style={{ '--c': EDGE_COLOR[t] ?? '#b0b6c3' }} onClick={() => toggleType(t)} title={`Toggle ${t} edges`}>
                  <Swatch type={t} />{t}
                </button>
              ))}
            </div>
            <span className="export">
              <button className="icon" onClick={copyMermaid}>Copy Mermaid</button>
              <button className="icon" onClick={savePng}>PNG</button>
              <button className="icon" onClick={saveSvg}>SVG</button>
              <button className="icon" onClick={saveCsv}>CSV</button>
              {note && <span className="ok" role="status">{note}</span>}
            </span>
            <div className="etypes" role="group" aria-label="Collapse lanes">
              {[...new Set(full.nodes.map((n) => n.lane))].map((l) => (
                <button key={l} className={`etype${collapsed.has(l) ? ' off' : ''}`} aria-pressed={collapsed.has(l)}
                  style={{ '--c': colorOf(l) }} onClick={() => toggleLane(l)} title={`${collapsed.has(l) ? 'Expand' : 'Collapse'} lane ${l}`}>
                  {collapsed.has(l) ? '▸' : '▾'} {l}
                </button>
              ))}
            </div>
            {trace.hiddenByCap > 0 && <button className="icon" onClick={() => setShowAll(true)}>+{trace.hiddenByCap} more nodes · show all</button>}
            {showAll && full.nodes.length > NODE_CAP && <button className="icon" onClick={() => setShowAll(false)}>Limit to {NODE_CAP}</button>}
            <span className="muted">Search above or double-click a card to re-root.</span>
          </div>
          <div className="flowwrap">
          <ReactFlow
            key={root.id + depth + dir + showAll + [...collapsed].join()}
            onlyRenderVisibleElements={trace.nodes.length > 40}
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodeClick={(_, n) => { if (n.type === 'card') { setSelEdge(null); setSelected((s) => (s === n.id ? null : n.id)); } }}
            onEdgeClick={(_, e) => { setSelected(null); setSelEdge((s) => (s === +e.id.slice(1) ? null : +e.id.slice(1))); }}
            onNodeDoubleClick={(_, n) => n.type === 'card' && pick(n.id)}
            onKeyDown={(e) => {
              const el = e.target.closest?.('.react-flow__node-card');
              const id = el?.getAttribute('data-id');
              if (!id) return;
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelEdge(null); setSelected((s) => (s === id ? null : id)); }
              else if (e.key === 'r' || e.key === 'R') pick(id);
            }}
            onPaneClick={clearSel}
            nodesConnectable={false} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.2}
            colorMode={theme}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1} />
            <Controls showInteractive={false}>
              <ResetButton onReset={clearSel} />
              <ControlButton onClick={() => setShowMap((v) => !v)} title={showMap ? 'Hide minimap' : 'Show minimap'} aria-label="Toggle minimap" aria-pressed={showMap}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>▦</span>
              </ControlButton>
            </Controls>
            {showMap && <MiniMap className="mini" style={{ width: 120, height: 80 }} pannable zoomable nodeColor={(n) => (n.type === 'lane' ? 'transparent' : colorOf(n.data?.lane))} />}
          </ReactFlow>
          <Inspector trace={trace} selected={selected} selEdge={selEdge} onClose={clearSel}
            project={project} live={live} onReroot={pick}
            onPick={(id) => { setSelEdge(null); setSelected(id); }} />
          </div>
        </>
      ) : tab === 'Graph' ? <GraphTab trace={full} laneColor={LANE_COLOR} edgeColor={EDGE_COLOR} Swatch={Swatch} />
        : tab === 'Architecture' ? <ArchitectureTab project={project} />
        : tab === 'ERD' ? <ErdTab />
        : tab === 'Query' ? <QueryTab project={project} />
        : tab === 'Chat' ? <ChatTab project={project} />
        : tab === 'Sync' ? <SyncTab rows={repos} onDeleted={repoDeleted} />
        : <SettingsTab />}
    </div>
  );
}
