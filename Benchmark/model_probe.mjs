// Probes local Ollama models on thinker-style jobs with checkable answers.
// usage: node Benchmark/model_probe.mjs [--runs=3] model1 model2 ...
// Never unloads models it did not load: it waits while another model is resident.
const args = process.argv.slice(2);
const runs = Number((args.find((a) => a.startsWith('--runs=')) ?? '--runs=3').split('=')[1]);
const models = args.filter((a) => !a.startsWith('--'));
const HOST = 'http://localhost:11434';

const json = (t, keys) => { try { const j = JSON.parse(t.match(/\{[\s\S]*\}/)[0]); return keys(j); } catch { return false; } };
const T = [
  // debugging
  { cat: 'debug', id: 'off-by-one', prompt: 'Find the bug in one sentence:\nfunction last(a){ return a[a.length]; }', ok: (t) => /length\s*-\s*1|off.by.one|undefined|out of (range|bounds)/i.test(t) },
  { cat: 'debug', id: 'async-await', prompt: 'Find the bug in one sentence:\nasync function load(){ const r = fetch(url); return r.json(); }', ok: (t) => /await/i.test(t) },
  { cat: 'debug', id: 'mutation', prompt: 'Find the bug in one sentence:\nfunction addItem(list, x){ list.push(x); return list; }\nconst a=[1]; const b=addItem(a,2); // user expects a to stay [1]', ok: (t) => /(mutat|modif|in.place|copy|same (array|reference))/i.test(t) },
  { cat: 'debug', id: 'equality', prompt: 'Find the bug in one sentence:\nif (x = 5) { run(); }', ok: (t) => /(assign|==|===|comparison|always true)/i.test(t) },
  // review
  { cat: 'review', id: 'injection', prompt: 'Review in two sentences:\nconst q = "MATCH (n) WHERE n.name = \'" + req.query.name + "\' RETURN n"; db.run(q);', ok: (t) => /inject/i.test(t) && /param/i.test(t) },
  { cat: 'review', id: 'secret', prompt: 'Review in two sentences:\nconst apiKey = "sk-live-9f8a7b6c5d4e3f2a1b"; fetch(url, { headers: { Authorization: apiKey } });', ok: (t) => /(hard.?cod|secret|credential|env|leak|commit)/i.test(t) },
  { cat: 'review', id: 'path', prompt: 'Review in two sentences:\napp.get("/f", (req,res)=> res.sendFile("/data/" + req.query.name));', ok: (t) => /(traversal|\.\.|path|sanitiz|validat)/i.test(t) },
  // structured output
  { cat: 'json', id: 'json-name', prompt: 'Return ONLY a JSON object with keys "name" and "lang" for: "synaptree-mcp is written in JavaScript".', ok: (t) => json(t, (j) => /synaptree/i.test(j.name) && /javascript/i.test(j.lang)) },
  { cat: 'json', id: 'json-list', prompt: 'Return ONLY a JSON object {"tools":[...]} listing the three tool names in: "Use search_graph to find symbols, trace_path to follow calls and get_code_snippet to read one."', ok: (t) => json(t, (j) => Array.isArray(j.tools) && j.tools.length === 3 && j.tools.includes('trace_path')) },
  // summaries
  { cat: 'summary', id: 'choose-depth', prompt: 'Summarise in one sentence what this does:\nfunction chooseDepth(cap){ for(let d=5; d>=1; d--){ if(estimate(d)<=cap) return d; } return 1; }', ok: (t) => /(largest|highest|deepest|maximum|greatest|biggest)/i.test(t) && /depth/i.test(t) && /(cap|limit|budget|token)/i.test(t) },
  { cat: 'summary', id: 'dedupe', prompt: 'Summarise in one sentence what this does:\nconst u = [...new Map(rows.map(r => [r.id, r])).values()];', ok: (t) => /(uniq|dedup|duplicate|distinct)/i.test(t) && /id/i.test(t) },
  // reasoning
  { cat: 'reason', id: 'order', prompt: 'Answer with one word. A calls B, B calls C. If C changes its return type, which function is directly affected first?', ok: (t) => /\bB\b/.test(t) },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resident = async () => (await fetch(`${HOST}/api/ps`).then((x) => x.json())).models.map((m) => m.name);
const strip = (s) => s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim();

for (const model of models) {
  // wait for the GPU: only proceed when nothing foreign is loaded
  for (let i = 0; i < 120; i++) {
    const r = await resident();
    if (r.length === 0 || r.every((n) => n === model)) break;
    if (i === 0) console.error(`waiting for GPU (resident: ${r.join(', ')})`);
    await sleep(15000);
  }
  const perCat = {};
  let pass = 0, total = 0, ms = 0, toks = 0, fail = [];
  for (let run = 0; run < runs; run++) {
    for (const t of T) {
      const s = Date.now();
      const r = await fetch(`${HOST}/api/generate`, { method: 'POST', body: JSON.stringify({ model, prompt: t.prompt, stream: false, keep_alive: '2m', options: { temperature: 0.1, num_predict: model.includes('deepseek-r1') ? 900 : 200 } }) }).then((x) => x.json());
      ms += Date.now() - s; toks += r.eval_count ?? 0;
      const good = !r.error && t.ok(strip(r.response ?? ''));
      total++; pass += good;
      (perCat[t.cat] ??= [0, 0]); perCat[t.cat][0] += good; perCat[t.cat][1]++;
      if (!good) fail.push(t.id);
    }
  }
  const cats = Object.entries(perCat).map(([c, [p, n]]) => `${c}:${p}/${n}`).join(' ');
  const uniq = [...new Set(fail)].join(',');
  console.log(`${model.padEnd(22)} ${String(pass).padStart(2)}/${total} ${((100 * pass) / total).toFixed(0).padStart(3)}%  ${(ms / total / 1000).toFixed(1)}s/task  ${(toks / (ms / 1000)).toFixed(0)} tok/s  ${cats}  fails[${uniq}]`);
  await fetch(`${HOST}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {});
}
