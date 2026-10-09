// Layered left-to-right layout without extra dependencies.
// Depth = longest path from any root (cycles are cut by a visiting set).
const COL_W = 290;
const ROW_H = 120;
const PAD = 40;

export function layoutTrace(nodes, edges) {
  const out = new Map(nodes.map((n) => [n.id, []]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!out.has(e.from) || !out.has(e.to) || e.from === e.to) continue;
    out.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }
  const depth = new Map();
  const visit = (id, d, seen) => {
    if (seen.has(id)) return;
    if ((depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    const next = new Set(seen).add(id);
    for (const t of out.get(id)) visit(t, d + 1, next);
  };
  const roots = nodes.filter((n) => indeg.get(n.id) === 0);
  for (const r of roots.length ? roots : nodes.slice(0, 1)) visit(r.id, 0, new Set());
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  const rows = new Map();
  const pos = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id);
    const r = rows.get(d) ?? 0;
    rows.set(d, r + 1);
    pos.set(n.id, { x: PAD + d * COL_W, y: PAD + 40 + r * ROW_H });
  }
  const cols = Math.max(...depth.values()) + 1;
  const maxRows = Math.max(...rows.values());
  return { pos, width: PAD * 2 + cols * COL_W - 60, height: PAD * 2 + 40 + maxRows * ROW_H };
}
