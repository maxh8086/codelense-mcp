# codelense-mcp

A multi-tenant **code knowledge graph** for AI agents. It parses a repository with Tree-sitter,
links symbols across files, stores the result in Neo4j, and exposes it through an
[MCP](https://modelcontextprotocol.io) server (stdio and SSE).

> **Status: under active development.** The graph vocabulary, language registry and config are in
> place. The indexer, linker, MCP tools, server, client daemon and Docker packaging are being
> built. Nothing here is released yet.

## Planned design

- **Storage:** its own bundled Neo4j 5 (Docker Compose, own volume). Any Bolt/openCypher
  endpoint also works via `NEO4J_URI` (Neo4j Enterprise, Aura, Memgraph).
- **Tenancy:** every node and edge carries `user_id`, `repo_name` and a `qualified_name`
  (`<project>.<path_parts>.<symbol>`), enforced by a composite unique constraint.
- **Graph model:** 13 node labels and 25 edge types. Only some edge types are populated by the
  indexer; the rest are reserved in the schema. The README will list which when the indexer lands.
- **Indexing:** Pass 1 extracts definitions per file with Tree-sitter. Pass 2 links calls, imports,
  inheritance and type usage across files. Re-indexing a changed file purges and rebuilds its
  sub-tree atomically.
- **Tools (14):** `index_repository`, `list_projects`, `delete_project`, `index_status`,
  `search_graph`, `trace_path`, `detect_changes`, `query_graph` (read-only), `get_graph_schema`,
  `get_code_snippet`, `get_architecture`, `search_code`, `manage_adr`, `ingest_traces`.
- **Also:** an `/api/v1/sync` endpoint, a small web UI, a file-watching client daemon, optional
  bearer-token auth (`CODELENSE_TOKEN`), and optional embeddings for vector search.

## Accuracy: linking is heuristic

Cross-file linking is **not** a full language server. It resolves names against a global symbol
table built from the syntax trees. Calls that match exactly one target become `CALLS`; ambiguous
ones are recorded as `USAGE`. Dynamic dispatch, reflection, macros and generated code can be
missed or mislinked. Treat the graph as a fast, useful map rather than ground truth.

Languages without a bundled Tree-sitter grammar (for example R, SQL, GraphQL, Protocol Buffers)
get lightweight pattern-based extraction instead of a full parse.

## Quick start (planned)

```bash
git clone https://github.com/maxh8086/codelense-mcp && cd codelense-mcp
node scripts/init-env.mjs     # generates a random Neo4j password into .env
docker compose up -d
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
