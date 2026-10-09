// Builds a standalone codelense-client executable for the OS/arch this script runs on
// (Node single executable application: esbuild bundle + node binary + postject).
// Cross-OS builds run in CI: .github/workflows/client-binaries.yml.
// Usage: node scripts/build-client.mjs [outDir]   (default: dist-client)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const out = path.resolve(process.argv[2] ?? 'dist-client');
const plat = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] ?? process.platform;
const arch = process.arch === 'x64' ? 'x64' : process.arch;
const name = `codelense-client-${plat}-${arch}${process.platform === 'win32' ? '.exe' : ''}`;
fs.mkdirSync(out, { recursive: true });

const bundle = path.join(out, 'client.cjs');
await build({
  entryPoints: ['client/sea-entry.js'], bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outfile: bundle, logLevel: 'warning', external: ['fsevents'],
});

const blob = path.join(out, 'sea-prep.blob');
const cfg = path.join(out, 'sea-config.json');
fs.writeFileSync(cfg, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', cfg], { stdio: 'inherit' });

const exe = path.join(out, name);
fs.copyFileSync(process.execPath, exe);
if (process.platform === 'darwin') { try { execFileSync('codesign', ['--remove-signature', exe]); } catch {} }
const args = [path.resolve('node_modules/postject/dist/cli.js'), exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.execPath, args, { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);
if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
for (const f of [bundle, blob, cfg]) fs.rmSync(f, { force: true });
console.log(`built ${exe} (${(fs.statSync(exe).size / 1e6).toFixed(0)} MB)`);
