# synaptree-mcp

A multi-tenant **code knowledge graph** for AI agents. It parses a repository with Tree-sitter,
links symbols across files, stores the result in Neo4j, and exposes it through an
[MCP](https://modelcontextprotocol.io) server (stdio and SSE). It also ships an admin web UI with a
animated call-flow trace, architecture view, and database ERDs that are saved into the same graph so
agents can see your schema next to your code.

**Read-only by design.** The MCP never changes your repository or your source databases. The only thing
it writes is its own index (graph, annotations, ADRs, saved database schemas).

## What problem does it solve?

AI coding agents work blind on large codebases. To answer "what breaks if I change `verifyJwt`?"
they usually grep, open file after file, and stuff raw source into the context window. That is
slow, burns tokens, misses relationships that span files, and gets worse as the repo grows.

synaptree-mcp indexes the repository once into a graph of symbols (functions, classes, routes,
types, files) and the relationships between them (calls, imports, inheritance, type usage). The
agent then asks precise structural questions instead of reading code. The same graph can hold your
database schema (SQL and NoSQL), so the agent also knows which tables a piece of code touches.

## How it helps

- **Fewer tokens, faster answers:** a query returns a small, relevant slice (a call path, a list
  of callers, one snippet) instead of whole files.
- **Impact analysis:** `trace_path` and `detect_changes` show what calls a symbol and what a
  change may affect before you make it.
- **Navigation and onboarding:** `get_architecture`, `search_graph` and `search_code` give a map
  of an unfamiliar repo in a few calls.
- **Schema-aware agents:** `erd_save_to_index`, `get_db_schema` and `get_table_relationships` let an
  LLM understand tables, collections and how they relate.
- **Stays current:** `synaptree-client` (chokidar, 500 ms debounce) re-indexes only the files you change.
- **Scales and isolates:** the graph lives in Neo4j and is partitioned per user and repository.
- **Token guardrails for paid sources:** asks sent to a paid remote API (Claude, Codex or similar) are estimated first, and large asks need approval. Local LLMs and annotation-generating calls are never gated. Limits are editable in Settings.
- **Works with any MCP client:** stdio for local agents, SSE for remote or shared setups.

## Architecture

| High-level design | Low-level design |
| --- | --- |
| [![HLD](docs/hld.svg)](docs/hld.svg) | [![LLD](docs/lld.svg)](docs/lld.svg) |

### Screenshots

Live data from this repository's own index.

| Architecture | Sync |
| --- | --- |
| [![Architecture tab](docs/ui-architecture.png)](docs/ui-architecture.png) | [![Sync tab](docs/ui-sync.png)](docs/ui-sync.png) |

## The UI

Start the server and open <http://localhost:8787/ui/>. Light and dark themes are supported.

- **Trace:** a Flow-Like style call graph (React + xyflow). Edges animate only for the selected
  node, so the rest stays still. Depth 1-5, SVG (grouped layers) and CSV export, reset button.
- **Architecture:** counts, languages, layers, entrypoints, hotspots and ADRs.
- **ERD:** pick a saved connection and its stored schema loads from the index. **Sync up** reads the
  database (read-only), **Generate** uses a *local* LLM to infer relationships and group tables
  (grayed out with a tooltip until a local LLM is configured). Every result is saved to the index
  automatically. **Delete** removes only the saved schema in the synaptree index and needs the
  authorization checkbox; your database and repos are never touched.
- **Sync:** a collapsible **Add new (Claude | Codex)** banner stays on top of the project table
  with two copy-paste sets: add the MCP once, then say `index this repo` in Claude Code or Codex
  inside any repo. Force re-sync, delete a project (two guardrails: type the repo name,
  then type `yes, delete my repo`; this clears the index only). Stale projects can be kept for
  3 or 6 more months.
- **Settings:** read-only database connections (PostgreSQL, MySQL, Oracle, ODBC, SQLite, MongoDB),
  LLM provider (Local or API) with editable token guardrails (paid sources only, conservative defaults).
- **Query / Chat:** read-only Cypher and questions answered from the graph.

## Quick start

```bash
git clone https://github.com/maxh8086/synaptree-mcp && cd synaptree-mcp
npm install
node scripts/init-env.mjs     # writes .env with a random Neo4j password and ports (never printed)
docker compose up -d          # bundled Neo4j 5 Community, compose project "synaptree"
npm start                     # API + UI + SSE on http://127.0.0.1:8787
```

Or run everything in Docker: the image binds `0.0.0.0`; outside Docker the default bind is
`127.0.0.1`. `.env` is authoritative for `NEO4J_*` and `SYNAPTREE_*` (it overrides the parent
environment), and the default Bolt URI is `bolt://127.0.0.1:17687`, not the usual 7687, so it never
collides with another Neo4j on your machine. Use `NEO4J_URI` to point at Neo4j Enterprise, Aura or Memgraph.

### Use it from an MCP client

```bash
claude mcp add synaptree -- node /path/to/synaptree-mcp/src/cli.js --stdio
codex mcp add synaptree -- node /path/to/synaptree-mcp/src/cli.js --stdio
```

SSE clients connect to `http://127.0.0.1:8787/sse`. Set `SYNAPTREE_TOKEN` to require a bearer token.
Every tool takes a `project` argument. If you route through TokenFrugal, index your checkout in
synaptree under the same project name (the checkout folder slug) that its gateway injects.

### Keep it in sync

Run `synaptree-client` next to your code. It watches the folder and posts changed files to
`/api/v1/sync`; each file is purged and rebuilt atomically. Service files for systemd, NSSM
(Windows) and launchd are in `client/`.

#### Standalone client binaries

No Node install needed. Each binary is a Node single-executable build and must be built on its own
OS, so CI builds one per platform (`.github/workflows/client-binaries.yml`; pushing a `v*` tag
attaches them to a GitHub Release, otherwise they are workflow artifacts):

| Platform | Binary |
| --- | --- |
| Windows x64 | `synaptree-client-win-x64.exe` |
| macOS Apple Silicon | `synaptree-client-macos-arm64` |
| macOS Intel | `synaptree-client-macos-x64` |
| Linux x64 (generic, glibc) | `synaptree-client-linux-x64` |
| Linux arm64 (glibc) | `synaptree-client-linux-arm64` |

```bash
synaptree-client path/to/synaptree-client.json
```

Or build for your own OS with `npm run build:client` (output in `dist-client/`). musl distros such
as Alpine are not covered; use the Node client there. Only the Windows binary has been verified by
hand; the macOS and Linux ones are built and smoke-tested by CI.

## Tools

Indexing and graph: `index_repository`, `list_projects`, `index_status`, `snooze_project`,
`delete_project`, `search_graph`, `search_code`, `get_code_snippet`, `trace_path`, `query_graph`
(read-only, writes return 403), `get_architecture`, `get_graph_schema`, `detect_changes`,
`manage_adr`, `ingest_traces`, `annotate_element`, `get_annotations`, `export_graph`, `import_graph`.

`export_graph` returns a project's nodes, edges and annotations as portable JSON
(`synaptree-export/1`; embeddings and tenant ids are stripped). `import_graph` loads that JSON into
any project name, validating labels and edge types first. Use it to back up, move or share an index.

LLM: `estimate_cost`, `ask_flow`, `summarize_symbol`, `get_llm_settings`, `set_llm_settings`,
`get_usage`. Most calls arrive through MCP from the Claude or Codex chat. Guardrails apply only to a
paid remote API source: asks under 50k tokens run, 50k-100k need approval, above 100k need a strong
confirmation, plus a per-minute call cap, a daily budget and a timeout. A local LLM, and calls that
generate annotations (`summarize_symbol`), are exempt. All limits are editable in Settings or via
`set_llm_settings`; the defaults are conservative.

Databases (read-only): `erd_list_connections`, `erd_save_connection`, `erd_delete_connection`,
`erd_test_connection`, `erd_get_model`, `erd_export`, `erd_ai_generate`, `erd_save_to_index`,
`list_db_schemas`, `delete_db_schema`, `get_db_schema`, `get_table_relationships`. NoSQL schemas
are sampled and depth/field-limited, and are reported as truncated when limits apply. Only names,
types and flags are stored, never row values.

## Accuracy: linking is heuristic

Cross-file linking is **not** a full language server. The "Hybrid LST/LSP" pass is Tree-sitter
definitions (Pass 1) plus a cross-file linker (Pass 2) that matches import paths and call
expressions against a global symbol table; no live language servers are run. Calls that match exactly one target become `CALLS`; ambiguous
ones are recorded as `USAGE`. Dynamic dispatch, reflection, macros and generated code can be
missed or mislinked. Treat the graph as a fast, useful map rather than ground truth. Relationships
inferred by name or by a local LLM in an ERD are marked `inferred_name` / `inferred_llm`, not declared.

Edge types: the linker and indexer currently produce `CONTAINS_FOLDER`, `CONTAINS_FILE`, `DEFINES`,
`DEFINES_METHOD`, `MEMBER_OF`, `IMPORTS`, `CALLS`, `CALL_REFERENCE`, `USAGE`, `IMPLEMENTS`, `INHERITS`,
`USES_TYPE` and `HANDLES`. The other names in the schema are reserved for future passes and are never
written today; `get_graph_schema` lists them separately as `produced_edge_types` and
`reserved_edge_types`, plus `populated_edge_types` for what your graph really contains.

Embeddings (optional, `embeddings.url`): at most `embeddings.maxNodes` nodes (default 5000) are embedded,
and a batch is dropped if the returned vectors do not match the index dimension, so a wrong model
cannot corrupt the vector index.

Extra languages: set `SYNAPTREE_GRAMMARS_DIR` to a folder holding `tree-sitter-<name>.wasm` files. A
grammar found there wins over the bundled one; anything missing falls back to the bundled set. A new
language also needs an entry in `src/langs.js` describing its definition and call node types.

Languages without a bundled Tree-sitter grammar (for example R, SQL, GraphQL, Protocol Buffers)
get lightweight pattern-based extraction instead of a full parse. Grammars run as WASM
(`web-tree-sitter`), so there are no native bindings and nothing to compile.

## Tests

```bash
npm test      # node --test tests/unit/*.test.js
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
