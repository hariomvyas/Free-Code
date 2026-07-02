# Repository Guidelines

## Project Structure & Module Organization

Free Code is a dependency-free Node.js ESM CLI. The executable entry point is `bin/freecode.js`, which delegates to `src/cli.js`. Core agent orchestration lives in `src/agent.js`, model access in `src/llm.js`, and slash-command/UI wiring in `src/cli.js`, `src/tui.js`, and `src/ui.js`.

Built-in tools are under `src/tools/`; add a tool by creating `src/tools/<name>.js` and registering it in `src/tools/index.js`. The bundled llama.cpp engine installer/runtime is in `src/engine/`. The tree-sitter code graph is in `src/codegraph/`. Manual smoke checks and mock services live in `scripts/`. Project-local runtime state is written to `.freecode/`; global engine/model assets are stored in `~/.freecode/`.

## Build, Test, and Development Commands

There is no build step and no `package.json` scripts.

- `node bin/freecode.js` runs the CLI directly.
- `node bin/freecode.js --classic` runs the plain REPL instead of the full-screen TUI.
- `npm link` installs the `fcode` / `freecode` commands globally for local development.
- `node scripts/smoke_codegraph.js` checks code graph build/query behavior without booting the model.
- `node scripts/smoke_session.js`, `node scripts/smoke_diag.js`, and `node scripts/smoke_mcp.js` test focused subsystems.
- LLM smoke scripts such as `node scripts/smoke.js` require a model already installed by running `fcode` once.

## Coding Style & Naming Conventions

Use modern JavaScript ESM with `import`/`export`. Keep the project dependency-free; prefer Node standard library APIs over npm packages. Match existing two-space indentation, semicolon usage, and concise comments. Use `camelCase` for functions and variables, `PascalCase` for classes, and descriptive file names matching the module purpose.

## Testing Guidelines

Tests are smoke scripts, not a framework. Name new checks `scripts/smoke_<area>.js` and keep them runnable with `node`. Prefer tests that exercise one subsystem without requiring the local model when possible. If a test writes runtime files, keep them under `.freecode/` or clean them up afterward.

## Commit & Pull Request Guidelines

Follow the existing commit style: short imperative subjects, for example `Add MCP tool server support` or `Replace Ollama with bundled llama.cpp engine`. Pull requests should explain the behavior change, list smoke scripts run, and call out any engine/model/network requirements. Include terminal screenshots only for visible TUI changes.

## Security & Configuration Tips

Mutating tools and unknown MCP tools are permission-gated; preserve that behavior. Keep environment variables under the `FREECODE_*` prefix, such as `FREECODE_NUM_CTX`, `FREECODE_ENGINE_VARIANT`, and `FREECODE_HOME`. Do not commit downloaded models, engine binaries, grammar assets, logs, sessions, or permission files.
