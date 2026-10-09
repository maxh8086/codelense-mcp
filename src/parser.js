// Tree-sitter loader. Uses web-tree-sitter (WASM) so there are no native bindings to build.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import Parser from 'web-tree-sitter';

const require = createRequire(import.meta.url);
let ready = null;
const languages = new Map();

const bundledDir = () => path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');

// A grammar in grammars_dir wins (newer or extra builds); anything missing falls back to the bundled set.
function wasmFile(extra, name) {
  const file = `tree-sitter-${name}.wasm`;
  if (extra && fs.existsSync(path.join(extra, file))) return path.join(extra, file);
  return path.join(bundledDir(), file);
}

export async function initParser() {
  ready ??= Parser.init();
  await ready;
}

// Returns a parser for the registry entry, or null when its grammar is not bundled.
export async function parserFor(langCfg, grammarsDir) {
  if (!langCfg?.wasm) return null;
  await initParser();
  let lang = languages.get(langCfg.wasm);
  if (!lang) {
    const file = wasmFile(grammarsDir, langCfg.wasm);
    if (!fs.existsSync(file)) return null;
    lang = await Parser.Language.load(file);
    languages.set(langCfg.wasm, lang);
  }
  const p = new Parser();
  p.setLanguage(lang);
  return p;
}

export async function parseSource(langCfg, source, grammarsDir) {
  const p = await parserFor(langCfg, grammarsDir);
  if (!p) return null;
  try {
    return p.parse(source);
  } finally {
    p.delete();
  }
}
