// Entry point for the standalone (Node SEA) build of synaptree-client.
import { loadClientConfig, startWatcher } from './synaptree-client.js';

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  console.log('usage: synaptree-client [path/to/synaptree-client.json]\nWatches workspace_root and pushes changed files to server_endpoint (see synaptree-client.sample.json).');
  process.exit(0);
}
const cfg = loadClientConfig(arg ?? 'synaptree-client.json');
startWatcher(cfg);
console.error(`synaptree-client watching ${cfg.workspace_root} -> ${cfg.server_endpoint} (${cfg.sync_mode})`);
