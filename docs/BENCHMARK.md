# synaptree-mcp token benchmark

Repo: synaptree-mcp (branch `compact-retrieval-output`), run 2026-10-09. Scope is the token cost of **reading and retrieving code details**, not indexing.

Reproduce with the tooling in [`Benchmark/`](../Benchmark/README.md) (`tasks.json`, `capture_graph.mjs`, `measure.py`, `test_measure.py`). Raw outputs and the generated report are in `Benchmark/results/` (git-ignored).

> **Estimate quality.** Counts are tiktoken `o200k_base` (cl100k_base is within 1% of it). Claude's own tokenizer is not public, so these are a close proxy, not exact. Both sides (baseline text and graph response text) are the real bytes an agent would receive, tokenised the same way, so there is no eyeballing. chars/4 differs from the tokenizer by 8-25% per task.

## Method

- **Baseline (realistic)**: `git grep -n` over `src/` and `tests/` (excluding the 397 KB `src/ui` bundle), then a +/-10 line window around each hit, overlapping windows merged. Snippet task uses +/-25 around the definition. Architecture lists files and reads the first 40 lines of each hand-written `src/*.js`. Impact analysis follows callers two hops out with the same grep+window step.
- **Graph**: the raw text returned by the MCP tool for each task, captured over SSE from the Docker server, project indexed with a root path.
- Window size is the main assumption; at +/-25 lines the hit-heavy baselines grow about 1.5-2x.

## Results (o200k_base tokens)

Before = JSON output (first run). After = compact default (git-routed `search_code`/`detect_changes`, TSV lists, slim snippet).

| # | Task | Baseline | Before | After | Saved (after) | % saved |
|---|------|---------:|-------:|------:|--------------:|--------:|
| 1 | Find definition of `linkRefs` (`search_graph`) | 759 | 101 | 29 | 730 | 96% |
| 2 | Callers of `indexRepository` (`trace_path`, depth 1) | 1,003 | 87 | 32 | 971 | 97% |
| 3 | Impact of `Db.replaceFile` (`trace_path`, depth 3) | 5,886 | 568 | 170 | 5,716 | 97% |
| 4 | Fetch one symbol's source (`get_code_snippet`) | 785 | 565 | 455 | 330 | 42% |
| 5 | Concept search "savings" (`search_code`) | 2,777 | 1,655 | 292 | 2,485 | 89% |
| 6 | List classes (`query_graph`) | 72 | 145 | 64 | 8 | 11% |
| 7 | Architecture overview (`get_architecture`) | 9,836 | 454 | 454 | 9,382 | 95% |
| 8 | What changed (`detect_changes`) vs `git status --short` | 45 | 69 | 44 | 1 | 2% |
| | **Total** | **21,163** | **3,644** | **1,540** | **19,623** | **93%** |

Baselines were re-measured on the current tree (tasks 2, 3, 5, 8 moved slightly because the repo changed), so compare Before/After columns, not Before against the old baselines. The totals went from 83% to 93% saved. Rows 1-3 and 7 carry most of the saving.

## Where the graph still does NOT help much

- **`detect_changes` (row 8)**: now break-even with `git status --short` (44 vs 45). Its unique value is index drift and staleness, not size.
- **Class list (row 6)**: 64 vs 72 for one grep; effectively a tie.
- **`get_code_snippet` (row 4)**: 42%. The symbol source itself is most of the cost.
- **Small repo**: 21 hand-written source files; a larger repo widens the gap.

## Compact retrieval output (implemented)

Tools above return compact text by default; pass `format: "json"` for the previous output. REST, the UI and the savings tracker still receive objects, only the MCP text layer is rendered.

1. **`detect_changes` via git**: the index stores the commit sha, so staleness is one comparison. Output is `clean @<sha7>` or `A/M/D/G path` lines plus an "index is behind" hint. Markdown files (no extractor, never hashed) are no longer reported as added.
2. **`search_code` via `git grep -n`**: `--untracked` keeps new files, gitignored files and `ui/` are excluded, output is `file:line:text`. Regexes using JS-only syntax (`d`, `(?:`, lookarounds) fall back to the JS RegExp walk, which is also the fallback when git is missing or the root is not a repo.
3. **Flat lists as TSV with a header** (`search_graph`, `trace_path`, `query_graph`), with tab/newline escaping in cells.
4. **Slim `get_code_snippet`**: file, lines and code only, CRLF normalised.

Cons mitigated: the Docker image now installs git (`apk add git`) and runs git with `safe.directory=*` and `core.autocrlf=input` (a CRLF bind mount otherwise showed ~23 phantom dirty files); every git path falls back to the JS implementation when git returns an error; JSON clients opt in with `format: "json"`. 95 unit tests pass, including git routing, CRLF snippets and the MCP text layer.

Keep the graph for what git cannot do: callers, impact depth, architecture.

## Comparison with the built-in estimate (`get_usage`)

Server counters after this session: baseline 222,048, response 2,235, **saved 219,825**. `get_architecture` alone contributes a 129,825-token baseline because the server counts every file it thinks an agent would open, including the generated dist bundle. `search_code`, `query_graph` and `detect_changes` are not tracked.

| | Baseline | Graph | Saved |
|---|---:|---:|---:|
| `get_usage` built-in (approx. same task set) | ~213,000 | ~2,200 | ~211,000 |
| This benchmark, realistic (tokenizer) | 21,163 | 1,540 | 19,623 |

The built-in "tokens saved" is about **11x the realistic figure**. Its percentage (99%) looks fine; its absolute number should not be quoted as real savings. The fix would be to exclude generated files and model grep+window reads rather than whole files. `src/savings.js` is unchanged.

## Checks from the first version (fixed or verified)

- **`trace_path` missed callers (fixed).** The default edge types omitted `CALL_REFERENCE`, so receiver calls (`db.replaceFile(...)`) were invisible. `src/tools.js` now includes `CALL_REFERENCE`, `USAGE`, `IMPLEMENTS`, `INHERITS`, `USES_TYPE`, `IMPORTS`, with a regression test in `tests/unit/tools.test.js` (63 pass). Verified on the rebuilt Docker server. The long-running stdio server (`synaptree-host`) needs a restart to pick it up.
- **Hierarchy (verified).** The earlier empty result was a malformed query. All 6 classes list correctly; `ErdError` and `HttpError` extend the built-in `Error`, which is not indexed. `INHERITS` verified with a throwaway fixture (`Puppy -> Dog -> Animal`). `IMPLEMENTS` was not tested.
- **`detect_changes` dirty tree (tested).** The index was 13 files behind disk when first called; it surfaces real index drift that `git status` cannot, which is its one unique value.
- **No local root on Docker**: `search_code`/`detect_changes` return 404 until `index_repository` is called with a container-visible root path (`/workspace/<repo>`) on the same server you query. A plugin-registered server and the one on port 8787 do not share that state.

## Not covered

Window size (+/-10 lines) and the two-hop impact follow-up are assumptions about agent behaviour; a different agent could land between this baseline and a whole-file read (earlier chars/4 whole-file total: 103,568). `IMPLEMENTS` edges and `ask_flow`/`summarize_symbol` were not measured. Throwaway projects `hier-fixture` and `synaptree-bench` remain in the index; removing them needs `delete_project` with a typed confirmation.
