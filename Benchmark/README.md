# Benchmark

Token cost of *retrieving code* (search, callers, snippets, overview, changes) with synaptree versus flat `git grep` + line-window reads. Indexing cost is out of scope.

```bash
python -m venv Benchmark/.venv && Benchmark/.venv/Scripts/pip install -r Benchmark/requirements.txt
node Benchmark/capture_graph.mjs http://127.0.0.1:8787 <project>   # saves raw tool responses to results/graph/
Benchmark/.venv/Scripts/python.exe Benchmark/measure.py            # writes results/REPORT.md
Benchmark/.venv/Scripts/python.exe -m unittest discover -s Benchmark -p "test_*.py"
```

- `tasks.json`: 8 tasks, each with a graph call and a baseline spec.
- Counts: tiktoken `o200k_base` and `cl100k_base` (proxies; Claude's tokenizer is not public) plus chars/4.
- The project must be indexed with a root path the server can see (`search_code` and `detect_changes` need it). For the Docker server use `root_path: /workspace/<repo>`, via the same endpoint you capture from.
- `results/` and `.venv/` are git-ignored.
- Tools return compact text by default. `capture_graph.mjs` passes `format: 'json'` only where it needs to parse a result (name resolution).
- `search_code` and `detect_changes` use git when available (the Docker image installs it) and fall back to a JS walk otherwise.
