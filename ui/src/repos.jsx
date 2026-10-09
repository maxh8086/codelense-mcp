import React, { useEffect, useState } from 'react';

export const PHRASE = 'yes, delete my repo';
export const STALE_DAYS = 90;

const send = async (path, body) => {
  const r = await fetch(`/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  }
  return r.json();
};

// Two-guardrail delete: (1) explain it only clears the synaptree index, (2) type the repo name, then the phrase.
export function DeleteDialog({ row, onClose, onDeleted }) {
  const [step, setStep] = useState(1);
  const [info, setInfo] = useState(null);
  const [understood, setUnderstood] = useState(false);
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    send('/projects/delete', { project: row.project, dry_run: true })
      .then(setInfo)
      .catch(() => { setDemo(true); setInfo({ counts: { files: row.files, nodes: row.files * 8, edges: row.files * 21 }, delete_token: 'demo' }); });
  }, [row.project]);

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const nameOk = name === row.project;
  const phraseOk = nameOk && phrase === PHRASE;
  const run = async () => {
    setBusy(true); setErr('');
    try {
      if (!demo) await send('/projects/delete', { project: row.project, delete_token: info.delete_token, confirm_name: name, confirm_phrase: phrase });
      onDeleted(row.project, demo);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const c = info?.counts;

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Delete ${row.project}`}>
        <h3>Delete “{row.project}” from synaptree?</h3>
        {step === 1 && (<>
          <div className="notice">
            <b>This only removes the index.</b>
            <p>It clears this repo’s code graph from the synaptree database{c ? <>: <b>{c.nodes}</b> nodes, <b>{c.edges}</b> edges, <b>{c.files}</b> files</> : ''}, plus its descriptions, ADRs and embeddings.</p>
            <p><b>Your source code is not touched.</b> Nothing is deleted from Git, GitHub or the local repo folder{info?.path ? <> (<code>{info.path}</code>)</> : ''}.</p>
            <p>You can index the repo again at any time. Descriptions you added by hand cannot be rebuilt from code.</p>
          </div>
          {demo && <p className="hint">No server connected: this is a demo, so only the list on this page changes.</p>}
          <label className="row" style={{ justifyContent: 'flex-start' }}>
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>I understand this removes the index only</span>
          </label>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={!understood || !info} onClick={() => setStep(2)}>Continue</button>
          </div>
        </>)}
        {step === 2 && (<>
          <div className="field">1. Type the repo name <code>{row.project}</code> to continue
            <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Repo name" autoComplete="off" /></div>
          <div className="field">2. Then type <code>{PHRASE}</code>
            <input type="text" value={phrase} disabled={!nameOk} onChange={(e) => setPhrase(e.target.value)} aria-label="Confirmation phrase" autoComplete="off" /></div>
          {err && <p className="err">{err}</p>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn danger" disabled={!phraseOk || busy} onClick={run}>{busy ? 'Deleting…' : 'Delete index'}</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

const KEY = 'synaptree.keep';
const readKeep = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

// Repos not synced for STALE_DAYS and not snoozed. Snoozes are kept by the server; localStorage covers demo mode.
export function useStale(rows) {
  const [keep, setKeep] = useState(readKeep);
  const now = Date.now();
  const snoozed = (r) => (r.keep_until ?? keep[r.project] ?? 0) > now;
  const stale = rows.filter((r) => (r.days_since_sync ?? 0) >= STALE_DAYS && !snoozed(r));
  const snooze = async (project, months) => {
    const until = now + months * 30 * 86400000;
    try { await send('/projects/keep', { project, months }); } catch { /* demo mode */ }
    const next = { ...keep, [project]: until };
    setKeep(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  return { stale, snooze };
}

export function StaleReminder({ stale, onDelete, onKeep }) {
  if (!stale.length) return null;
  const [choice, setChoice] = useState('');
  const r = stale[0];
  const approve = () => {
    if (choice === 'delete') onDelete(r);
    else if (choice) onKeep(r.project, Number(choice));
    setChoice('');
  };
  return (
    <div className="banner warn stale" role="alert">
      <span><b>{r.project}</b> hasn’t synced for {r.days_since_sync} days{stale.length > 1 ? ` (and ${stale.length - 1} more)` : ''}. What should happen to its index?</span>
      <span className="stale-actions">
        <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`Action for ${r.project}`}>
          <option value="">Action…</option>
          <option value="3">Retain 3 months</option>
          <option value="6">Retain 6 months</option>
          <option value="delete">Delete…</option>
        </select>
        <button className={`btn${choice === 'delete' ? ' danger' : ''}`} disabled={!choice} onClick={approve}>
          {choice === 'delete' ? 'Review…' : 'Approve'}
        </button>
      </span>
    </div>
  );
}
