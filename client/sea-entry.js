// Entry point for the standalone (Node SEA) build of codelense-client.
import { loadClientConfig, startWatcher } from './codelense-client.js';

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  console.log('usage: codelense-client [path/to/codelense-client.json]\nWatches workspace_root and pushes changed files to server_endpoint (see codelense-client.sample.json).');
  process.exit(0);
}
const cfg = loadClientConfig(arg ?? 'codelense-client.json');
startWatcher(cfg);
console.error(`codelense-client watching ${cfg.workspace_root} -> ${cfg.server_endpoint} (${cfg.sync_mode})`);
