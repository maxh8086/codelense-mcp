# Extended benchmark results

Run 2026-10-09 on branch `compact-retrieval-output` (compact output default, git in the Docker image). 16 tasks: t1-t8 are the original set, t9-t16 add more symbols, depths, regex and edge cases. Counts are tiktoken `o200k_base`; cl100k_base is within about 1%. Baseline is `git grep -n` plus a +/-10 line window (+/-25 for snippets); graph is the raw text returned by the MCP tool. Reproduce with the commands in [README.md](README.md); the generated `results/REPORT.md` is git-ignored.

| # | Task | Baseline | Graph | Saved | % |
|---|---|---:|---:|---:|---:|
| 1 | Find definition of `linkRefs` | 759 | 29 | 730 | 96% |
| 2 | Callers of `indexRepository` (depth 1) | 1,003 | 32 | 971 | 97% |
| 3 | Impact of `Db.replaceFile` (depth 3) | 6,244 | 170 | 6,074 | 97% |
| 4 | Fetch `linkRefs` source | 785 | 455 | 330 | 42% |
| 5 | Concept search "savings" | 2,777 | 291 | 2,486 | 90% |
| 6 | List classes | 72 | 64 | 8 | 11% |
| 7 | Architecture overview | 10,122 | 454 | 9,668 | 96% |
| 8 | What changed (clean tree) | 5 | 10 | -5 | -100% |
| 9 | Find definition of `buildTools` | 680 | 27 | 653 | 96% |
| 10 | Callers of `walk` (depth 2) | 3,272 | 130 | 3,142 | 96% |
| 11 | Callees of `indexRepository` (depth 2) | 5,237 | 779 | 4,458 | 85% |
| 12 | Fetch `gitGrep` source | 866 | 241 | 625 | 72% |
| 13 | Regex search `export async function` | 3,348 | 91 | 3,257 | 97% |
| 14 | Search with no hits | 0 | 2 | -2 | n/a |
| 15 | List functions in `compact.js` | 164 | 66 | 98 | 60% |
| 16 | Concept search "tenant" | 14,667 | 1,633 | 13,034 | 89% |
| | **Total** | **49,001** | **4,474** | **44,527** | **91%** |

## Where it did not help

- **Callees (t11)**: the first run showed -218% (779 vs 245) because the baseline only read `indexRepository` itself, which cannot answer "what does it call, two hops deep". Without the feature an agent reads the function, then each callee (`indexFiles`, `walk`, `linkRefs`, `Db.*` ...): 5,237 tokens, so the graph saves 85%. The remaining weakness is precision: the trace includes same-name noise (`.set`, `.get`, `.find`, test fakes, UI files). Prefer depth 1 or a filtered path when only the real callees matter.
- **Clean-tree `detect_changes` (t8)**: 10 vs 5 tokens; a few tokens of overhead (`clean @sha`) for a staleness check git status cannot give.
- **No-hit search (t14)**: 2 tokens, effectively free. Baseline is 0 because grep prints nothing.
- **Class list (t6)**: 64 vs 72, a tie.
- **Snippet of `linkRefs` (t4)**: 42%; the symbol's own source dominates.

## Notes

- Totals are weighted by the large searches (t16, t7, t3); the median task saves about 90%.
- The baseline assumes an agent that greps and reads a narrow window. A whole-file reader would pay several times more.
- Figures are proxies for Claude's tokenizer, which is not public.
