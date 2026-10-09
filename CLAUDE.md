# CLAUDE.md (sample for projects that use TokenFrugal)

Copy to your project's `CLAUDE.md` (or `~/.claude/CLAUDE.md`) and adjust. Requires the `tokenfrugal` MCP server to be registered.

## Delegation rules

You are the lead architect. Keep cloud tokens for design, cross-module reasoning and decisions. Hand routine work to the local models through the `tokenfrugal` MCP server.

| Work | Call |
| --- | --- |
| Code, tests, fixtures, schemas, docstrings, regex, lint fixes | `dispatch_task(agent="engineering-...", task="...")` (builder role) |
| Debugging, code review, analysis, summaries, research notes | `dispatch_task(agent="...", task="...")` (thinker roles) |
| Multi-step work | `plan_add` first, then `dispatch_task(..., plan_id=N)` per task |

Use `list_roles` to see agent slugs. Replies are capped summaries; call `get_detail(task_id)` only when you need the full output. On failure call `resume_task(task_id)` once, then re-scope the task smaller.

**Haiku fallback:** if `tokenfrugal` does not deliver quality execution (no file change despite a "done" report, failing tests, wrong or partial output, or still failing after one `resume_task` plus one re-scope), delegate the same task to a Haiku subagent (`claude-haiku-4-5`, e.g. `Agent` with `model: "haiku"`) rather than writing it on the orchestrator model. Verify its result the same way and note that the fallback was used.

## Context budget

Local models run 16k-32k context. Point them at file paths in the workspace instead of pasting files. Pass only signatures and the types they need.

## Verification

- Run the project's test command after every delegated change; never accept delegated code unrun.
- Mark plan tasks `done` only with evidence (a real git sha or a finished task id).

## Never

- Paste secrets into tasks or chat. Secrets live in `~/.docker/mcp/mcp.env`.
- Add Co-Authored-By trailers or "generated with" footers to commits and PRs, unless you want them.
