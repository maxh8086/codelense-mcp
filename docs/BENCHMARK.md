# synaptree-mcp token benchmark

Repo: synaptree-mcp (main, uncommitted changes to `src/tools.js` and `tests/unit/tools.test.js`), run 2026-10-09. Scope is the token cost of **reading and retrieving code details**, not indexing.

Reproduce with the tooling in [`Benchmark/`](../Benchmark/README.md) (`tasks.json`, `capture_graph.mjs`, `measure.py`, `test_measure.py`). Raw outputs and the generated report are in `Benchmark/results/` (git-ignored).

> **Estimate quality.** Counts are tiktoken `o200k_base` (cl100k_base is within 1% of it). Claude's own tokenizer is not public, so these are a close proxy, not exact. Both sides (baseline text and graph response text) are the real bytes an agent would receive, tokenised the same way, so there is no eyeballing. chars/4 differs from the tokenizer by 8-25% per task.

## Method

- **Baseline (realistic)**: `git grep -n` over `src/` and `tests/` (excluding the 397 KB `src/ui` bundle), then a +/-10 line window around each hit, overlapping windows merged. Snippet task uses +/-25 around the definition. Architecture lists files and reads the first 40 lines of each hand-written `src/*.js`. Impact analysis follows callers two hops out with the same grep+window step.
- **Graph**: the raw text returned by the MCP tool for each task, captured over SSE from the Docker server, project indexed with a root path.
- Window size is the main assumption; at +/-25 lines the hit-heavy baselines grow about 1.5-2x.

## Results (o200k_base tokens)

| # | Task | Baseline | Graph | Saved | % saved |
|---|------|---------:|------:|------:|--------:|
| 1 | Find definition of `linkRefs` (`search_graph`) | 759 | 101 | 658 | 87% |
| 2 | Callers of `indexRepository` (`trace_path` in, depth 1) | 935 | 87 | 848 | 91% |
| 3 | Impact of `Db.replaceFile` (`trace_path` in, depth 3) | 5,813 | 568 | 5,245 | 90% |
| 4 | Fetch one symbol's source (`get_code_snippet`) | 785 | 565 | 220 | 28% |
| 5 | Concept search "savings" (`search_code`) | 2,752 | 1,655 | 1,097 | 40% |
| 6 | List classes (`query_graph`) | 72 | 145 | -73 | -101% |
| 7 | Architecture overview (`get_architecture`) | 9,809 | 454 | 9,355 | 95% |
| 8 | What changed (`detect_changes`) vs `git status --short` | 29 | 69 | -40 | -138% |
| | **Total** | **20,954** | **3,644** | **17,310** | **83%** |

The saving is concentrated in three tasks (architecture, impact analysis, callers: 15.4k of the 17.3k saved). Rows 4, 5, 6 and 8 are marginal or negative. The earlier chars/4 draft said 87%; the tokenizer says 83%, mostly because `search_code` (row 5) was under-estimated (70% -> 40%).

## Where the graph did NOT help or cost more

- **`detect_changes` (row 8)**: 69 tokens vs 29 for `git status --short`. The Docker server cannot run git (`git_dirty: null`), so it also lists files as "added" when the index is simply stale, including my own scratch files.
- **Class list (row 6)**: 145 vs 72. One `git grep` answers it; the Cypher response is pretty-printed JSON with a key per field. The graph only wins on hierarchy depth.
- **`search_code` (row 5)**: grep with JSON wrapping (5,485 characters for 19+ matches), includes `README.md` and `ui/` hits, and the 40% saving exists only because the baseline adds context windows around every hit.
- **`get_code_snippet` (row 4)**: 28%. The returned JSON carries CRLF (`\r\n`) whitespace from the source file and extra fields.
- **Small repo**: 21 hand-written source files; a larger repo widens the gap.

## Can we route it through git?

Yes for part of it. The retrieval-side waste is in JSON framing and in tools that duplicate what git already answers. Recommendations, in order of value, not yet implemented:

1. **`detect_changes` via git**: `git status --short` / `git diff --name-status <indexed_sha>` for the dirty list, and store the commit sha at index time so staleness is one comparison. Target is roughly 30 tokens instead of 69. Needs git available where the server runs (not present in the Docker image today; the host stdio server has it).
2. **`search_code` via `git grep -n`**: respects `.gitignore`, skips the dist bundle, and returns compact `file:line:text` lines under a hit cap instead of pretty JSON. Expect close to the 2,752-token grep baseline for the match lines, and less with a smaller default context.
3. **Compact output for flat lists** (`query_graph` rows, `search_graph`): TSV or `name<TAB>file` lines instead of an object per row. Row 6 would drop from 145 to about 70.
4. **Slim `get_code_snippet` default**: normalise CRLF, return `file`, `lines`, `code` only; make neighbours opt-in. Row 4 would save about 45-50% instead of 28%.
5. Keep the graph for what git cannot do: callers, impact depth, architecture. These already save 90%+.

Together these would move rows 4-8 to roughly break-even or better without touching the three rows that carry the result. I can implement 1-4 and re-run `Benchmark/` to measure; I have not changed any server code for this.

## Comparison with the built-in estimate (`get_usage`)

Server counters after this session: baseline 222,048, response 2,235, **saved 219,825**. `get_architecture` alone contributes a 129,825-token baseline because the server counts every file it thinks an agent would open, including the generated dist bundle. `search_code`, `query_graph` and `detect_changes` are not tracked.

| | Baseline | Graph | Saved |
|---|---:|---:|---:|
| `get_usage` built-in (approx. same task set) | ~213,000 | ~2,200 | ~211,000 |
| This benchmark, realistic (tokenizer) | 20,954 | 3,644 | 17,310 |

The built-in "tokens saved" is about **12x the realistic figure**. Its percentage (99%) looks fine; its absolute number should not be quoted as real savings. The fix would be to exclude generated files and model grep+window reads rather than whole files. `src/savings.js` is unchanged.

## Checks from the first version (fixed or verified)

- **`trace_path` missed callers (fixed).** The default edge types omitted `CALL_REFERENCE`, so receiver calls (`db.replaceFile(...)`) were invisible. `src/tools.js` now includes `CALL_REFERENCE`, `USAGE`, `IMPLEMENTS`, `INHERITS`, `USES_TYPE`, `IMPORTS`, with a regression test in `tests/unit/tools.test.js` (63 pass). Verified on the rebuilt Docker server. The long-running stdio server (`synaptree-host`) needs a restart to pick it up.
- **Hierarchy (verified).** The earlier empty result was a malformed query. All 6 classes list correctly; `ErdError` and `HttpError` extend the built-in `Error`, which is not indexed. `INHERITS` verified with a throwaway fixture (`Puppy -> Dog -> Animal`). `IMPLEMENTS` was not tested.
- **`detect_changes` dirty tree (tested).** The index was 13 files behind disk when first called; it surfaces real index drift that `git status` cannot, which is its one unique value.
- **No local root on Docker**: `search_code`/`detect_changes` return 404 until `index_repository` is called with a container-visible root path (`/workspace/<repo>`) on the same server you query. A plugin-registered server and the one on port 8787 do not share that state.

## Not covered

Window size (+/-10 lines) and the two-hop impact follow-up are assumptions about agent behaviour; a different agent could land between this baseline and a whole-file read (earlier chars/4 whole-file total: 103,568). `IMPLEMENTS` edges and `ask_flow`/`summarize_symbol` were not measured. Throwaway projects `hier-fixture` and `synaptree-bench` remain in the index; removing them needs `delete_project` with a typed confirmation.
