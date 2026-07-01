<div align="center">

# Free Code

**A local, offline coding agent CLI — no API keys, no cloud, no bill.**

Runs entirely on your machine against a small open-source LLM served by [Ollama](https://ollama.com).
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
zero telemetry, zero API keys.

```
$ fcode
Free Code v0.1.0 — model: qwen2.5-coder:3b  host: http://127.0.0.1:11434
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
| 🔒 **Fully offline** | No API keys, no network calls except to your local Ollama server |
| 🪶 **Runs on 8GB RAM** | Default model is a 3B quantized coder model (~2GB on disk) |
| 🛠️ **Real tools** | `read_file`, `write_file`, `edit_file`, `bash`, `grep`, `glob` |
| ✅ **Permission-gated** | Confirms before writes, edits, or shell commands — "always allow" persists per project |
| 📝 **Debuggable** | Every session's full tool-call transcript logged to `.freecode/logs/` |
| 📦 **Zero dependencies** | Pure Node.js standard library — nothing to `npm install` |

## Requirements

- **[Node.js](https://nodejs.org) 18+**
- **[Ollama](https://ollama.com)** installed and running

## Install

Clone and link it as a global command:

```bash
git clone https://github.com/hariomvyas/Free-Code.git
cd Free-Code
npm link
```

Or install straight from GitHub without cloning:

```bash
npm install -g git+https://github.com/hariomvyas/Free-Code.git
```

Either way, this gives you the `fcode` command anywhere on your system.

## Setup

Pull a coding model (one-time, ~2GB download):

```bash
ollama pull qwen2.5-coder:3b
```

Make sure Ollama is running:

```bash
ollama serve
```

## Run

```bash
fcode
```

That's it. `fcode` starts an interactive session in your current directory. Free Code checks
that Ollama is reachable and the model is pulled before starting, and tells you exactly what
to run if either is missing.

### In-session commands

| Command | Effect |
|---|---|
| `/model <name>` | Switch model for the rest of the session (must be installed) |
| `/models` | List installed Ollama models |
| `/gpu` | Show whether the current model is running on GPU or CPU |
| `/tools` | List all tools available (built-in + MCP) |
| `/sessions` | List saved sessions |
| `/resume <id>` | Resume a saved session |
| `/reset` | Clear conversation history, start fresh |
| `exit` / `quit` | Quit |

## Automatic model selection

You don't have to pick a model. On startup Free Code scans your installed Ollama
models and automatically uses the **strongest coder model you have**, in this order:

```
qwen2.5-coder:14b  →  qwen2.5-coder:7b  →  qwen2.5-coder:3b  →  qwen2.5-coder:1.5b
```

So if you've pulled the 7B, `fcode` uses it; if you only have the 3B, it uses that.
Pin a specific model any time with the `FREECODE_MODEL` environment variable.

## GPU acceleration

Free Code uses **all the hardware you have**. By default it tells Ollama to offload
every model layer that fits into GPU VRAM (`num_gpu: 999`, which Ollama safely caps
to what actually fits) and to use all your CPU cores. A GPU makes it **5–15× faster**.

Check whether your GPU is actually being used — inside a session, send one message,
then run:

```
/gpu
```

If it says `100% CPU (GPU not used)` but you *have* a discrete GPU, your **GPU driver
is almost certainly too old for Ollama's CUDA runtime**. This is the #1 cause of
CPU-only inference. Fix it:

**NVIDIA:**
1. Check your driver: `nvidia-smi` — look at the `CUDA Version` in the top-right.
   Ollama needs **CUDA 12+** (driver ≈ 527 or newer). If it shows 10.x/11.x, update.
2. Download the latest Game Ready / Studio driver for your card from
   [nvidia.com/Download](https://www.nvidia.com/Download/index.aspx), install, reboot.
3. Re-run `nvidia-smi` — `CUDA Version` should now be `12.x` or higher.

**AMD:** install the latest Adrenalin driver + make sure ROCm is supported for your card.

After updating, `/gpu` should show a high `% on GPU`.

### Perf tuning (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `FREECODE_NUM_GPU` | `999` | Model layers to offload to GPU (999 = as many as fit) |
| `FREECODE_NUM_THREAD` | `0` (auto) | CPU threads to use |
| `FREECODE_NUM_CTX` | `8192` | Context window size (bigger = more VRAM/RAM) |

## Configuration

Set these as environment variables before running `fcode`:

| Variable | Default | Purpose |
|---|---|---|
| `FREECODE_MODEL` | _(auto-selected)_ | Force a specific Ollama model |
| `FREECODE_HOST` | `http://127.0.0.1:11434` | Ollama server address |

```bash
FREECODE_MODEL=qwen2.5-coder:7b fcode
```

## Picking a model for your RAM budget

| RAM available | Recommended model | Notes |
|---|---|---|
| 8GB (CPU only) | `qwen2.5-coder:3b` | ~2GB on disk, fastest, fits tight RAM — but skips steps on complex multi-file tasks |
| 16GB+ or 8GB GPU | **`qwen2.5-coder:7b`** ⭐ | Reliably builds complete multi-file solutions; slower per token on CPU |

> **Note:** the 3B model is light and fast but will sometimes skip steps or answer
> without actually running a tool on complex, multi-part tasks. If it isn't building
> what you ask, pull the 7B — it's dramatically more reliable at multi-step work:
> ```bash
> ollama pull qwen2.5-coder:7b
> ```

Avoid "thinking"/hybrid-reasoning models (e.g. `qwen3`) for this use case — they burn hundreds
of extra tokens reasoning before every single tool call, which makes the agent loop painfully
slow on CPU-only hardware.

## How it works

```
you type a request
      │
      ▼
 system prompt + conversation ──▶ local model (via Ollama)
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
confirmed during development. Free Code instead uses Ollama's JSON-schema-constrained
output mode to force every model response into a strict, parseable envelope, which is
far more reliable on 3B-class models than hoping the model's `tool_calls` field populates
correctly.

Responses are **streamed live** — you see a spinner with elapsed time and token
count while the model thinks, each tool call as it happens (`🔧 write_file …`),
a one-line summary of every tool result (`✓ wrote 43 bytes`), and finally the
answer. You always know what Free Code is doing.

## Sessions

Every conversation is auto-saved to `.freecode/sessions/<id>.json` after each turn.

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
src/llm.js           streaming Ollama client
src/ui.js            spinner + tool-activity display
src/config.js        auto model-selection + perf knobs
src/session.js       session persistence
src/mcp.js           MCP stdio client
src/toolRegistry.js  built-in + MCP tool registry
src/diagnostics.js   post-edit syntax checks
src/permission.js    permission gate
src/systemPrompt.js  system prompt + tool docs
src/tools/           read_file, write_file, edit_file, bash, grep, glob
```

## Roadmap

- [x] Streaming output with live progress
- [x] Automatic best-model selection
- [x] GPU acceleration + full hardware use
- [x] Session persistence (save / resume)
- [x] MCP tool server support
- [x] Diagnostics after edits
- [ ] Context compaction for long sessions
- [ ] One-line install script (auto-pulls model on first run)
- [ ] TUI (richer terminal UI)

## Contributing

Issues and PRs welcome — [open one here](https://github.com/hariomvyas/Free-Code/issues).

## License

[MIT](LICENSE)
