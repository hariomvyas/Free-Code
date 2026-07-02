<div align="center">

# Free Code

**A local, offline coding agent CLI — no API keys, no cloud, no bill, no Ollama.**

Runs entirely on your machine against a small open-source LLM. Free Code is **self-contained**: it
bundles its own inference engine (a prebuilt [llama.cpp](https://github.com/ggml-org/llama.cpp)
binary it downloads for you) and one Qwen2.5-Coder model — nothing else to install.
Built to work on boxes with as little as **8GB of RAM**.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)]()
[![Offline](https://img.shields.io/badge/runs-100%25%20offline-important.svg)]()

</div>

---

## What is this?

Free Code is a terminal coding agent in the same spirit as Claude Code — you talk to it in
plain English, it reads your files, edits them, runs shell commands, and reports back — except
the model runs **on your machine**, not in someone else's datacenter. Zero npm dependencies,
zero telemetry, zero API keys, and **no Ollama or other engine to install** — Free Code brings
its own.

```
$ fcode
Free Code v0.1.0 — model: Full · Qwen2.5-Coder 7B  engine: llama.cpp
cwd: D:\projects\my-app

you> find the function that handles login and add input validation
  → grep({"pattern":"function login","path":"src"})
  → read_file({"path":"src/auth.js"})
  → edit_file({"path":"src/auth.js","old_string":"...","new_string":"..."})

fcode> Added email/password validation to login() in src/auth.js.
```

## Features

| | |
|---|---|
| 🧠 **Local model** | Runs on your own machine via a bundled llama.cpp engine — no Ollama, no API keys |
| 🧭 **Guided setup** | First run analyzes your machine and offers 3 model tiers to pick from |
| 🪶 **Runs on 8GB RAM** | Light tier is a 1.5B quantized coder model (~1GB on disk) |
| 🛠️ **Rich toolset** | files, shell, search, **web search + fetch**, optional real browser |
| 🕸️ **Code graph** | Built-in tree-sitter index — the agent navigates by callers/callees, not just grep |
| 🌐 **Internet access** | `web_search` (no API key) and `web_fetch` read live web pages |
| 🔌 **MCP servers** | Plug in any Model Context Protocol tool server |
| 💾 **Sessions** | Auto-saved conversations you can list and resume |
| 🩺 **Diagnostics** | Auto syntax-checks code the model writes and feeds back errors |
| 🎨 **Rich TUI** | Boxed panels, colored diffs, live spinner, per-tool icons |
| ✅ **Permission-gated** | Confirms before writes, edits, or shell commands — persists per project |
| 📦 **Zero dependencies** | Pure Node.js standard library — nothing to `npm install`* |

<sub>*`package.json` has no dependencies. The llama.cpp engine, model, and tree-sitter code-graph
runtime are downloaded assets (not npm packages); the optional `browser` tool uses Playwright,
installed only if you want JS-rendered browsing.</sub>

### Tools

| Tool | What it does |
|---|---|
| `read_file` / `write_file` / `edit_file` / `multi_edit` | Read and modify files |
| `ls` / `glob` / `grep` | Explore and search the project |
| `code_search` / `code_callers` / `code_callees` / `code_impact` / `code_explore` | Navigate code via the built-in code graph (see below) |
| `bash` | Run shell commands (permission-gated) |
| `web_search` | Search the web via DuckDuckGo (no API key) |
| `web_fetch` | Fetch a URL and return readable text |
| `browser` | Open a URL in a real headless browser (needs Playwright) |
| `task` | Delegate a focused subtask to a fresh subagent with its own context |
| _MCP tools_ | Anything exposed by your configured MCP servers |

### Subagents

The model can call `task(description, prompt)` to spawn a **subagent** — a fresh
agent with its own separate context and the same tools. The subagent runs the
delegated prompt to completion and returns a concise report, which keeps the main
conversation's context small during big research or multi-step chunks. Subagents
can't spawn their own subagents (no infinite recursion). You'll see
`🤖 subagent: …` when one starts, with its steps indented (`⤷`).

### Code graph

Free Code ships with its own **code graph** — a semantic index of your project built
with [tree-sitter](https://tree-sitter.github.io). Instead of blindly grepping, the agent
navigates by real structure: definitions and the call edges between them.

- **Languages:** JavaScript/TypeScript (+JSX/TSX), Python, Go, Rust.
- **Built on start:** the graph is indexed when a session begins and updated incrementally
  (only changed files are reparsed). Rebuild any time with `/index`.
- **Self-contained:** the tree-sitter runtime + grammars are downloaded once (~7MB) into
  `~/.freecode/grammars/` on first use — **no npm install, no build step.** The graph itself
  is plain JSON in `.freecode/codegraph.json` (no SQLite).

The agent gets five tools from it:

| Tool | What it answers |
|---|---|
| `code_search` | Where is symbol X? (name → file:line, kind) |
| `code_callers` | Who calls X? |
| `code_callees` | What does X call? |
| `code_impact` | If I change X, what's the blast radius? (transitive callers) |
| `code_explore` | Show X's source + its callers and callees in one call |

Peek at it yourself with `/graph <name>`.

## Interface

`fcode` launches a **full-screen TUI** when run in a real terminal: a scrollable
transcript, a fixed input bar with line editing and history (↑/↓), a live status
line (spinner + elapsed + token count), `PgUp`/`PgDn` to scroll back, and inline
permission prompts. **`ESC` interrupts** the current turn (stops the model mid-answer)
without quitting; `Ctrl+C` quits.

Prefer a plain scrolling REPL? Run `fcode --classic`. Piped/non-interactive input
(`echo "..." | fcode`) automatically uses classic mode and processes each line.

## Requirements

- **[Node.js](https://nodejs.org) 18+**
- That's it. The inference engine and model are downloaded on first run — no Ollama, no Python,
  nothing else to install. (You need a working internet connection **once**, for that first setup;
  everything runs offline afterward.)

## Install

### One-line install (recommended)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/hariomvyas/Free-Code/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/hariomvyas/Free-Code/main/install.ps1 | iex
```

This clones the repo and links the `fcode` command globally. The **first time you run `fcode`**,
a setup wizard analyzes your machine, offers three model tiers, and downloads your pick plus the
llama.cpp engine. After that, just run `fcode`.

### Manual install

```bash
git clone https://github.com/hariomvyas/Free-Code.git
cd Free-Code
npm link
```

Either way, this gives you the `fcode` command anywhere on your system.

### Auto-update

Free Code **updates itself**. On launch it checks GitHub (at most once every 6
hours); if the repo has new commits it fast-forwards your install and relaunches
with the new code automatically — you always run the latest. Force a check any
time with the `/update` command, or disable it with `FREECODE_NO_UPDATE=1` (or
`fcode --no-update`).

## Setup

There's no separate setup step — it happens on your first run.

```bash
fcode
```

The **first time**, Free Code analyzes your machine and shows a picker like this:

```
Free Code — first-time setup
Detected: 15.8GB RAM · 12 CPU cores · NVIDIA GPU (6.0GB VRAM)
Pick a model to install. It runs 100% locally — no Ollama, no cloud.

  1. Light — Qwen2.5-Coder 1.5B (~1.1GB)
     Fastest & lightest. Fine on 8GB RAM with no GPU.
  2. Balanced — Qwen2.5-Coder 3B (~2GB)
     Good all-rounder. Recommended for 16GB RAM.
  3. Full — Qwen2.5-Coder 7B (~4.7GB)  ★ recommended
     Most reliable at multi-file work. Best with a GPU or 16GB+ RAM.

Choose 1-3 [3]:
```

Pick one and Free Code downloads it (plus the llama.cpp engine binary) into `~/.freecode/`. Every
launch after that skips straight to a session. Change your mind later with the `/model` command.

## Run

```bash
fcode
```

`fcode` starts an interactive session in your current directory, booting its local engine
automatically. No background service to start or manage.

### In-session commands

| Command | Effect |
|---|---|
| `/model` | Re-run the model picker — switch tier, download if needed, restart the engine |
| `/models` | List downloaded model files and the active one |
| `/gpu` | Show the engine build (CPU/CUDA/Vulkan/Metal) and GPU offload |
| `/index` | Rebuild the code graph now (shows symbol/edge counts) |
| `/graph <name>` | Look up a symbol in the code graph + its callers/callees |
| `/tools` | List all tools available (built-in + MCP) |
| `/sessions` | List saved sessions |
| `/resume <id>` | Resume a saved session |
| `/update` | Check for and pull the latest version now |
| `/reset` | Clear conversation history, start fresh |
| `exit` / `quit` | Quit |

## Choosing & changing your model

The first-run wizard recommends a tier based on your detected RAM and GPU, but you pick. The three
tiers are all [Qwen2.5-Coder](https://huggingface.co/Qwen) (Q4_K_M GGUF):

| Tier | Model | Size | Good for |
|---|---|---|---|
| **Light** | Qwen2.5-Coder 1.5B | ~1.1GB | 8GB RAM, no GPU. Fast, but skips steps on complex tasks. |
| **Balanced** | Qwen2.5-Coder 3B | ~2.0GB | 16GB RAM. Solid all-rounder. |
| **Full** ⭐ | Qwen2.5-Coder 7B | ~4.7GB | GPU or 16GB+ RAM. Most reliable at multi-file work. |

Switch tiers any time from inside a session with `/model` — it re-runs the picker, downloads the new
model if needed, and restarts the engine. Only one model is active at a time.

## GPU acceleration

On **macOS (Apple Silicon)** GPU acceleration works out of the box — the bundled build uses Metal,
and Free Code offloads as many model layers as fit.

On **Windows / Linux** the default bundled engine is a **CPU build** (it always runs, with no driver
or runtime prerequisites). To use an NVIDIA or other GPU, opt into a GPU build before setup:

```bash
# NVIDIA (CUDA)
FREECODE_ENGINE_VARIANT=cuda fcode
# Any GPU (AMD / Intel / NVIDIA) via Vulkan
FREECODE_ENGINE_VARIANT=vulkan fcode
```

Then run `/model` (or delete `~/.freecode/bin`) so Free Code re-downloads the matching engine. A GPU
makes inference **5–15× faster**. Check what's in use inside a session with `/gpu`.

### Perf tuning (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `FREECODE_NUM_GPU` | `999` | Model layers to offload to GPU (`-ngl`; 999 = as many as fit) |
| `FREECODE_NUM_THREAD` | `0` (auto) | CPU threads to use (`-t`) |
| `FREECODE_NUM_CTX` | `8192` | Context window size (`-c`; bigger = more VRAM/RAM) |

## Configuration

Set these as environment variables before running `fcode`:

| Variable | Default | Purpose |
|---|---|---|
| `FREECODE_ENGINE_VARIANT` | `cpu` (Win/Linux), `metal` (macOS) | llama.cpp build: `cpu` / `cuda` / `vulkan` |
| `FREECODE_HOME` | `~/.freecode` | Where the engine binary + models are stored |

The model isn't set by env var — pick it in the first-run wizard or with `/model`.

> **Note:** the 1.5B/3B tiers are light and fast but will sometimes skip steps or answer without
> actually running a tool on complex, multi-part tasks. If a smaller model isn't building what you
> ask, switch to the 7B (`/model`) — it's dramatically more reliable at multi-step work.

## How it works

```
you type a request
      │
      ▼
 system prompt + conversation ──▶ bundled llama.cpp engine (local llama-server)
                                        │
                          model replies with strict JSON:
                          {"tool": "...", "arguments": {...}, "final_answer": "..."}
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                        ▼
            tool call requested                      final_answer given
                    │                                        │
        permission check (write/edit/bash)                   ▼
                    │                                  printed to you
                    ▼
             tool executes, result
             fed back into conversation
                    │
                    └──────────────► loop continues
```

Small local models are unreliable at native OpenAI-style function calling — tested and
confirmed during development. Free Code instead uses llama.cpp's constrained decoding
(a JSON-schema `response_format`, compiled to a GBNF grammar) to force every model response
into a strict, parseable envelope, which is far more reliable on 1.5B–7B models than hoping
the model's `tool_calls` field populates correctly.

Responses are **streamed live** — you see a spinner with elapsed time and token
count while the model thinks, each tool call as it happens (`🔧 write_file …`),
a one-line summary of every tool result (`✓ wrote 43 bytes`), and finally the
answer. You always know what Free Code is doing.

## Sessions & long conversations

Every conversation is auto-saved to `.freecode/sessions/<id>.json` after each turn.

Long sessions won't overflow the model's context window: when the conversation
approaches the context budget, Free Code **automatically summarizes** the older
middle of the conversation into a compact note and keeps the recent turns, so you
can keep working without losing the thread (you'll see `⟳ compacting …`).

| Command | Effect |
|---|---|
| `/sessions` | List saved sessions (id, turns, model, title) |
| `/resume <id>` | Resume a previous session with full history |
| `/reset` | Start a fresh session |

## MCP tool servers

Free Code can connect to [MCP](https://modelcontextprotocol.io) servers and expose
their tools to the model alongside the built-ins. Copy `mcp.example.json` to
`.freecode/mcp.json` and list your servers:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
  }
}
```

On startup each server is spawned over stdio and its tools are registered as
`<server>__<tool>` (e.g. `filesystem__read_file`). MCP tools are permission-gated
by default. Use `/tools` in a session to see every tool currently available.

## Diagnostics after edits

When the model writes or edits a source file, Free Code automatically runs a fast
syntax check for that language and feeds any errors back into the conversation, so
the model fixes broken code on the next turn instead of leaving it. Dependency-free
and offline — it uses tools you already have:

| Language | Checker |
|---|---|
| JavaScript (`.js/.mjs/.cjs`) | `node --check` |
| JSON | `JSON.parse` |
| Python (`.py`) | `python -m py_compile` (if `python` is installed) |
| TypeScript (`.ts/.tsx`) | `tsc --noEmit` (if `tsc` is installed) |

You'll see `⚠ diagnostics: …` in the output when a check fails.

## Project layout

```
bin/freecode.js      entrypoint
src/cli.js           interactive REPL + live display wiring
src/agent.js         tool-call loop
src/llm.js           streaming client for the local llama-server (OpenAI API)
src/engine/          bundled inference engine (replaces Ollama):
  ├ index.js         first-run wizard + ensureEngineReady
  ├ system.js        RAM/CPU/GPU detection
  ├ models.js        the one model family + 3 tiers + recommendation
  ├ platform.js      resolve the right llama.cpp release asset
  ├ download.js      HTTPS download (progress) + pure-JS zip extractor
  ├ server.js        Engine: spawn + health-check llama-server
  └ paths.js/state.js  ~/.freecode layout + engine.json
src/codegraph/       built-in tree-sitter code graph:
  ├ runtime.js       download + init tree-sitter wasm runtime/grammars
  ├ grammars.js      language catalog + asset URLs
  ├ extract.js       per-language def + call-site extraction
  ├ build.js         walk project → nodes + edges (incremental)
  ├ query.js         search / callers / callees / impact / explore
  └ tools.js         the code_* agent tools + build/refresh
src/config.js        perf knobs (→ llama-server flags)
src/session.js       session persistence
src/mcp.js           MCP stdio client
src/toolRegistry.js  built-in + MCP tool registry
src/diagnostics.js   post-edit syntax checks
src/tui.js           full-screen TUI (composeFrame + runner)
src/ui.js            classic-mode panels + rendering
src/permission.js    permission gate
src/systemPrompt.js  system prompt + tool docs
src/tools/           files, shell, search, ls, web_search, web_fetch, browser
```

## Roadmap

- [x] Streaming output with live progress
- [x] Automatic best-model selection
- [x] GPU acceleration + full hardware use
- [x] Session persistence (save / resume)
- [x] MCP tool server support
- [x] Diagnostics after edits
- [x] Full-screen TUI
- [x] Context compaction for long sessions
- [x] One-line install script
- [x] Auto-update on launch
- [x] Subagents (task delegation)
- [x] Self-contained engine — bundled llama.cpp, no Ollama
- [x] Guided first-run setup (system analysis → pick 1 of 3 model tiers)
- [x] Built-in tree-sitter code graph (search / callers / callees / impact / explore)

## Contributing

Issues and PRs welcome — [open one here](https://github.com/hariomvyas/Free-Code/issues).

## License

[MIT](LICENSE)
