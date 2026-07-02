# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Free Code (`fcode`) is a local, offline terminal coding agent — like Claude Code, but the LLM runs
on the user's machine. It is **self-contained: no Ollama, no external LLM tool.** Free Code bundles
its own inference engine — a prebuilt [llama.cpp](https://github.com/ggml-org/llama.cpp)
`llama-server` binary that it downloads on first run — and runs one Qwen2.5-Coder GGUF model against
it. **Zero npm dependencies** (pure Node.js stdlib, ESM, `"type": "module"`, Node ≥18): the engine
binary and model file are downloaded assets, not npm packages. The optional `browser` tool uses
Playwright, loaded lazily only if present.

**First-run flow:** on the first `fcode`, a wizard (`src/engine/index.js`) detects the host's
RAM/CPU/GPU, offers three model tiers (Light 1.5B / Balanced 3B / Full 7B), downloads the chosen
GGUF + the `llama-server` binary into `~/.freecode/`, and records the choice in
`~/.freecode/engine.json`. Later launches skip straight to booting the engine.

## Commands

There is no build step and no `scripts` in `package.json`. Everything runs Node directly.

```bash
fcode                 # run the agent (after `npm link`); TUI in a real terminal, classic in a pipe
fcode --classic       # plain scrolling REPL instead of full-screen TUI
node bin/freecode.js  # run without linking
```

**Tests are the `scripts/smoke*.js` files** — hand-run end-to-end checks, not a framework. Run one:

```bash
node scripts/smoke.js          # full model→tool→model loop (writes+reads a file)
node scripts/smoke_mcp.js      # MCP client against scripts/mock-mcp-server.js
node scripts/smoke_session.js  # session save/resume
node scripts/smoke_diag.js     # post-edit diagnostics
node scripts/smoke_subagent.js # task() delegation
node scripts/smoke_codegraph.js # code graph build + queries (no LLM/engine needed)
```

LLM-driving smoke scripts boot the engine via `scripts/_boot.js` (`bootConfig()`), which calls
`ensureEngineReady` — so they **require a model already installed** (run `fcode` once). Scripts that
only exercise pure logic (UI rendering, session I/O, diagnostics) run without it. There is no lint
config.

## Architecture

The core loop is **not** native OpenAI-style tool-calling. Small local models are unreliable at
populating `message.tool_calls`, so every model turn is forced through llama.cpp's constrained
decoding — `chat()` sends `response_format: { type: "json_schema", … }` (wrapping `RESPONSE_FORMAT`
in `src/llm.js`), which llama-server compiles to a GBNF grammar — producing a fixed envelope:
`{ tool, arguments, final_answer }`. Understanding this envelope is key to the whole system.

Request flow (`src/agent.js`, `Agent.send`):

1. Push user message; `_maybeCompact` summarizes old history if near the `num_ctx` budget.
2. Loop up to `config.maxIterations` (25): stream a reply from `chat()`, `JSON.parse` it into the
   envelope. Non-JSON output is returned as raw text rather than crashing.
3. If `envelope.tool` is empty → return `final_answer` (done). Otherwise execute the tool.
4. Mutating tools pass through `permissionGate.check` first. After a successful `write_file`/
   `edit_file`, `checkFile` (diagnostics) runs and, on failure, marks the result `ok:false` and
   feeds the errors back so the model self-corrects next turn.
5. Tool result is appended as a `user` message tagged `[tool_result:<name>] <json>` and the loop
   continues.

Key modules:

- `src/engine/` — the self-contained inference engine (replaces Ollama). `index.js` = first-run
  wizard + `ensureEngineReady` (the CLI's entry into it); `system.js` = RAM/CPU/GPU detection;
  `models.js` = the one model family + 3 tiers + `recommendTier`; `platform.js` = resolve the right
  llama.cpp release asset from GitHub; `download.js` = stdlib HTTPS download (redirects/progress) +
  a **pure-JS ZIP extractor** (zlib `inflateRaw`, no npm dep); `server.js` = `Engine` spawns/
  health-checks `llama-server` on a free port; `state.js`/`paths.js` = `~/.freecode/` layout +
  `engine.json`.
- `src/llm.js` — talks to the local `llama-server`'s OpenAI-compatible API: `chat()` streams
  `/v1/chat/completions` (SSE, `response_format` json_schema envelope), `complete()` for compaction,
  `checkEngine()` (`/health`), `engineProps()` (`/props`, for `/gpu`). `config.host` = the local
  server base URL. `RESPONSE_FORMAT` lives here.
- `src/tools/index.js` — the built-in tool table. Each tool is a module exporting `schema` (an
  OpenAI-style function schema) and `run(args)`. `mutating: true` marks a tool as permission-gated.
  `describeTools()` renders the schemas into the **text** tool docs the system prompt needs (the
  model gets text docs, not native tool defs). The `code_*` tools are merged in from
  `CODEGRAPH_TOOLS` (see below).
- `src/codegraph/` — built-in **tree-sitter code graph** (self-contained, no npm dep). `grammars.js`
  = language catalog + pinned wasm asset URLs (web-tree-sitter 0.22.6 + tree-sitter-wasms 0.1.12,
  ABI-verified together); `runtime.js` = downloads the runtime + grammar wasms into
  `~/.freecode/grammars/` on first use and loads them via `createRequire` + `Parser.init` (Node has
  no bundled parser); `extract.js` = per-language def/call-site rules + a tree walk that tracks the
  enclosing def scope; `build.js` = walk project → nodes (defs) + edges (name-resolved call edges),
  incremental by mtime/size, stored as JSON in `.freecode/codegraph.json`; `query.js` =
  search/callers/callees/impact/explore over the graph (with an in-process cache);  `tools.js` =
  the five `code_*` agent tools + `buildAndRefresh`. Supported langs: JS/TS/JSX/TSX, Python, Go, Rust.
- `src/toolRegistry.js` — unifies built-in tools with MCP-server tools behind one interface used
  by `Agent`. MCP tools are namespaced `<server>__<tool>` and gated by default (side effects
  unknown). Config: `.freecode/mcp.json` (see `mcp.example.json`).
- `src/config.js` — `DEFAULT_CONFIG` (`model`/`host` filled in at startup once the engine is up).
  `PERF` (num_gpu/num_thread/num_ctx) from env vars, translated to `llama-server` launch flags
  (`-ngl`/`-t`/`-c`) in `src/engine/server.js`.
- `src/systemPrompt.js` — main + subagent system prompts; embeds the text tool docs.
- `src/cli.js` — entry (`main`), slash-command handling, wires the Agent to either TUI or classic UI.
- `src/tui.js` — full-screen TUI (`composeFrame` + runner). `src/ui.js` — classic panels/spinner/diffs.
- `src/session.js` — auto-saves each turn to `.freecode/sessions/<id>.json`. `src/update.js` —
  self-update via git on launch (throttled ~6h).

**Subagents** (`task` tool): `Agent._runSubagent` spawns a child `Agent` with `allowSubagents:false`
(no recursion), its own `Session`, sharing the parent's `toolRegistry` and `permissionGate`. The
`task` tool is injected as text (`TASK_DOC`) only when `allowSubagents` is true — it is not in the
`TOOLS` table.

Two state locations, kept distinct: **per-project** `./.freecode/` (`sessions/`, `logs/` JSONL,
`permissions.json`, `mcp.json`, `codegraph.json`) vs. **global** `~/.freecode/` (`bin/` engine
binary, `models/` GGUF files, `engine.json`, `grammars/` tree-sitter wasm). `src/config.js` defines
the project paths; `src/engine/paths.js` defines the global ones.

The CLI auto-builds the code graph on session start (`setup()` → `buildAndRefresh`); `/index`
rebuilds, `/graph <name>` inspects a symbol. First build downloads ~7MB of grammars; later builds
are incremental (~tens of ms).

## Conventions

- Adding a built-in tool: create `src/tools/<name>.js` exporting `schema` + `run`, then register it
  in `src/tools/index.js` with the correct `mutating` flag. `run` returns a JSON-serializable object
  (returning `{ path }` from a write/edit triggers diagnostics).
- Keep it dependency-free — reach for Node stdlib, not npm. Match the existing ESM `import` style.
  The pure-JS ZIP extractor in `src/engine/download.js` exists specifically to avoid an npm unzip dep;
  the code graph downloads tree-sitter wasm at runtime for the same reason.
- Adding a code-graph language: add an entry to `LANGUAGES` in `src/codegraph/grammars.js` (grammar
  id + file extensions; the wasm must exist in the `tree-sitter-wasms` package) and a rule in `RULES`
  in `src/codegraph/extract.js` (which node types are defs, which are calls). Verify the grammar's
  ABI loads with the pinned runtime before relying on it.
- Env vars are all `FREECODE_*`: `FREECODE_NUM_GPU`/`NUM_THREAD`/`NUM_CTX` (perf → server flags),
  `FREECODE_ENGINE_VARIANT` (`cpu`|`cuda`|`vulkan`; default cpu off macOS, metal on macOS),
  `FREECODE_HOME` (override `~/.freecode/`). No `FREECODE_MODEL` anymore — the model is chosen via
  the first-run wizard / `/model`.
