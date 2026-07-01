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
| `/model <name>` | Switch model for the rest of the session |
| `/reset` | Clear conversation history, start fresh |
| `exit` / `quit` | Quit |

## Configuration

Set these as environment variables before running `fcode`:

| Variable | Default | Purpose |
|---|---|---|
| `FREECODE_MODEL` | `qwen2.5-coder:3b` | Which Ollama model to use |
| `FREECODE_HOST` | `http://127.0.0.1:11434` | Ollama server address |

```bash
FREECODE_MODEL=qwen2.5-coder:7b fcode
```

## Picking a model for your RAM budget

| RAM available | Recommended model | Notes |
|---|---|---|
| 8GB (CPU only) | `qwen2.5-coder:3b` (default) | ~2GB on disk, fastest, best fit for tight RAM |
| 16GB+ or 8GB GPU | `qwen2.5-coder:7b` | Stronger coding quality, needs more headroom |

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

## Project layout

```
bin/freecode.js     entrypoint
src/cli.js          interactive REPL
src/agent.js         tool-call loop
src/llm.js           Ollama client
src/permission.js    permission gate
src/systemPrompt.js  system prompt + tool docs
src/tools/           read_file, write_file, edit_file, bash, grep, glob
```

## Roadmap

- [ ] Streaming output
- [ ] Context compaction for long sessions
- [ ] One-line install script (auto-pulls model on first run)
- [ ] TUI (richer terminal UI)

## Contributing

Issues and PRs welcome — [open one here](https://github.com/hariomvyas/Free-Code/issues).

## License

[MIT](LICENSE)
