// Creates .env with generated secrets. Never overwrites an existing .env and never prints secrets.
import fs from 'node:fs';
import crypto from 'node:crypto';

if (fs.existsSync('.env')) {
  console.error('.env already exists; leaving it untouched.');
  process.exit(0);
}
const rand = (n) => crypto.randomBytes(n).toString('hex');
const text = fs.readFileSync('.env.example', 'utf8')
  .replace('neo4j/change-me-please', `neo4j/${rand(16)}`);
// SYNAPTREE_TOKEN stays empty: the port binds to 127.0.0.1. Set one before exposing the service.
fs.writeFileSync('.env', text, { mode: 0o600 });
console.error('.env created with generated credentials (not shown). Next: docker compose up -d');
