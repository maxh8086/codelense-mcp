import React, { useEffect, useState } from 'react';

async function call(path, opts) {
  const r = await fetch(`/api/v1${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const postJson = (path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// Note + "ask about this flow" for the element picked in the inspector.
// Notes live in the synaptree index only; the repo is never touched.
export function AskPanel({ project, element, isNode, live }) {
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState('');
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [depth, setDepth] = useState(2);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [gate, setGate] = useState(null);

  useEffect(() => {
    setAnswer(null); setGate(null); setMsg('');
    if (!live) { setNote(''); setSaved(''); return; }
    call(`/annotations?project=${encodeURIComponent(project)}`)
      .then((r) => { const t = r.annotations?.[element] ?? ''; setNote(t); setSaved(t); })
      .catch(() => {});
  }, [project, element, live]);

  if (!live) return <p className="hint">Notes and questions need a connected backend.</p>;

  const saveNote = async () => {
    try { await postJson('/annotations', { project, element, note }); setSaved(note); setMsg(note.trim() ? 'Note saved (index only).' : 'Note removed.'); }
    catch (e) { setMsg(`Not saved: ${e.message}`); }
  };
  const ask = async (extra = {}) => {
    if (!q.trim()) return;
    setBusy(true); setMsg(''); setAnswer(null);
    try {
      const r = await postJson('/chat', { project, qualified_name: element, question: q, depth, ...extra });
      if (r.needs_approval) { setGate(r); return; }
      if (r.ok === false) { setGate(null); setMsg(r.error || 'Request refused.'); return; }
      setGate(null); setAnswer(r.answer ?? r.text ?? r.content ?? JSON.stringify(r, null, 2));
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const strong = gate?.tier === 'strong';

  return (
    <div className="ask">
      <div className="ins-sec">Note</div>
      <textarea rows={2} value={note} maxLength={2000} placeholder="Add context for this element (kept in synaptree, not in your repo)" onChange={(e) => setNote(e.target.value)} />
      <div className="ins-actions"><button onClick={saveNote} disabled={note === saved}>Save note</button></div>
      {isNode && (
        <>
          <div className="ins-sec">Ask about this flow</div>
          <textarea rows={2} value={q} placeholder="e.g. What happens if this call fails?" onChange={(e) => setQ(e.target.value)} />
          <div className="ins-actions">
            <select value={depth} onChange={(e) => setDepth(+e.target.value)} aria-label="Trace depth">
              {[1, 2, 3].map((d) => <option key={d} value={d}>depth {d}</option>)}
            </select>
            <button onClick={() => ask()} disabled={busy || !q.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
          </div>
        </>
      )}
      {gate && (
        <div className={`ask-gate${strong ? ' strong' : ''}`} role="alert">
          {strong
            ? <>This would send about <b>{gate.estimated_tokens.toLocaleString()}</b> tokens, above the hard limit. Narrow the scope (lower depth, pick a smaller symbol) or send anyway.</>
            : <>This would send about <b>{gate.estimated_tokens.toLocaleString()}</b> tokens. Continue?</>}
          <div className="ins-actions">
            {strong && <button onClick={() => { setGate(null); setDepth((d) => Math.max(1, d - 1)); }}>Narrow scope</button>}
            <button onClick={() => ask({ approval_id: gate.approval_id, send_anyway: strong })}>{strong ? 'Send anyway' : 'Approve'}</button>
            <button onClick={() => setGate(null)}>Cancel</button>
          </div>
        </div>
      )}
      {answer && <pre className="ins-code">{answer}</pre>}
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
