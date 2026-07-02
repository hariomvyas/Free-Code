# Free Code Features

Free Code is a local, offline coding-agent CLI that runs on your machine with a bundled llama.cpp engine and GGUF coding models.

## Local Model Runtime

- Runs against local open-weight models; no API keys, cloud account, or Ollama required.
- Downloads and manages the bundled `llama-server` engine automatically.
- Supports a model picker with installed models, recommended models based on system specs, catalog downloads, and custom GGUF URLs.
- Supports CPU by default, with optional CUDA, Vulkan, or Metal acceleration depending on platform.

## Coding Agent Workflow

- Reads, writes, and edits project files through built-in tools.
- Runs shell commands in the project directory.
- Searches files with grep, glob, and directory listing tools.
- Uses a JSON-envelope tool protocol designed for small local models.
- Supports multi-step tool loops until the task is complete.

## Built-In Tools

- `read_file`, `write_file`, `edit_file`, and `multi_edit` for file operations.
- `bash` for scoped shell commands.
- `ls`, `glob`, and `grep` for project exploration.
- `web_search` and `web_fetch` for internet research.
- `browser` for JavaScript-rendered pages when Playwright is installed.

## Code Graph

- Builds a tree-sitter-based semantic index for supported languages.
- Supports JavaScript, TypeScript, JSX, TSX, Python, Go, and Rust.
- Provides `code_search`, `code_callers`, `code_callees`, `code_impact`, and `code_explore`.
- Stores the graph as project-local JSON in `.freecode/codegraph.json`.

## Interface

- Starts a full-screen terminal UI in interactive terminals.
- Provides a classic scrolling REPL with `--classic` or when input is piped.
- Shows tool activity, progress, token counts, and permission prompts.
- Supports `ESC` interruption in the TUI without quitting the app.

## Sessions & Memory

- Auto-saves conversations under `.freecode/sessions/`.
- Supports `/sessions` and `/resume <id>` for restoring prior work.
- Compacts older conversation history when approaching the model context limit.
- Logs assistant/tool messages in `.freecode/logs/`.

## Permissions & Safety

- Permission-gates mutating tools such as writes, edits, shell commands, and MCP tools.
- Supports one-time, session, and persisted permissions.
- Stores project permissions in `.freecode/permissions.json`.

## MCP Integration

- Loads MCP servers from `.freecode/mcp.json`.
- Discovers server tools and exposes them as `<server>__<tool>`.
- Gates MCP tools by default because their side effects are unknown.

## Diagnostics

- Runs lightweight syntax checks after successful file writes or edits.
- Checks JavaScript with `node --check`, JSON with parsing, Python with `py_compile`, and TypeScript with `tsc` when available.
- Feeds diagnostics back to the model so it can fix broken code in the same turn.

## Updates & Installation

- Provides one-line install scripts for macOS, Linux, and Windows.
- Supports `npm link` for local development.
- Checks for git-based updates on launch, throttled to once every six hours.
- Supports `/update` and `FREECODE_NO_UPDATE=1`.

## Comparison With Similar Solutions

Free Code is closest to terminal coding agents such as Claude Code, Codex CLI, Aider, and IDE-first tools such as Cursor. Its main difference is that it is self-contained and designed to keep model execution local.

| Solution | Primary Focus | Model Runtime | Strengths | Tradeoffs |
|---|---|---|---|---|
| **Free Code** | Offline terminal coding agent | Bundled llama.cpp engine with local GGUF models | No API key, no cloud dependency after setup, permission-gated tools, code graph, MCP, sessions | Quality and speed depend on local hardware and selected model |
| **Claude Code** | Commercial agent across terminal, IDE, desktop, and web | Hosted Claude models via Anthropic account or supported providers | Strong managed agent workflow, broad integrations, high model quality | Requires external model access; not fully offline |
| **OpenAI Codex** | OpenAI coding agent across app, CLI, IDE, and web workflows | Hosted OpenAI models | Strong cloud-agent and OpenAI ecosystem integration | Requires OpenAI account/model access; not fully offline |
| **Aider** | Git-centric AI pair programming in the terminal | User-selected cloud or local LLM backends | Mature terminal workflow, broad model support, automatic git commits | Requires configuring model providers; local model runtime is not bundled |
| **Cursor** | AI-native editor and agent platform | Hosted/model-provider-backed IDE experience | Deep IDE integration, autocomplete, codebase indexing, agents, team workflows | Editor-first rather than lightweight CLI-first; not designed as an offline bundled runtime |

Choose Free Code when privacy, offline execution, no recurring API dependency, and a lightweight terminal workflow matter more than access to the largest hosted frontier models.
