# Extended benchmark results

Run 2026-10-09 on branch `compact-retrieval-output` (compact output default, git in the Docker image). 16 tasks: t1-t8 are the original set, t9-t16 add more symbols, depths, regex and edge cases. Counts are tiktoken `o200k_base`; cl100k_base is within about 1%. Baseline is `git grep -n` plus a +/-10 line window (+/-25 for snippets); graph is the raw text returned by the MCP tool. Reproduce with the commands in [README.md](README.md); the generated `results/REPORT.md` is git-ignored.

| # | Task | Baseline | Graph | Saved | % |
|---|---|---:|---:|---:|---:|
| 1 | Find definition of `linkRefs` | 759 | 29 | 730 | 96% |
| 2 | Callers of `indexRepository` (depth 1) | 1,003 | 32 | 971 | 97% |
| 3 | Impact of `Db.replaceFile` (depth 3) | 6,250 | 119 | 6,131 | 98% |
| 4 | Fetch `linkRefs` source | 785 | 455 | 330 | 42% |
| 5 | Concept search "savings" | 2,777 | 765 | 2,012 | 72% |
| 6 | List classes | 72 | 64 | 8 | 11% |
| 7 | Architecture overview | 10,122 | 454 | 9,668 | 96% |
| 8 | What changed (clean tree) | 5 | 10 | -5 | -100% |
| 9 | Find definition of `buildTools` | 686 | 27 | 659 | 96% |
| 10 | Callers of `walk` (depth 2) | 5,200 | 55 | 5,145 | 99% |
| 11 | Callees of `indexRepository` (depth 2) | 5,237 | 604 | 4,633 | 88% |
| 12 | Fetch `gitGrep` source | 874 | 244 | 630 | 72% |
| 13 | Regex search `export async function` | 3,348 | 356 | 2,992 | 89% |
| 14 | Search with no hits | 0 | 2 | -2 | n/a |
| 15 | List functions in `compact.js` | 164 | 66 | 98 | 60% |
| 16 | Concept search "tenant" | 14,858 | 1,671 | 13,187 | 89% |
| | **Total** | **52,140** | **4,953** | **47,187** | **90%** |

## Where it did not help

- **Callees (t11)**: the first run showed -218% (779 vs 245) because the baseline only read `indexRepository` itself, which cannot answer "what does it call, two hops deep". Without the feature an agent reads the function, then each callee (`indexFiles`, `walk`, `linkRefs`, `Db.*` ...): 5,237 tokens, so the graph saves 88%. The remaining weakness is precision: the trace includes same-name noise (`.set`, `.get`, `.find`, test fakes, UI files). Prefer depth 1 or a filtered path when only the real callees matter.
- **Clean-tree `detect_changes` (t8)**: 10 vs 5 tokens; a few tokens of overhead (`clean @sha`) for a staleness check git status cannot give.
- **No-hit search (t14)**: 2 tokens, effectively free. Baseline is 0 because grep prints nothing.
- **Class list (t6)**: 64 vs 72, a tie.
- **Snippet of `linkRefs` (t4)**: 42%; the symbol's own source dominates.

## Corrections since the first publication

- **t10 and t11 baselines were understated.** `git grep -E` rejected an unescaped `(` and `measure.py` swallowed the error, so the baseline silently covered fewer hits (t10 was 3,272, now 5,200). `measure.py` now fails on a `git grep` error and the patterns are escaped.
- **`trace_path` now excludes test files by default**, which shrank the t3, t10 and t11 graph output (t11 779 to 604).
- **`search_code` git path dropped lines in CRLF files** (each line ended in a carriage return, which the line regex rejected). Fixed with a CRLF test. t5 and t13 grew because they now count those hits and the graph search covers the whole repo (including `Benchmark/`) while the baseline greps `src/` and `tests/`.
- t8 is shown for a clean tree; on a dirty tree it is 24 vs 23.

## Notes

- Totals are weighted by the large searches (t16, t7, t3); the median task saves about 90%.
- The baseline assumes an agent that greps and reads a narrow window. A whole-file reader would pay several times more.
- Figures are proxies for Claude's tokenizer, which is not public.
