import React, { useState } from 'react';

const copy = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

function Cmd({ id, label, text, done, setDone }) {
  return (
    <div className="cmd">
      <span className="muted">{label}</span>
      <code>{text}</code>
      <button className="btn ghost" onClick={async () => { if (await copy(text)) { setDone(id); setTimeout(() => setDone(''), 1500); } }}>{done === id ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

// Two sets of copy-paste instructions: connect the MCP once, then index any repo in plain English.
// The agent supplies the folder (its working directory) and project name (the folder name) itself.
export function AgentCommands({ endpoint }) {
  const [done, setDone] = useState('');
  const url = endpoint || `${location.origin}/sse`;
  const shared = { done, setDone };
  return (
    <div className="agent-cmds">
      <h5>1. Add the MCP (first time only)</h5>
      <Cmd id="claude-add" label="Claude Code" text={`claude mcp add --transport sse codelense ${url}`} {...shared} />
      <Cmd id="codex-add" label="Codex" text="codex mcp add codelense -- codelense-mcp --stdio" {...shared} />
      <h5>2. Add a new repo</h5>
      <p className="hint">Open Claude Code or Codex inside the repo and say:</p>
      <Cmd id="say" label="Claude Code or Codex (in the repo folder)" text="index this repo" {...shared} />
      <p className="hint">Or run it in one go from a terminal in the repo: <code>claude -p "index this repo"</code> or <code>codex exec "index this repo"</code>. The agent picks the folder and project name, and indexing only reads your code.</p>
    </div>
  );
}
