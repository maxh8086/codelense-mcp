import React, { useEffect, useState } from 'react';

// The server owns path syntax (POSIX, C:\ drives, UNC). The client never joins or splits paths itself:
// it only echoes back the `path`, `parent` and `dirs[].path` values the server returned.
const DEMO = {
  '/workspace': ['sample-project', 'infra-terraform', 'legacy-billing'],
  '/workspace/sample-project': ['src', 'tests'],
  '/workspace/infra-terraform': ['modules'],
  '/workspace/legacy-billing': ['app'],
};

async function list(path) {
  try {
    const r = await fetch(`/api/v1/fs/list?path=${encodeURIComponent(path || '')}`);
    if (!r.ok) throw new Error(String(r.status));
    return { ...(await r.json()), demo: false };
  } catch {
    const p = DEMO[path] ? path : '/workspace';
    return {
      path: p, sep: '/', roots: [],
      parent: p === '/workspace' ? null : p.slice(0, p.lastIndexOf('/')),
      dirs: (DEMO[p] ?? []).map((n) => ({ name: n, path: `${p}/${n}`, repo: p === '/workspace' })),
      demo: true,
    };
  }
}

// Last path segment for either separator style.
export const baseName = (p) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

// Read-only server-side folder browser. It only lists directory names under the server's workspace_root.
// `roots` is non-empty on Windows servers that allow several drives (C:\, D:\, ...).
export function FolderPicker({ value, onPick, onClose }) {
  const [cur, setCur] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { list(value).then(setCur); }, []);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const go = (p) => list(p).then((r) => { setErr(''); setCur(r); }).catch(() => setErr('Cannot open that folder.'));
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Choose a folder">
        <h3>Choose a folder to index</h3>
        {!cur ? <p className="hint">Loading…</p> : (<>
          <p className="hint">Browsing <code>{cur.path}</code>{cur.demo ? ' (demo folders: server not connected)' : ''}. Folders are only listed, never changed. The path is on the machine running codelense-mcp, not on this browser's machine.</p>
          {cur.roots?.length > 1 && (
            <div className="folder-list" aria-label="Drives">
              {cur.roots.map((r) => <button key={r} className="folder" onClick={() => go(r)}>💽 {r}</button>)}
            </div>)}
          <div className="folder-list" role="listbox" aria-label="Folders">
            {cur.parent != null && <button className="folder" onClick={() => go(cur.parent)}>↑ ..</button>}
            {cur.dirs.map((d) => (
              <button key={d.path} className="folder" onClick={() => go(d.path)}>
                📁 {d.name}{d.repo && <span className="chipbtn" style={{ marginLeft: 6 }}>git</span>}
              </button>))}
            {!cur.dirs.length && <p className="hint">No sub-folders here.</p>}
          </div>
          {err && <p className="hint" role="alert">{err}</p>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={() => onPick(cur.path)}>Select this folder</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

const copy = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

// Double quotes work in bash, zsh, PowerShell and cmd. Escape embedded quotes for each shell.
const q = (s) => `"${s.replace(/"/g, '\\"')}"`;

// Ready-to-run commands so Claude Code or Codex can index a repo through the MCP tools.
// Windows paths such as C:\Users\me\repo are valid inside the quoted prompt as-is.
export function AgentCommands({ path, name, endpoint }) {
  const [done, setDone] = useState('');
  const p = path || '/path/to/repo';
  const n = name || 'my-repo';
  const url = endpoint || `${location.origin}/sse`;
  const prompt = `Use the codelense index_repository tool on ${p} as project ${n}`;
  const items = [
    { id: 'claude-add', label: 'Claude Code: connect once', text: `claude mcp add --transport sse codelense ${url}` },
    { id: 'claude-run', label: 'Claude Code: index this repo', text: `claude -p ${q(prompt)}` },
    { id: 'codex-add', label: 'Codex: connect once', text: `codex mcp add codelense -- codelense-mcp --stdio` },
    { id: 'codex-run', label: 'Codex: index this repo', text: `codex exec ${q(prompt)}` },
  ];
  return (
    <details className="agent-cmds">
      <summary>Index from Claude Code or Codex</summary>
      <p className="hint">These run the same MCP tools as this page, in any terminal (bash, PowerShell, cmd). Indexing only reads your folder. Paste a full path such as <code>/home/me/app</code> or <code>C:\Users\me\app</code>; if codelense runs in Docker, use the path as the container sees it.</p>
      {items.map((i) => (
        <div key={i.id} className="cmd">
          <span className="muted">{i.label}</span>
          <code>{i.text}</code>
          <button className="btn ghost" onClick={async () => { if (await copy(i.text)) { setDone(i.id); setTimeout(() => setDone(''), 1500); } }}>{done === i.id ? 'Copied' : 'Copy'}</button>
        </div>))}
    </details>
  );
}
