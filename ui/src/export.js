import { layoutTrace } from './layout.js';

export const DASH = { CALLS:'6 6', CALL_REFERENCE:'2 5', USAGE:'10 4 2 4', IMPLEMENTS:'14 5', INHERITS:'0', USES_TYPE:'1 4' };
const safe = (id) => 'n' + String(id).replace(/[^A-Za-z0-9_]/g, '_');
const esc = (s) => String(s).replace(/"/g, "'");

// Mermaid flowchart text for the visible trace.
export function toMermaid(trace) {
  const lines = ['flowchart LR'];
  for (const n of trace.nodes) lines.push(`  ${safe(n.id)}["${esc(n.name)}<br/>${esc(n.file)}"]`);
  for (const e of trace.edges) lines.push(`  ${safe(e.from)} -->|${e.type}| ${safe(e.to)}`);
  return lines.join('\n');
}

// Renders the visible trace to a PNG blob on a plain canvas (no extra dependencies).
export function toPng(trace, laneColor, edgeColor, dark) {
  const { pos, width, height } = layoutTrace(trace.nodes, trace.edges);
  const scale = 2;
  const cv = document.createElement('canvas');
  cv.width = (width + 40) * scale;
  cv.height = (height + 40) * scale;
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  g.translate(20, 20);
  g.fillStyle = dark ? '#0c0d10' : '#ffffff';
  g.fillRect(-20, -20, width + 40, height + 40);
  const txt = dark ? '#eceef3' : '#1b1e25';
  const mut = dark ? '#8a90a0' : '#5d6475';
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = mut;
  g.fillText(trace.title, 14, 20);
  for (const e of trace.edges) {
    const a = pos.get(e.from); const b = pos.get(e.to);
    if (!a || !b) continue;
    g.strokeStyle = edgeColor[e.type] ?? '#b0b6c3';
    g.lineWidth = 2;
    g.setLineDash((DASH[e.type] ?? "6 6").split(" ").map(Number));
    g.beginPath();
    g.moveTo(a.x + 220, a.y + 38);
    g.bezierCurveTo(a.x + 270, a.y + 38, b.x - 50, b.y + 38, b.x, b.y + 38);
    g.stroke();
  }
  g.setLineDash([]);
  for (const n of trace.nodes) {
    const p = pos.get(n.id);
    const c = laneColor[n.lane] ?? '#4dd0e1';
    g.fillStyle = dark ? '#14161b' : '#fff';
    g.strokeStyle = c;
    g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(p.x, p.y, 220, 76, 14); g.fill(); g.stroke();
    g.fillStyle = c; g.font = 'bold 9px system-ui, sans-serif'; g.fillText(n.lane, p.x + 14, p.y + 20);
    g.fillStyle = txt; g.font = 'bold 14px system-ui, sans-serif'; g.fillText(n.name, p.x + 14, p.y + 42);
    g.fillStyle = mut; g.font = '10px system-ui, sans-serif'; g.fillText(n.file, p.x + 14, p.y + 62);
  }
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Vector export of the visible trace; returns an SVG Blob.
export function toSvg(trace, laneColor, edgeColor, dark) {
  const { pos, width, height } = layoutTrace(trace.nodes, trace.edges);
  const bg = dark ? '#0c0d10' : '#ffffff';
  const card = dark ? '#14161b' : '#ffffff';
  const txt = dark ? '#eceef3' : '#1b1e25';
  const mut = dark ? '#8a90a0' : '#5d6475';
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width + 40}" height="${height + 40}" viewBox="-20 -20 ${width + 40} ${height + 40}" font-family="system-ui, sans-serif">`,
    `<rect x="-20" y="-20" width="${width + 40}" height="${height + 40}" fill="${bg}"/>`,
    `<text x="14" y="20" font-size="11" fill="${mut}">${xml(trace.title)}</text>`,
  ];
  for (const e of trace.edges) {
    const a = pos.get(e.from); const b = pos.get(e.to);
    if (!a || !b) continue;
    out.push(`<path d="M${a.x + 220},${a.y + 38} C${a.x + 270},${a.y + 38} ${b.x - 50},${b.y + 38} ${b.x},${b.y + 38}" fill="none" stroke="${edgeColor[e.type] ?? '#b0b6c3'}" stroke-width="2" stroke-dasharray="${DASH[e.type] ?? "6 6"}"><title>${xml(e.type)}</title></path>`);
  }
  for (const n of trace.nodes) {
    const p = pos.get(n.id);
    const c = laneColor[n.lane] ?? '#4dd0e1';
    out.push(
      `<rect x="${p.x}" y="${p.y}" width="220" height="76" rx="14" fill="${card}" stroke="${c}" stroke-width="1.5"/>`,
      `<text x="${p.x + 14}" y="${p.y + 20}" font-size="9" font-weight="700" fill="${c}">${xml(n.lane)}</text>`,
      `<text x="${p.x + 14}" y="${p.y + 42}" font-size="14" font-weight="700" fill="${txt}">${xml(n.name)}</text>`,
      `<text x="${p.x + 14}" y="${p.y + 62}" font-size="10" fill="${mut}">${xml(n.file)}</text>`,
    );
  }
  out.push('</svg>');
  return new Blob([out.join('\n')], { type: 'image/svg+xml' });
}

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Edge list of the visible trace, one row per relation, as a CSV Blob.
export function toCsv(trace) {
  const by = new Map(trace.nodes.map((n) => [n.id, n]));
  const rows = [['from', 'from_kind', 'from_file', 'type', 'to', 'to_kind', 'to_file']];
  for (const e of trace.edges) {
    const a = by.get(e.from) ?? {}; const b = by.get(e.to) ?? {};
    rows.push([a.name ?? e.from, a.kind, a.file, e.type, b.name ?? e.to, b.kind, b.file]);
  }
  return new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
