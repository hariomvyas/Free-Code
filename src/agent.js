import fs from "node:fs/promises";
import path from "node:path";
import { chat, complete, LLMError } from "./llm.js";
import { executeTool, isMutating, describeTools } from "./tools/index.js";
import { buildSystemPrompt, buildSubagentPrompt } from "./systemPrompt.js";
import { LOG_DIR } from "./config.js";
import { Session } from "./session.js";
import { checkFile } from "./diagnostics.js";
import { getManager } from "./lsp/manager.js";

const TASK_DOC =
  "\n- task(description: string, prompt: string) — Delegate a focused subtask to a fresh subagent " +
  "that has its own context and the same tools. It runs the prompt to completion and returns a " +
  "concise report. Use for self-contained research or multi-step chunks to keep your own context small.";

export class Agent {
  constructor({ config, permissionGate, session, toolRegistry, allowSubagents = true }) {
    this.config = config;
    this.permissionGate = permissionGate;
    this.session = session || new Session({ model: config.model });
    // Optional extra tools (e.g. from MCP servers) merged with built-ins.
    this.toolRegistry = toolRegistry || null;
    // Children run with allowSubagents=false to prevent infinite recursion.
    this.allowSubagents = allowSubagents;

    if (this.session.messages.length === 0) {
      this.session.messages.push({
        role: "system",
        content: buildSystemPrompt(process.cwd(), this._describeTools()),
      });
    }
    this.session.model = config.model;
    this.logFile = path.join(LOG_DIR, `${this.session.id}.jsonl`);
  }

  get messages() {
    return this.session.messages;
  }

  _describeTools() {
    const base = this.toolRegistry ? this.toolRegistry.describe() : describeTools();
    return this.allowSubagents ? base + TASK_DOC : base;
  }

  async _execTool(name, args) {
    if (this.toolRegistry) return this.toolRegistry.execute(name, args);
    return executeTool(name, args);
  }

  _isMutating(name) {
    if (this.toolRegistry) return this.toolRegistry.isMutating(name);
    return isMutating(name);
  }

  async send(userText, hooks = {}, signal = null) {
    const { onThinkStart, onToken, onThinkEnd, onToolCall, onToolResult, onDenied, onDiagnostics, onCompact } = hooks;

    this.messages.push({ role: "user", content: userText });
    await this._maybeCompact(onCompact);

    try {
      for (let i = 0; i < this.config.maxIterations; i++) {
        if (signal?.aborted) return "⎋ interrupted";
        onThinkStart?.(i + 1);
        let tokenCount = 0;
        let assistantMsg;
        try {
          assistantMsg = await chat({
            host: this.config.host,
            model: this.config.model,
            messages: this.messages,
            timeoutMs: this.config.requestTimeoutMs,
            perf: this.config.perf,
            signal,
            onToken: (piece) => {
              tokenCount++;
              onToken?.(piece, tokenCount);
            },
          });
        } catch (err) {
          onThinkEnd?.(tokenCount);
          if (err.interrupted || signal?.aborted) return "⎋ interrupted";
          throw err;
        }
        onThinkEnd?.(tokenCount);
        this.messages.push(assistantMsg);
        await this._log(assistantMsg);

        let envelope;
        try {
          envelope = JSON.parse(assistantMsg.content);
        } catch {
          // model didn't honor the JSON envelope — surface raw text rather than crash.
          return assistantMsg.content || "";
        }

        const toolName = (envelope.tool || "").trim();
        if (!toolName) {
          return envelope.final_answer || "";
        }

        const args = envelope.arguments || {};
        onToolCall?.(toolName, args);

        // Subagent delegation: run a child agent and feed its report back.
        if (toolName === "task" && this.allowSubagents) {
          let resultText;
          try {
            const report = await this._runSubagent(args, hooks);
            resultText = JSON.stringify({ report });
          } catch (err) {
            resultText = JSON.stringify({ error: err.message });
          }
          onToolResult?.(toolName, resultText, true);
          const toolMsg = { role: "user", content: `[tool_result:task] ${resultText}` };
          this.messages.push(toolMsg);
          await this._log(toolMsg);
          continue;
        }

        let resultText;
        let ok = true;
        if (this._isMutating(toolName) && !(await this.permissionGate.check(toolName, args))) {
          onDenied?.(toolName);
          resultText = JSON.stringify({ error: "Permission denied by user." });
          ok = false;
        } else {
          try {
            const result = await this._execTool(toolName, args);
            // After a successful write/edit, run diagnostics so the model gets
            // immediate feedback on broken code and can fix it next turn.
            if ((toolName === "write_file" || toolName === "edit_file") && result?.path) {
              const diag = await checkFile(result.path).catch(() => null);
              if (diag?.checked && !diag.ok) {
                result.diagnostics = `FAILED CHECK — fix these errors:\n${diag.errors}`;
                ok = false;
                onDiagnostics?.(toolName, diag.errors);
              } else if (diag?.checked && diag.ok) {
                result.diagnostics = "ok (no syntax errors)";
              }
              // If a language server is installed for this file, layer real
              // compiler/type diagnostics on top of the syntax check.
              try {
                const lsp = await getManager().diagnostics(result.path);
                if (lsp.available) {
                  const errs = lsp.diagnostics.filter((d) => d.severity === "error");
                  if (errs.length) {
                    const text = errs.map((d) => `${d.line}:${d.character} ${d.message}`).join("\n");
                    result.diagnostics = (result.diagnostics && result.diagnostics.startsWith("FAILED") ? result.diagnostics + "\n" : "") +
                      `LSP (${lsp.server}) errors — fix these:\n${text}`;
                    ok = false;
                    onDiagnostics?.(toolName, text);
                  }
                }
              } catch {
                // LSP is best-effort; never block an edit on it.
              }
            }
            resultText = JSON.stringify(result);
          } catch (err) {
            resultText = JSON.stringify({ error: err.message });
            ok = false;
          }
        }
        onToolResult?.(toolName, resultText, ok);

        const toolMsg = { role: "user", content: `[tool_result:${toolName}] ${resultText}` };
        this.messages.push(toolMsg);
        await this._log(toolMsg);
      }

      return "[stopped: hit max tool-call iterations without a final answer]";
    } finally {
      // Persist the session after every turn so nothing is lost on crash/exit.
      await this.session.save().catch(() => {});
    }
  }

  // Rough token estimate (~4 chars/token) across all messages.
  _estimateTokens() {
    let chars = 0;
    for (const m of this.messages) chars += (m.content || "").length;
    return Math.ceil(chars / 4);
  }

  // When the conversation approaches the context window, summarize the older
  // middle of the conversation into one compact note and keep recent turns, so
  // long sessions don't overflow num_ctx or slow to a crawl.
  async _maybeCompact(onCompact) {
    const budget = (this.config.perf?.num_ctx ?? 8192);
    const threshold = Math.floor(budget * 0.75); // leave room for the reply
    if (this._estimateTokens() < threshold) return;

    const keepRecent = 6;
    // messages[0] is the system prompt; keep it and the last `keepRecent`.
    if (this.messages.length <= keepRecent + 2) return;
    const head = this.messages[0];
    const middle = this.messages.slice(1, this.messages.length - keepRecent);
    const tail = this.messages.slice(this.messages.length - keepRecent);

    const transcript = middle
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n")
      .slice(0, 12000);

    onCompact?.(middle.length);
    let summary;
    try {
      summary = await complete({
        host: this.config.host,
        model: this.config.model,
        perf: this.config.perf,
        prompt:
          "Summarize the following coding-assistant conversation so work can continue " +
          "without the full history. Keep: the user's goals, key decisions, files created/edited " +
          "and their purpose, and any unresolved tasks. Be concise and factual.\n\n" +
          transcript,
      });
    } catch {
      return; // if summarization fails, leave history as-is
    }

    this.session.messages = [
      head,
      { role: "user", content: `[earlier conversation summary]\n${summary.trim()}` },
      ...tail,
    ];
  }

  // Spawns a child Agent with its own context to complete one delegated task,
  // returning its final report. The child can't spawn further subagents.
  async _runSubagent(args, hooks = {}) {
    const description = args.description || "subtask";
    const prompt = args.prompt || args.description || "";
    if (!prompt) throw new Error("task requires a 'prompt'");

    hooks.onSubagent?.(description);

    const childSession = new Session({ model: this.config.model });
    childSession.messages.push({
      role: "system",
      content: buildSubagentPrompt(process.cwd(), this._describeTools(), prompt),
    });

    const child = new Agent({
      config: this.config,
      permissionGate: this.permissionGate,
      session: childSession,
      toolRegistry: this.toolRegistry,
      allowSubagents: false,
    });

    // Forward the child's activity to the parent UI, indented.
    const report = await child.send(prompt, {
      onToolCall: (name, a) => hooks.onToolCall?.("⤷ " + name, a),
      onToolResult: (name, r, ok) => hooks.onToolResult?.(name, r, ok),
      onDenied: (name) => hooks.onDenied?.(name),
      onDiagnostics: (name, e) => hooks.onDiagnostics?.(name, e),
    });
    return report;
  }

  async _log(msg) {
    try {
      await fs.mkdir(LOG_DIR, { recursive: true });
      await fs.appendFile(this.logFile, JSON.stringify(msg) + "\n", "utf8");
    } catch {
      // logging is best-effort
    }
  }
}

export { LLMError };
