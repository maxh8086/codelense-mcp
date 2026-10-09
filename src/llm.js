import crypto from 'node:crypto';
import { EMBEDDING_DIMS } from './constants.js';

export const DEFAULT_SETTINGS = {
  provider: 'local', // local | api
  base_url: 'http://localhost:11434/v1',
  model: 'llama3.2:3b-16k',
  api_key_sealed: '',
  guardrails: { confirm_tokens: 50_000, max_input_tokens: 100_000, daily_token_budget: 500_000, max_calls_per_minute: 6, timeout_s: 120 },
};

export const estimateTokens = (text) => Math.ceil((text ?? '').length / 4);
const today = () => new Date().toISOString().slice(0, 10);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// True when the endpoint host is loopback, private-range, link-local, .local/.internal or a bare
// single-label name (a docker/compose service such as "ollama"). Anything else counts as remote.
export function isLocalEndpoint(url) {
  let h;
  try { h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === 'host.docker.internal') return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  return !h.includes('.') && !h.includes(':');
}

export class Llm {
  constructor(store, { fetchImpl = fetch } = {}) { this.store = store; this.fetch = fetchImpl; this.calls = []; this.pending = new Map(); }

  settings() { return { ...DEFAULT_SETTINGS, ...this.store.get('llm_settings', {}), guardrails: { ...DEFAULT_SETTINGS.guardrails, ...(this.store.get('llm_settings', {}).guardrails ?? {}) } }; }

  // API keys are write-only: callers get `api_key_set`, never the key.
  // `local_ready`: the user has saved settings that point at a local model (defaults alone do not count).
  publicSettings() {
    const { api_key_sealed, ...s } = this.settings();
    const saved = Object.keys(this.store.get('llm_settings', {})).length > 0;
    return { ...s, api_key_set: Boolean(api_key_sealed), local_ready: saved && s.provider === 'local' && isLocalEndpoint(s.base_url) && Boolean(s.model) };
  }

  save(patch) {
    const cur = this.settings();
    const next = { ...cur };
    for (const k of ['provider', 'base_url', 'model']) if (patch[k] !== undefined) next[k] = String(patch[k]);
    if (!['local', 'api'].includes(next.provider)) throw new Error('provider must be "local" or "api"');
    if (patch.api_key) next.api_key_sealed = this.store.seal(patch.api_key);
    if (patch.guardrails) {
      for (const [k, v] of Object.entries(patch.guardrails)) {
        if (!(k in DEFAULT_SETTINGS.guardrails)) continue;
        if (!Number.isFinite(+v) || +v <= 0) throw new Error(`guardrail ${k} must be a positive number`);
        next.guardrails[k] = +v;
      }
      if (next.guardrails.confirm_tokens > next.guardrails.max_input_tokens) throw new Error('confirm_tokens cannot exceed max_input_tokens');
    }
    this.store.set('llm_settings', next);
    return this.publicSettings();
  }

  usage() {
    const u = this.store.get('llm_usage', {});
    const g = this.settings().guardrails;
    const used = u[today()] ?? 0;
    return { day: today(), tokens_used: used, daily_token_budget: g.daily_token_budget, remaining: Math.max(0, g.daily_token_budget - used) };
  }

  tier(tokens) {
    const g = this.settings().guardrails;
    if (tokens < g.confirm_tokens) return 'auto';
    return tokens <= g.max_input_tokens ? 'confirm' : 'strong';
  }

  // True only for a remote (paid) API source. A local model is free, so it is never gated.
  isPaid() { const s = this.settings(); return s.provider === 'api' && !isLocalEndpoint(s.base_url); }

  // Token guardrails protect paid sources only. Local LLM calls and calls that generate annotations
  // (purpose "annotation") skip the gate entirely; the limits stay editable in Settings.
  // Approval handshake: the first call returns needs_approval with an approval_id; the second passes it back.
  gate(scope, tokens, { approval_id, send_anyway, purpose } = {}) {
    if (purpose === 'annotation' || !this.isPaid()) return { ok: true, exempt: true };
    const tier = this.tier(tokens);
    const u = this.usage();
    if (tokens > u.remaining) return { ok: false, error: `daily token budget exhausted (${u.tokens_used}/${u.daily_token_budget})`, estimated_tokens: tokens };
    if (tier === 'auto') return { ok: true };
    const rec = approval_id && this.pending.get(approval_id);
    if (rec && rec.exp > Date.now() && rec.tokens === tokens && rec.scope === scope && (tier !== 'strong' || send_anyway)) {
      this.pending.delete(approval_id);
      return { ok: true };
    }
    const id = crypto.randomUUID();
    this.pending.set(id, { exp: Date.now() + 300_000, tokens, scope });
    const out = { ok: false, needs_approval: true, estimated_tokens: tokens, scope, tier, approval_id: id, expires_in: 300 };
    if (tier === 'strong') out.suggested_narrowing = ['Lower the trace depth', 'Pick a single file or symbol', 'Resend with send_anyway:true to accept the cost'];
    return out;
  }

  // Throws (status 409) unless the configured model runs on this machine / private network.
  assertLocal() {
    const s = this.settings();
    if (s.provider !== 'local' || !isLocalEndpoint(s.base_url)) {
      const e = new Error('This action sends database schema to the model, so it needs a LOCAL LLM. Set Settings → provider "local" with a loopback/private base_url (e.g. Ollama at http://localhost:11434/v1).');
      e.status = 409;
      e.extra = { local_llm_required: true };
      throw e;
    }
  }

  async complete(prompt, { system = '', localOnly = false } = {}) {
    if (localOnly) this.assertLocal();
    const s = this.settings();
    const g = s.guardrails;
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < 60_000);
    if (this.isPaid() && this.calls.length >= g.max_calls_per_minute) throw new Error('rate limit: too many LLM calls this minute');
    const cacheKey = sha(`${s.model}|${system}|${prompt}`);
    const cache = this.store.get('llm_cache', {});
    if (cache[cacheKey]) return { text: cache[cacheKey], cached: true };
    this.calls.push(now);
    const headers = { 'content-type': 'application/json' };
    const key = this.store.open(s.api_key_sealed);
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await this.fetch(`${s.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers, signal: AbortSignal.timeout(g.timeout_s * 1000),
      body: JSON.stringify({ model: s.model, temperature: 0.1, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`LLM endpoint returned ${res.status}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? '';
    const used = json.usage?.total_tokens ?? estimateTokens(prompt) + estimateTokens(text);
    this.store.update('llm_usage', (u) => ({ ...u, [today()]: (u[today()] ?? 0) + used }));
    this.store.update('llm_cache', (c) => { const keys = Object.keys(c); if (keys.length > 200) delete c[keys[0]]; c[cacheKey] = text; return c; });
    return { text, cached: false };
  }

  async test() {
    const s = this.settings();
    try { const r = await this.complete('Reply with the single word: ok'); return { ok: true, reply: r.text.slice(0, 40), provider: s.provider }; } catch (e) { return { ok: false, error: e.message }; }
  }
}

// Optional async embedding of new nodes; silently disabled unless an embeddings endpoint is configured.
export function makeEmbedder(cfg, db) {
  if (!cfg.embeddings?.url) return null;
  return async (t, built) => {
    const max = cfg.embeddings.maxNodes ?? 5000;
    const rows = built.flatMap((f) => f.nodes).filter((n) => n.label !== 'Folder' && n.label !== 'Project' && n.label !== 'File').slice(0, max);
    for (let i = 0; i < rows.length; i += 64) {
      const part = rows.slice(i, i + 64);
      const res = await fetch(cfg.embeddings.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.embeddings.key ? { authorization: `Bearer ${cfg.embeddings.key}` } : {}) },
        body: JSON.stringify({ model: cfg.embeddings.model, input: part.map((n) => `${n.name} ${n.signature ?? ''} ${n.docstring ?? ''}`) }),
      });
      if (!res.ok) return;
      const { data } = await res.json();
      // Guard: skip the batch if the vectors do not match the index dimension (a wrong model would corrupt it).
      if (!Array.isArray(data) || data.length !== part.length || data.some((d) => d.embedding?.length !== EMBEDDING_DIMS)) return;
      await db.run(
        `UNWIND $rows AS r MATCH (n:CodeNode {user_id:$u, repo_name:$r2, qualified_name:r.qn}) SET n.embedding = r.v`,
        { u: t.user_id, r2: t.repo_name, rows: part.map((n, j) => ({ qn: n.qualified_name, v: data[j].embedding })) }, { write: true });
    }
  };
}
