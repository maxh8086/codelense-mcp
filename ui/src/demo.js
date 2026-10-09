// Demo trace used when the API is unreachable. Shape matches GET /api/v1/trace:
// nodes: { id, name, kind, file, lane }, edges: { from, to, type }
export const DEMO_TRACE = {
  title: 'Trace · handleRequest',
  nodes: [
    { id: 'n1', name: 'handleRequest', kind: 'Function', file: 'src/api/handler.ts', lane: 'ENTRYPOINT' },
    { id: 'n2', name: 'authenticate', kind: 'Function', file: 'src/auth/session.ts', lane: 'CONTROL' },
    { id: 'n3', name: 'loadAccount', kind: 'Function', file: 'src/account/service.ts', lane: 'CONTROL' },
    { id: 'n4', name: 'AccountRepo.find', kind: 'Method', file: 'src/account/repo.ts', lane: 'PERSISTENCE' },
    { id: 'n5', name: 'cache.get', kind: 'Method', file: 'src/cache/client.ts', lane: 'PERSISTENCE' },
    { id: 'n6', name: 'renderResponse', kind: 'Function', file: 'src/api/render.ts', lane: 'ENTRYPOINT' },
    { id: 'n7', name: 'auditLog', kind: 'Function', file: 'src/audit/log.ts', lane: 'OBSERVABILITY' },
    { id: 'n8', name: 'Metrics.record', kind: 'Method', file: 'src/obs/metrics.ts', lane: 'OBSERVABILITY' },
  ],
  edges: [
    { from: 'n1', to: 'n2', type: 'CALLS' },
    { from: 'n1', to: 'n3', type: 'CALLS' },
    { from: 'n3', to: 'n5', type: 'CALLS' },
    { from: 'n3', to: 'n4', type: 'CALLS' },
    { from: 'n1', to: 'n6', type: 'CALLS' },
    { from: 'n2', to: 'n7', type: 'CALL_REFERENCE' },
    { from: 'n3', to: 'n7', type: 'USAGE' },
    { from: 'n6', to: 'n8', type: 'CALLS' },
  ],
};

// Synthetic fan-out trace for stress-testing the UI: open with ?big=300.
const LANES = ['ENTRYPOINT', 'CONTROL', 'PERSISTENCE', 'OBSERVABILITY'];
export function makeBig(n) {
  const nodes = [{ id: 'n1', name: 'handleRequest', kind: 'Function', file: 'src/api/handler.ts', lane: 'ENTRYPOINT' }];
  const edges = [];
  for (let i = 2; i <= n; i++) {
    nodes.push({ id: `n${i}`, name: `fn${i}`, kind: 'Function', file: `src/mod${i % 17}/f${i}.ts`, lane: LANES[i % LANES.length] });
    edges.push({ from: `n${Math.floor(i / 3) || 1}`, to: `n${i}`, type: i % 7 === 0 ? 'USAGE' : 'CALLS' });
  }
  return { title: `Trace · handleRequest (${n} nodes)`, nodes, edges };
}
