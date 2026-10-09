import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadClientConfig, startWatcher } from '../../client/codelense-client.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cl-client-'));

test('loadClientConfig applies defaults and requires endpoint + root', () => {
  const dir = tmp();
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, JSON.stringify({ server_endpoint: 'http://x:1/', workspace_root: dir }));
  const cfg = loadClientConfig(file);
  assert.equal(cfg.server_endpoint, 'http://x:1');
  assert.equal(cfg.sync_mode, 'auto');
  assert.equal(cfg.repo_name, path.basename(dir));
  assert.ok(cfg.ignore_patterns.some((p) => p.includes('node_modules')));
  fs.writeFileSync(file, JSON.stringify({ workspace_root: dir }));
  assert.throws(() => loadClientConfig(file), /server_endpoint/);
});

test('watcher pushes existing files at startup, never the config/.env, and reports deletes', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const a = 1;');
  fs.writeFileSync(path.join(dir, 'codelense-client.json'), '{"client_auth_token":"secret"}');
  fs.writeFileSync(path.join(dir, '.env'), 'X=1');
  const got = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { got.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.setHeader('content-type', 'application/json'); res.end('{}'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cfg = { server_endpoint: `http://127.0.0.1:${srv.address().port}`, client_auth_token: 'rg_live_t', sync_mode: 'auto', workspace_root: dir, repo_name: 'r', ignore_patterns: [] };
  const w = startWatcher(cfg, () => {});
  const waitFor = async (fn) => { for (let i = 0; i < 60 && !fn(); i++) await new Promise((r) => setTimeout(r, 100)); };
  try {
    await waitFor(() => got.some((g) => g.body.file_path === 'a.js'));
    const a = got.find((g) => g.body.file_path === 'a.js');
    assert.ok(a, 'existing file pushed');
    assert.equal(a.url, '/api/v1/index-file');
    assert.equal(a.auth, 'Bearer rg_live_t');
    assert.match(a.body.sha256, /^[0-9a-f]{64}$/);
    assert.ok(!got.some((g) => /codelense-client\.json|\.env/.test(g.body.file_path)), 'config and .env never uploaded');
    fs.unlinkSync(path.join(dir, 'a.js'));
    await waitFor(() => got.some((g) => g.body.deleted));
    assert.ok(got.some((g) => g.body.deleted && g.body.file_path === 'a.js'));
  } finally {
    await w.close();
    srv.close();
  }
});
