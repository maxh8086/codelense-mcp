#!/usr/bin/env node
// codelense-client: watches a workspace and pushes changed files to a codelense-mcp server.
// Read-only toward the repo: it only reads files and never writes inside workspace_root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar from 'chokidar';

const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.venv/**', '**/__pycache__/**'];
const DEBOUNCE_MS = 500;
const MAX_FILE_BYTES = 1024 * 1024;

export function loadClientConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['server_endpoint', 'workspace_root']) if (!cfg[k]) throw new Error(`config: ${k} is required`);
  return {
    server_endpoint: cfg.server_endpoint.replace(/\/$/, ''),
    client_auth_token: cfg.client_auth_token ?? '',
    sync_mode: cfg.sync_mode ?? 'auto', // auto | manual
    workspace_root: path.resolve(cfg.workspace_root),
    repo_name: cfg.repo_name ?? path.basename(path.resolve(cfg.workspace_root)),
    ignore_patterns: cfg.ignore_patterns ?? DEFAULT_IGNORE,
  };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Server-side parsing is authoritative: the client sends source text through the index_repository
// route for the single file by default, and only the hash decides whether anything is sent.
async function post(cfg, route, body) {
  const res = await fetch(`${cfg.server_endpoint}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.client_auth_token ? { authorization: `Bearer ${cfg.client_auth_token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export function startWatcher(cfg, log = console.error) {
  const seen = new Map();
  const timers = new Map();
  const push = async (abs) => {
    const rel = path.relative(cfg.workspace_root, abs).split(path.sep).join('/');
    try {
      const stat = await fs.promises.stat(abs);
      if (stat.size > MAX_FILE_BYTES) return;
      const buf = await fs.promises.readFile(abs);
      const hash = sha256(buf);
      if (seen.get(rel) === hash) return;
      await post(cfg, '/api/v1/index-file', { repo_name: cfg.repo_name, file_path: rel, sha256: hash, source: buf.toString('utf8') });
      seen.set(rel, hash);
      log(`synced ${rel}`);
    } catch (e) { log(`sync failed ${rel}: ${e.message}`); }
  };
  const schedule = (abs) => {
    if (cfg.sync_mode !== 'auto') return;
    clearTimeout(timers.get(abs));
    timers.set(abs, setTimeout(() => { timers.delete(abs); push(abs); }, DEBOUNCE_MS));
  };
  // Initial scan is on: files that already exist are pushed once at startup (the server skips
  // unchanged ones by sha256), so a fresh client catches up without waiting for an edit.
  // Never upload the client's own config (it holds the auth token) or env files.
  const neverSync = (p) => /(^|[\\/])(\.env(\..*)?|codelense-client\.json)$/.test(p);
  const w = chokidar.watch(cfg.workspace_root, { ignored: [...cfg.ignore_patterns, neverSync], ignoreInitial: false, persistent: true });
  w.on('add', schedule).on('change', schedule);
  w.on('unlink', (abs) => {
    const rel = path.relative(cfg.workspace_root, abs).split(path.sep).join('/');
    seen.delete(rel);
    post(cfg, '/api/v1/index-file', { repo_name: cfg.repo_name, file_path: rel, deleted: true }).catch((e) => log(`delete failed ${rel}: ${e.message}`));
  });
  return w;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('codelense-client.js')) {
  const file = process.argv[2] ?? 'codelense-client.json';
  const cfg = loadClientConfig(file);
  startWatcher(cfg);
  console.error(`codelense-client watching ${cfg.workspace_root} -> ${cfg.server_endpoint} (${cfg.sync_mode})`);
}
